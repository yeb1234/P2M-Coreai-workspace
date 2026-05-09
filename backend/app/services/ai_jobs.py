from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from app.database import SessionLocal, settings
from app.models import AiJob, Note, SubtitleSegment, Video
from app.services.ffmpeg_audio import extract_wav_16k_mono
from app.services.ollama_summarize import summarize_with_ollama, summarize_with_openai
from app.services.subtitle_corrector import correct_segments_with_openai
from app.services.subtitle_writer import write_vtt_output
from app.services.transcribe_whisper import transcribe_wav
from app.services.write_md import write_markdown_output
from app.utils.files import safe_stem, unique_suffix
from app.utils.serialization import dump_segments


@dataclass(frozen=True)
class AiJobOptions:
    whisper_model: str
    language: str
    do_summary: bool
    word_limit: int
    ollama_model: str | None
    cpu_threads: int
    compute_type: str
    beam_size: int | None
    best_of: int | None
    temperature: float | None
    vad_filter: bool | None
    subtitle_correction_enabled: bool | None


@dataclass(frozen=True)
class AiJobPaths:
    source: Path
    wav: Path
    markdown: Path
    subtitle: Path


def _build_job_options(
    *,
    whisper_model: str,
    language: str,
    do_summary: bool,
    word_limit: int,
    ollama_model: str | None,
    cpu_threads: int | None = None,
    compute_type: str | None = None,
    beam_size: int | None = None,
    best_of: int | None = None,
    temperature: float | None = None,
    vad_filter: bool | None = None,
    subtitle_correction_enabled: bool | None = None,
) -> AiJobOptions:
    return AiJobOptions(
        whisper_model=whisper_model or settings.default_whisper_model,
        language=language or settings.default_language,
        do_summary=do_summary,
        word_limit=word_limit,
        ollama_model=ollama_model,
        cpu_threads=cpu_threads or settings.whisper_cpu_threads,
        compute_type=compute_type or settings.whisper_compute_type,
        beam_size=beam_size,
        best_of=best_of,
        temperature=temperature,
        vad_filter=vad_filter,
        subtitle_correction_enabled=subtitle_correction_enabled,
    )


def _apply_job_options(job: AiJob, options: AiJobOptions) -> None:
    job.whisper_model = options.whisper_model
    job.language = options.language
    job.do_summary = options.do_summary
    job.word_limit = options.word_limit
    job.ollama_model = options.ollama_model
    job.cpu_threads = options.cpu_threads
    job.compute_type = options.compute_type
    job.beam_size = options.beam_size
    job.best_of = options.best_of
    job.temperature = options.temperature
    job.vad_filter = options.vad_filter
    job.subtitle_correction_enabled = options.subtitle_correction_enabled


def _build_job_paths(video: Video, job: AiJob) -> AiJobPaths:
    source_path = Path(video.filepath)
    base_name = safe_stem(source_path.stem) or f"video-{video.id}"
    return AiJobPaths(
        source=source_path,
        wav=Path(settings.work_dir) / f"{base_name}-{job.id}.wav",
        markdown=Path(settings.output_dir) / "notes" / f"{base_name}-{job.id}.md",
        subtitle=Path(settings.output_dir) / "subtitles" / f"{base_name}-{job.id}.vtt",
    )


def create_ai_job(
    *,
    video_id: int,
    whisper_model: str,
    language: str,
    do_summary: bool,
    word_limit: int,
    ollama_model: str | None,
    cpu_threads: int | None = None,
    compute_type: str | None = None,
    beam_size: int | None = None,
    best_of: int | None = None,
    temperature: float | None = None,
    vad_filter: bool | None = None,
    subtitle_correction_enabled: bool | None = None,
) -> AiJob:
    options = _build_job_options(
        whisper_model=whisper_model,
        language=language,
        do_summary=do_summary,
        word_limit=word_limit,
        ollama_model=ollama_model,
        cpu_threads=cpu_threads,
        compute_type=compute_type,
        beam_size=beam_size,
        best_of=best_of,
        temperature=temperature,
        vad_filter=vad_filter,
        subtitle_correction_enabled=subtitle_correction_enabled,
    )
    db = SessionLocal()
    try:
        video = db.query(Video).filter(Video.id == video_id).first()
        if not video:
            raise ValueError("Video not found")

        existing_job = (
            db.query(AiJob)
            .filter(AiJob.video_id == video_id, AiJob.status.in_(("queued", "running")))
            .order_by(AiJob.created_at.desc())
            .first()
        )
        if existing_job:
            _apply_job_options(existing_job, options)
            db.commit()
            db.refresh(existing_job)
            return existing_job

        job = AiJob(
            id=unique_suffix(),
            video_id=video_id,
            status="queued",
            stage="queued",
            message="Queued for processing",
        )
        _apply_job_options(job, options)
        db.add(job)
        video.ai_status = "queued"
        video.ai_stage = "queued"
        video.ai_error = None
        db.commit()
        db.refresh(job)
        return job
    finally:
        db.close()


def update_job_state(db, job: AiJob, video: Video, **values) -> None:
    for key, value in values.items():
        setattr(job, key, value)
    if "status" in values:
        video.ai_status = values["status"]
    if "stage" in values:
        video.ai_stage = values["stage"]
    if "error" in values:
        video.ai_error = values["error"]
    db.commit()


def ensure_video_note(db, video: Video) -> Note:
    note = (
        db.query(Note)
        .filter(Note.video_id == video.id)
        .order_by(Note.updated_at.desc())
        .first()
    )
    if note:
        return note

    note_path = Path(settings.output_dir) / "notes" / f"video-{video.id}.md"
    note = Note(
        video_id=video.id,
        title=f"{video.title} 学习笔记",
        content="",
        source="manual",
        markdown_path=str(note_path),
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


def replace_subtitle_segments(db, video: Video, segments: list[dict]) -> None:
    db.query(SubtitleSegment).filter(SubtitleSegment.video_id == video.id).delete()
    for index, segment in enumerate(segments):
        db.add(
            SubtitleSegment(
                video_id=video.id,
                segment_index=index,
                start_sec=segment["start"],
                end_sec=segment["end"],
                text=segment["text"],
            )
        )
    db.commit()


def claim_next_ai_job() -> str | None:
    db = SessionLocal()
    try:
        running_count = db.query(AiJob).filter(AiJob.status == "running").count()
        if running_count >= max(1, settings.ai_worker_concurrency):
            return None

        job = (
            db.query(AiJob)
            .filter(AiJob.status == "queued")
            .order_by(AiJob.created_at.asc())
            .first()
        )
        if not job:
            return None

        video = db.query(Video).filter(Video.id == job.video_id).first()
        job.status = "running"
        job.stage = "claimed"
        job.message = "Worker claimed job"
        job.updated_at = datetime.now()
        if video:
            video.ai_status = "running"
            video.ai_stage = "claimed"
            video.ai_error = None
        db.commit()
        return job.id
    finally:
        db.close()


def requeue_interrupted_ai_jobs() -> int:
    db = SessionLocal()
    try:
        jobs = db.query(AiJob).filter(AiJob.status == "running").all()
        for job in jobs:
            video = db.query(Video).filter(Video.id == job.video_id).first()
            job.status = "queued"
            job.stage = "queued"
            job.message = "Requeued after worker restart"
            job.error = None
            if video:
                video.ai_status = "queued"
                video.ai_stage = "queued"
                video.ai_error = None
        if jobs:
            db.commit()
        return len(jobs)
    finally:
        db.close()


def run_ai_job(job_id: str) -> None:
    db = SessionLocal()
    try:
        job = db.query(AiJob).filter(AiJob.id == job_id).first()
        if not job:
            return
        video = db.query(Video).filter(Video.id == job.video_id).first()
        if not video:
            job.status = "failed"
            job.stage = "missing-video"
            job.error = "Video not found"
            db.commit()
            return

        paths = _build_job_paths(video, job)
        if not paths.source.exists():
            update_job_state(
                db,
                job,
                video,
                status="failed",
                stage="missing-video",
                message="Video file is missing",
                error="Video file does not exist",
            )
            return

        update_job_state(db, job, video, status="running", stage="extracting", message="Extracting audio")
        extract_wav_16k_mono(paths.source, paths.wav, cpu_threads=job.cpu_threads)

        update_job_state(db, job, video, status="running", stage="transcribing", message="Transcribing audio")
        transcript_result = transcribe_wav(
            wav_path=paths.wav,
            model_size=job.whisper_model,
            language=job.language,
            cpu_threads=job.cpu_threads,
            compute_type=job.compute_type,
            beam_size=job.beam_size,
            best_of=job.best_of,
            temperature=job.temperature,
            vad_filter=job.vad_filter,
        )
        transcript = transcript_result["text"]
        segments = transcript_result["segments"]

        should_correct_subtitles = (
            settings.subtitle_correction_enabled
            if job.subtitle_correction_enabled is None
            else job.subtitle_correction_enabled
        )
        if should_correct_subtitles and settings.assistant_llm_provider in ("openai", "lmstudio") and segments:
            update_job_state(db, job, video, status="running", stage="correcting-subtitles", message="Correcting subtitles")
            try:
                segments = correct_segments_with_openai(
                    segments,
                    model=job.ollama_model or settings.openai_model,
                    base_url=settings.openai_base_url,
                    api_key=settings.openai_api_key,
                    batch_size=settings.subtitle_correction_batch_size,
                    timeout_s=settings.subtitle_correction_timeout_s,
                )
                transcript = "\n".join((segment.get("text") or "").strip() for segment in segments).strip()
            except Exception as exc:
                job.error = f"字幕校对失败，已保留原字幕：{exc}"
                db.commit()

        job.transcript = transcript
        job.transcript_segments = dump_segments(segments)
        db.commit()

        write_vtt_output(paths.subtitle, segments)
        job.subtitle_path = str(paths.subtitle)
        db.commit()
        replace_subtitle_segments(db, video, segments)

        summary = None
        summary_error = None
        if job.do_summary:
            update_job_state(db, job, video, status="running", stage="summarizing", message="Summarizing content")
            try:
                if settings.assistant_llm_provider in ("openai", "lmstudio"):
                    summary = summarize_with_openai(
                        transcript=transcript,
                        word_limit=job.word_limit,
                        model=job.ollama_model or settings.openai_model,
                        base_url=settings.openai_base_url,
                        api_key=settings.openai_api_key,
                    )
                else:
                    summary = summarize_with_ollama(
                        transcript=transcript,
                        word_limit=job.word_limit,
                        model=job.ollama_model or settings.ollama_model,
                        base_url=settings.ollama_base_url,
                    )
            except Exception as exc:
                summary_error = str(exc)

        update_job_state(db, job, video, status="running", stage="writing", message="Writing markdown and subtitles")
        write_markdown_output(
            md_path=paths.markdown,
            source_filename=video.filename,
            transcript=transcript,
            transcript_segments=segments,
            summary=summary,
            word_limit=job.word_limit,
            whisper_model=job.whisper_model,
            language=job.language,
            subtitle_filename=paths.subtitle.name,
            summary_error=summary_error,
        )

        note = ensure_video_note(db, video)
        note.title = f"{video.title} 学习笔记"
        note.source = "ai"
        note.markdown_path = str(paths.markdown)
        note.content = paths.markdown.read_text(encoding="utf-8")

        video.transcription = transcript
        video.transcript_segments = dump_segments(segments)
        video.summary = summary
        video.markdown_path = str(paths.markdown)
        video.subtitle_path = str(paths.subtitle)
        video.ai_status = "completed"
        video.ai_stage = "completed"
        video.ai_error = summary_error if summary_error and not summary else None

        job.status = "completed"
        job.stage = "completed"
        job.message = "Processing complete"
        job.summary = summary
        job.summary_error = summary_error
        job.markdown_path = str(paths.markdown)
        job.subtitle_path = str(paths.subtitle)
        db.commit()
    except Exception as exc:
        failed_db = db
        job = failed_db.query(AiJob).filter(AiJob.id == job_id).first()
        if job:
            video = failed_db.query(Video).filter(Video.id == job.video_id).first()
            if video:
                video.ai_status = "failed"
                video.ai_stage = job.stage
                video.ai_error = str(exc)
            job.status = "failed"
            job.error = str(exc)
            job.message = str(exc)
            failed_db.commit()
    finally:
        db.close()
