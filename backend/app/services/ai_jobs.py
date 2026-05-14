from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from app.database import SessionLocal, settings
from app.models import AiJob, Note, SubtitleSegment, Video
from app.services.admin_settings import load_assistant_runtime_settings, load_transcription_settings
from app.services.ffmpeg_audio import extract_wav_16k_mono
from app.services.ollama_summarize import summarize_with_ollama, summarize_with_openai
from app.services.subtitle_corrector import correct_segments_with_openai
from app.services.subtitle_writer import write_vtt_output
from app.services.transcribe_whisper import transcribe_wav
from app.services.write_md import write_markdown_output
from app.utils.files import safe_stem, unique_suffix
from app.utils.serialization import dump_segments


def _external_llm_ready() -> bool:
    runtime = _assistant_runtime_settings()
    return bool(runtime["external_base_url"].strip() and runtime["external_api_key"].strip() and runtime["external_model"].strip())


def _assistant_runtime_settings() -> dict:
    try:
        return load_assistant_runtime_settings()
    except Exception:
        return {
            "local_base_url": settings.openai_base_url,
            "local_api_key": settings.openai_api_key,
            "local_model": settings.openai_model,
            "external_base_url": settings.external_llm_base_url,
            "external_api_key": settings.external_llm_api_key,
            "external_model": settings.external_llm_model,
            "llm_usage_policy": settings.llm_usage_policy,
        }


def _llm_usage_policy() -> str:
    try:
        value = _assistant_runtime_settings().get("llm_usage_policy") or load_transcription_settings().get("llm_usage_policy")
    except Exception:
        value = settings.llm_usage_policy
    return value if value in {"local_first", "external_first", "local_only", "external_only"} else "local_first"


def _stored_transcription_defaults() -> dict:
    try:
        return load_transcription_settings()
    except Exception:
        return {}


@dataclass(frozen=True)
class AiJobOptions:
    whisper_engine: str
    whisper_model: str
    language: str
    do_summary: bool
    word_limit: int
    ollama_model: str | None
    cpu_threads: int | None
    compute_type: str
    beam_size: int | None
    best_of: int | None
    temperature: float | None
    vad_filter: bool | None
    device_type: str | None
    subtitle_correction_enabled: bool | None
    subtitle_correction_scope: str | None
    subtitle_correction_prompt: str | None


@dataclass(frozen=True)
class AiJobPaths:
    source: Path
    wav: Path
    markdown: Path
    subtitle: Path


def _build_job_options(
    *,
    whisper_model: str,
    whisper_engine: str | None = None,
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
    device_type: str | None = None,
    subtitle_correction_enabled: bool | None = None,
    subtitle_correction_scope: str | None = None,
    subtitle_correction_prompt: str | None = None,
) -> AiJobOptions:
    stored = _stored_transcription_defaults()
    resolved_engine = whisper_engine or stored.get("whisper_engine") or settings.whisper_engine
    if subtitle_correction_scope is not None:
        resolved_correction_scope = "off" if subtitle_correction_scope == "off" else "full"
    elif stored.get("subtitle_correction_scope") is not None:
        resolved_correction_scope = "off" if stored.get("subtitle_correction_scope") == "off" else "full"
    else:
        resolved_correction_scope = "full" if subtitle_correction_enabled else "off"
    return AiJobOptions(
        whisper_engine=resolved_engine,
        whisper_model=whisper_model or stored.get("whisper_model") or settings.default_whisper_model,
        language=language or stored.get("language") or settings.default_language,
        do_summary=do_summary,
        word_limit=word_limit,
        ollama_model=ollama_model,
        cpu_threads=cpu_threads or stored.get("cpu_threads") or settings.whisper_cpu_threads,
        compute_type=compute_type or stored.get("compute_type") or settings.whisper_compute_type,
        beam_size=beam_size if beam_size is not None else stored.get("beam_size"),
        best_of=best_of if best_of is not None else stored.get("best_of"),
        temperature=temperature if temperature is not None else stored.get("temperature"),
        vad_filter=vad_filter if vad_filter is not None else stored.get("vad_filter"),
        device_type=device_type if device_type is not None else stored.get("device_type"),
        subtitle_correction_enabled=subtitle_correction_enabled if subtitle_correction_enabled is not None else stored.get("subtitle_correction_enabled"),
        subtitle_correction_scope=resolved_correction_scope,
        subtitle_correction_prompt=(subtitle_correction_prompt.strip() if subtitle_correction_prompt else stored.get("subtitle_correction_prompt") or None),
    )


def _apply_job_options(job: AiJob, options: AiJobOptions) -> None:
    job.whisper_engine = options.whisper_engine
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
    job.device_type = options.device_type
    job.subtitle_correction_enabled = options.subtitle_correction_enabled
    job.subtitle_correction_scope = options.subtitle_correction_scope
    job.subtitle_correction_prompt = options.subtitle_correction_prompt


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
    db,
    video_id: int,
    whisper_model: str,
    whisper_engine: str | None = None,
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
    device_type: str | None = None,
    subtitle_correction_enabled: bool | None = None,
    subtitle_correction_scope: str | None = None,
    subtitle_correction_prompt: str | None = None,
) -> AiJob:
    options = _build_job_options(
        whisper_model=whisper_model,
        whisper_engine=whisper_engine,
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
        device_type=device_type,
        subtitle_correction_enabled=subtitle_correction_enabled,
        subtitle_correction_scope=subtitle_correction_scope,
        subtitle_correction_prompt=subtitle_correction_prompt,
    )
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


def create_ai_job_from_payload(db, video_id: int, payload) -> AiJob:
    return create_ai_job(
        db=db,
        video_id=video_id,
        whisper_model=payload.whisper_model,
        whisper_engine=payload.whisper_engine,
        language=payload.language,
        do_summary=payload.do_summary,
        word_limit=payload.word_limit,
        ollama_model=payload.ollama_model,
        cpu_threads=payload.cpu_threads,
        compute_type=payload.compute_type,
        beam_size=payload.beam_size,
        best_of=payload.best_of,
        temperature=payload.temperature,
        vad_filter=payload.vad_filter,
        device_type=payload.device_type,
        subtitle_correction_enabled=payload.subtitle_correction_enabled,
        subtitle_correction_scope=payload.subtitle_correction_scope,
        subtitle_correction_prompt=payload.subtitle_correction_prompt,
    )


def update_job_state(db, job: AiJob, video: Video, **values) -> None:
    # Refresh from DB first: if API/admin already flipped status to cancelled,
    # bail out instead of overwriting that decision with a stale cached object.
    # SessionLocal uses expire_on_commit=False, so without this refresh the worker
    # would silently resurrect cancelled jobs back to running on the next step.
    try:
        db.refresh(job)
    except Exception:
        # Row may have been deleted by clear-all; short-circuit the whole job.
        raise RuntimeError("Job row no longer exists")
    if job.status in ("cancelled", "cancelling"):
        raise RuntimeError("Job cancelled")
    for key, value in values.items():
        setattr(job, key, value)
    job.updated_at = datetime.now()
    if video is not None:
        try:
            db.refresh(video)
        except Exception:
            pass
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


def requeue_interrupted_ai_jobs() -> int:
    """Recover after worker restart:
    - 'running' rows have no live worker → requeue them
    - 'cancelling' rows had a cancel signal but the worker died before finalizing
      → finalize them as 'cancelled' so they don't get stuck forever
    """
    db = SessionLocal()
    try:
        running_jobs = db.query(AiJob).filter(AiJob.status == "running").all()
        cancelling_jobs = db.query(AiJob).filter(AiJob.status == "cancelling").all()
        affected_video_ids = {job.video_id for job in running_jobs} | {job.video_id for job in cancelling_jobs}
        for job in running_jobs:
            job.status = "queued"
            job.stage = "queued"
            job.message = "Requeued after worker restart"
            job.error = None
        for job in cancelling_jobs:
            job.status = "cancelled"
            job.stage = "cancelled"
            job.message = "Cancelled (finalized after worker restart)"
            job.error = "Cancelled by user"
        if affected_video_ids:
            videos = db.query(Video).filter(Video.id.in_(affected_video_ids)).all()
            running_video_ids = {job.video_id for job in running_jobs}
            for video in videos:
                if video.id in running_video_ids:
                    video.ai_status = "queued"
                    video.ai_stage = "queued"
                    video.ai_error = None
                else:
                    video.ai_status = "idle"
                    video.ai_stage = None
                    video.ai_error = None
        if running_jobs or cancelling_jobs:
            db.commit()
        return len(running_jobs) + len(cancelling_jobs)
    finally:
        db.close()


def _step_extract_audio(db, job, video, paths, job_id: str):
    update_job_state(db, job, video, status="running", stage="extracting", message="Extracting audio")
    extract_wav_16k_mono(paths.source, paths.wav, cpu_threads=job.cpu_threads, job_id=job_id)


def _step_transcribe(db, job, video, paths, job_id: str):
    update_job_state(db, job, video, status="running", stage="transcribing", message="Transcribing audio")
    result = transcribe_wav(
        wav_path=paths.wav,
        engine=job.whisper_engine,
        model_size=job.whisper_model,
        language=job.language,
        cpu_threads=job.cpu_threads,
        compute_type=job.compute_type,
        beam_size=job.beam_size,
        best_of=job.best_of,
        temperature=job.temperature,
        vad_filter=job.vad_filter,
        device_type=job.device_type,
        job_id=job_id,
    )
    return result["text"], result["segments"]


def _step_correct_subtitles(db, job, video, transcript, segments):
    should_correct = (
        settings.subtitle_correction_enabled
        if job.subtitle_correction_enabled is None
        else job.subtitle_correction_enabled
    )
    if not should_correct or settings.assistant_llm_provider not in ("openai", "lmstudio") or not segments:
        return transcript, segments, None

    correction_scope = "off" if (job.subtitle_correction_scope or settings.subtitle_correction_scope) == "off" else "full"
    if correction_scope == "off":
        return transcript, segments, None

    update_job_state(db, job, video, status="running", stage="correcting-subtitles", message="Correcting subtitles")
    policy = _llm_usage_policy()
    runtime = _assistant_runtime_settings()

    def correct_with_local(current_segments):
        return correct_segments_with_openai(
            current_segments,
            model=job.ollama_model or runtime["local_model"],
            base_url=runtime["local_base_url"],
            api_key=runtime["local_api_key"],
            batch_size=settings.subtitle_correction_batch_size,
            timeout_s=settings.subtitle_correction_timeout_s,
            extra_prompt=job.subtitle_correction_prompt,
            scope=correction_scope,
        )

    def correct_with_external(current_segments):
        if not _external_llm_ready():
            raise RuntimeError("External LLM is not configured")
        return correct_segments_with_openai(
            current_segments,
            model=runtime["external_model"],
            base_url=runtime["external_base_url"],
            api_key=runtime["external_api_key"],
            batch_size=settings.subtitle_correction_batch_size,
            timeout_s=settings.subtitle_correction_timeout_s,
            extra_prompt=job.subtitle_correction_prompt,
            scope=correction_scope,
        )

    attempts = [("local", correct_with_local), ("external", correct_with_external)]
    if policy == "external_first":
        attempts.reverse()
    elif policy == "local_only":
        attempts = [("local", correct_with_local)]
    elif policy == "external_only":
        attempts = [("external", correct_with_external)]

    errors = []
    try:
        for index, (label, runner) in enumerate(attempts):
            try:
                if index > 0:
                    update_job_state(db, job, video, status="running", stage="correcting-subtitles", message=f"{attempts[index - 1][0]} LLM failed, retrying {label} LLM")
                segments = runner(segments)
                break
            except Exception as exc:
                errors.append(f"{label} failed: {exc}")
        else:
            raise RuntimeError(" | ".join(errors))
        transcript = "\n".join((s.get("text") or "").strip() for s in segments).strip()
        return transcript, segments, None
    except Exception as exc:
        return transcript, segments, f"字幕校对失败，已保留原字幕：{exc}"


def _step_summarize(db, job, video, transcript):
    if not job.do_summary:
        return None, None

    update_job_state(db, job, video, status="running", stage="summarizing", message="Summarizing content")
    policy = _llm_usage_policy()
    runtime = _assistant_runtime_settings()
    errors = []
    try:
        def summarize_with_local():
            if settings.assistant_llm_provider in ("openai", "lmstudio"):
                return summarize_with_openai(
                    transcript=transcript,
                    word_limit=job.word_limit,
                    model=job.ollama_model or runtime["local_model"],
                    base_url=runtime["local_base_url"],
                    api_key=runtime["local_api_key"],
                )
            return summarize_with_ollama(
                transcript=transcript,
                word_limit=job.word_limit,
                model=job.ollama_model or settings.ollama_model,
                base_url=settings.ollama_base_url,
            )

        def summarize_with_external():
            if not _external_llm_ready():
                raise RuntimeError("External LLM is not configured")
            return summarize_with_openai(
                transcript=transcript,
                word_limit=job.word_limit,
                model=runtime["external_model"],
                base_url=runtime["external_base_url"],
                api_key=runtime["external_api_key"],
            )

        attempts = [("local", summarize_with_local), ("external", summarize_with_external)]
        if policy == "external_first":
            attempts.reverse()
        elif policy == "local_only":
            attempts = [("local", summarize_with_local)]
        elif policy == "external_only":
            attempts = [("external", summarize_with_external)]

        summary = None
        for index, (label, runner) in enumerate(attempts):
            try:
                if index > 0:
                    update_job_state(db, job, video, status="running", stage="summarizing", message=f"{attempts[index - 1][0]} LLM failed, retrying {label} LLM")
                summary = runner()
                break
            except Exception as exc:
                errors.append(f"{label} failed: {exc}")
        if summary is None:
            raise RuntimeError(" | ".join(errors))
        return summary, None
    except Exception as exc:
        if errors:
            return None, " | ".join([*errors, f"external fallback failed: {exc}"])
        return None, str(exc)


def _step_write_outputs(db, job, video, paths, transcript, segments, summary, summary_error):
    update_job_state(db, job, video, status="running", stage="writing", message="Writing markdown and subtitles")

    write_vtt_output(paths.subtitle, segments)
    replace_subtitle_segments(db, video, segments)

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


def _finalize_job(db, job, video, paths, transcript, segments, summary, summary_error):
    # Defensive: if API/admin flipped status to cancelled/cancelling while we were
    # still in summarize/write-outputs, do NOT resurrect the row to "completed".
    try:
        db.refresh(job)
    except Exception:
        return  # row deleted by clear-all; skip silently
    if job.status in ("cancelled", "cancelling"):
        raise RuntimeError("Job cancelled")
    try:
        db.refresh(video)
    except Exception:
        video = None
    if video is not None:
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
    job.transcript = transcript
    job.transcript_segments = dump_segments(segments)
    job.summary = summary
    job.summary_error = summary_error
    job.markdown_path = str(paths.markdown)
    job.subtitle_path = str(paths.subtitle)
    db.commit()


def _handle_job_failure(db, job_id, exc):
    # Use a fresh session-local rollback so any half-aborted state doesn't poison
    # the upcoming writes. The caller's session may already be in a bad state
    # after an update_job_state("cancelled") refresh-then-raise.
    try:
        db.rollback()
    except Exception:
        pass
    job = db.query(AiJob).filter(AiJob.id == job_id).first()
    if not job:
        return  # row deleted by clear-all; nothing to finalize
    video = db.query(Video).filter(Video.id == job.video_id).first()

    exc_str = str(exc)
    cancelled = (
        exc_str in ("Job cancelled", "Job row no longer exists")
        or (job is not None and job.status in ("cancelled", "cancelling"))
    )
    if cancelled:
        if video:
            video.ai_status = "idle"
            video.ai_stage = None
            video.ai_error = None
        job.status = "cancelled"
        job.stage = "cancelled"
        job.message = "Cancelled by user"
        job.error = "Cancelled by user"
        db.commit()
        return
    if video:
        video.ai_status = "failed"
        video.ai_stage = job.stage
        video.ai_error = exc_str
    job.status = "failed"
    job.error = exc_str
    job.message = exc_str
    db.commit()


