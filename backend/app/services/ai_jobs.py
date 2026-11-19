from __future__ import annotations

import logging
import os
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
from app.utils.files import resolve_media_path, safe_stem, unique_suffix
from app.utils.serialization import dump_segments

logger = logging.getLogger(__name__)


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
    override = (os.getenv("LLM_USAGE_POLICY_OVERRIDE") or "").strip()
    if override in {"local_first", "external_first", "local_only", "external_only"}:
        return override
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


def _wav_cache_dir() -> Path:
    """音频临时 WAV 的落盘目录。

    CPU 预提取和 GPU 转写必须看到同一个目录；优先用 SSD 缓存目录，
    没配时兼容旧部署回退到 work_dir。
    """
    return Path(settings.audio_cache_dir or settings.work_dir)


def _build_job_paths(video: Video, job: AiJob) -> AiJobPaths:
    # 容器内视频挂载在 /videos，数据库存的是宿主机绝对路径，需要映射
    source_path = resolve_media_path(video.filepath)
    base_name = safe_stem(source_path.stem) or f"video-{video.id}"
    return AiJobPaths(
        source=source_path,
        wav=_wav_cache_dir() / f"{base_name}-{job.id}.wav",
        markdown=Path(settings.output_dir) / "notes" / f"{base_name}-{job.id}.md",
        subtitle=Path(settings.output_dir) / "subtitles" / f"{base_name}-{job.id}.vtt",
    )


def _video_has_transcription_outputs(video: Video) -> bool:
    """Check if a video already has completed transcription outputs on disk.

    Uses the stored paths (video.markdown_path / video.subtitle_path)
    rather than rebuilding from a specific job ID, so recovered old jobs
    still correctly detect existing outputs.
    """
    if not video.transcription:
        return False
    md_path = video.markdown_path and resolve_media_path(video.markdown_path)
    sub_path = video.subtitle_path and resolve_media_path(video.subtitle_path)
    return bool(md_path and md_path.exists() and sub_path and sub_path.exists())


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
        # 单点重新生成时，把已有 queued 任务的 created_at 刷新到当前时间
        # 使其在 DB 排序中排在最前面
        if existing_job.status == "queued":
            existing_job.created_at = datetime.now()
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
    """取该视频的**共享**笔记，没有就建一条。

    scope 过滤不是可有可无的：

    1. 用户可以在同一视频下写私有笔记（notes.py 的 create_note 会写
       video_id + user_id + scope=private）。如果不限定 shared，
       这里会按 updated_at 降序拿到那条私有笔记，然后
       _step_write_outputs 会用 AI 正文覆盖它的 content / title /
       markdown_path —— 用户的笔记被静默吃掉。
    2. GET /api/videos/{id}/notes 历史上不带鉴权，也会走这个函数，
       于是匿名请求能直接读到别人的私有笔记正文。
    """
    note = (
        db.query(Note)
        .filter(Note.video_id == video.id, Note.scope == "shared")
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
        scope="shared",
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


def requeue_interrupted_ai_jobs(summary_only: bool | None = None) -> int:
    """Recover after worker restart:
    - 'running' rows have no live worker → requeue them
    - 'cancelling' rows had a cancel signal but the worker died before finalizing
      → finalize them as 'cancelled' so they don't get stuck forever

    summary_only=None 表示不分队列；worker 在只消费 ai_jobs 时必须传
    False，否则会把笔记本正在跑的 summary_only 任务也重置成 queued。
    """
    db = SessionLocal()
    try:
        running_query = db.query(AiJob).filter(AiJob.status == "running")
        cancelling_query = db.query(AiJob).filter(AiJob.status == "cancelling")
        if summary_only is not None:
            running_query = running_query.filter(AiJob.summary_only == summary_only)
            cancelling_query = cancelling_query.filter(AiJob.summary_only == summary_only)
        running_jobs = running_query.all()
        cancelling_jobs = cancelling_query.all()
        affected_video_ids = {job.video_id for job in running_jobs} | {job.video_id for job in cancelling_jobs}
        # running 的任务重启后要重新跑。清掉可能残留的取消 flag ——
        # 用户主动取消的 job 状态会是 cancelling（走下面的分支），
        # 留在 running 的说明是 worker 意外死亡，不该带着 flag 重启。
        from app.services.rq_client import clear_job_cancelled

        for job in running_jobs:
            clear_job_cancelled(job.id)
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


def _whisper_direct_media_enabled(job) -> bool:
    """Let faster-whisper decode the source video directly.

    The old pipeline always ran ffmpeg first to write a 16k mono WAV, then read
    that WAV back. For thousands of HDD-backed videos this doubles I/O and
    leaves the GPU idle during extraction. faster-whisper (PyAV) can decode the
    audio track from the source file itself, so direct mode removes that step.
    Whisper.cpp still needs a WAV and keeps the old path.
    """
    if os.getenv("WHISPER_DIRECT_MEDIA", "1") == "0":
        return False
    engine = (job.whisper_engine or settings.whisper_engine or "").strip().lower()
    return engine not in {"whisper.cpp", "whisper_cpp", "whisper-cpp"}


def _step_extract_audio(db, job, video, paths, job_id: str):
    update_job_state(db, job, video, status="running", stage="extracting", message="Extracting audio")
    if _whisper_direct_media_enabled(job):
        logger.info("video=%s direct media decode, skip ffmpeg wav extraction", video.id)
        return
    # CPU 预提取进程会把 WAV 提前放到 SSD 缓存；GPU worker 命中时直接跳过
    # ffmpeg，避免再去读 /videos 所在的 HDD。
    if paths.wav.exists() and paths.wav.stat().st_size > 0:
        logger.info("video=%s audio cache hit -> %s", video.id, paths.wav)
        return
    tmp_path = paths.wav.with_name(f"{paths.wav.name}.{job_id}.part")
    try:
        extract_wav_16k_mono(paths.source, tmp_path, cpu_threads=job.cpu_threads, job_id=job_id)
        os.replace(tmp_path, paths.wav)
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def _step_transcribe(db, job, video, paths, job_id: str):
    update_job_state(db, job, video, status="running", stage="transcribing", message="Transcribing audio")
    audio_path = paths.source if _whisper_direct_media_enabled(job) else paths.wav
    result = transcribe_wav(
        wav_path=audio_path,
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

    transcript = transcript or ""
    if not transcript.strip():
        return None, "转录文本为空，无法生成总结"

    update_job_state(db, job, video, status="running", stage="summarizing", message="Summarizing content")
    policy = _llm_usage_policy()
    runtime = _assistant_runtime_settings()
    local_base_url = (os.getenv("LOCAL_LLM_BASE_URL_OVERRIDE") or "").strip() or runtime["local_base_url"]
    local_model = (os.getenv("LOCAL_LLM_MODEL_OVERRIDE") or "").strip() or job.ollama_model or runtime["local_model"]
    local_api_key = (os.getenv("LOCAL_LLM_API_KEY_OVERRIDE") or "").strip() or runtime["local_api_key"]
    try:
        def summarize_with_local():
            if settings.assistant_llm_provider in ("openai", "lmstudio"):
                return summarize_with_openai(
                    transcript=transcript,
                    word_limit=job.word_limit,
                    model=local_model,
                    base_url=local_base_url,
                    api_key=local_api_key,
                    disable_thinking=True,
                )
            return summarize_with_ollama(
                transcript=transcript,
                word_limit=job.word_limit,
                model=local_model or settings.ollama_model,
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

        # 用 llm.call_with_fallback：每个 provider 内部先按错误类型重试
        # （429/5xx/超时退避重试，401/403/404 立刻换下一个），
        # 原来这里是「失败一次就直接换」，429 时容易一路撞墙。
        from app.services.llm import call_with_fallback

        # 注意签名：call_with_fallback(policy, attempts, ...) 返回 (值, CallMeta)。
        # attempts 传 list 时它尊重调用方给的顺序（上面已按 policy 过滤/排好）。
        summary, meta = call_with_fallback(
            policy,
            attempts,
            retries_per_provider=3,
            base_delay_s=1.0,
        )
        if not isinstance(summary, str):
            summary = str(summary)

        # 降级要让人知道：主通道挂了、是备用救回来的。
        # 不写出来的话，用户只会觉得「这次总结怎么特别慢/质量不一样」。
        note = meta.note()
        if note:
            logger.warning("总结发生降级 video=%s: %s", video.id, note)
            update_job_state(
                db, job, video,
                status="running", stage="summarizing",
                message=note,
            )
        return summary, None
    except Exception as exc:
        # 总结失败不阻塞转写：字幕和转录已经拿到了，只是没总结。
        # 原因用统一的翻译函数，前端能直接显示（而不是 "local: ..., external: ..."）
        logger.exception("总结失败 video=%s job=%s", video.id, job.id)
        return None, humanize_job_error(exc, job)[0]


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
    # 把原始异常翻译成可读原因 + 建议：
    #   job.error   前端直接展示（人话）
    #   job.message 保留原始异常首行（排查用，用户一般看不到）
    reason, advice = humanize_job_error(exc, job)
    readable = f"{reason}\n{advice}"

    if video:
        video.ai_status = "failed"
        video.ai_stage = job.stage
        video.ai_error = readable
    job.status = "failed"
    job.error = readable
    job.message = exc_str.strip().splitlines()[0][:300] if exc_str.strip() else reason
    db.commit()


def humanize_job_error(exc: BaseException | str, job: AiJob | None = None) -> tuple[str, str]:
    """把原始异常翻译成「用户能看懂的原因 + 可操作建议」。

    返回值是 (原因, 建议)。前端直接展示原因，建议放第二行。

    为什么要翻译：RQ 抛的是 JobTimeoutException / OOM 之类的英文类名，
    前端原本直接显示 `JobTimeoutException('...')` 或一长串堆栈，
    用户根本不知道发生了什么、下一步该做什么。
    """
    raw = str(exc)
    lowered = raw.lower()
    stage = (getattr(job, "stage", None) or "").lower()

    # ① 超时
    if "jobtimeoutexception" in lowered or "job timeout" in lowered or "timed out" in lowered:
        stage_label = {
            "extracting": "提取音频",
            "transcribing": "转写字幕",
            "summarizing": "生成总结",
            "writing": "写入文件",
        }.get(stage, "处理")
        return (
            f"{stage_label}阶段超时，任务被强制结束",
            "视频较长或模型较慢时可能超时。可以直接重试；若反复超时，"
            "建议换更小的模型（如 small/int8）或把视频拆段。",
        )

    # ② 内存不足
    if "memoryerror" in lowered or "cannot allocate memory" in lowered or "killed" in lowered:
        return (
            "内存不足，进程被系统终止",
            "建议换更小的模型（small/int8），或先关掉其它占用内存的程序再重试。",
        )

    # ③ 模型不可用
    if "invalid model size" in lowered or ("model" in lowered and "not found" in lowered):
        return (
            "指定的转写模型不可用",
            "检查设置页的模型名称是否正确，或先下载该模型再重试。",
        )
    if "connection" in lowered and ("refused" in lowered or "error" in lowered):
        return (
            "连接模型服务失败",
            "如果是本地模型，确认 LM Studio / Ollama 已启动；"
            "如果是外部服务，检查网络与设置页的地址、API Key。",
        )

    # ④ LLM 余额/配额：这种错等多久都不会恢复，必须和限流区分开
    if any(
        hint in lowered
        for hint in (
            "insufficient_quota", "insufficient quota", "quota exceeded",
            "余额不足", "额度不足", "欠费", "payment required", "billing",
            "credit balance", "out of credits",
        )
    ) or "402" in raw:
        return (
            "LLM 账户额度不足",
            "服务商提示余额或配额已用尽，重试不会恢复；请充值或换一个 API Key 再试。",
        )

    # ⑤ LLM 鉴权/限流
    if "401" in raw or "403" in raw or "unauthorized" in lowered or "invalid api key" in lowered:
        return (
            "LLM 鉴权失败",
            "设置页里的 API Key 可能已失效，重新填写后再试。",
        )
    if "429" in raw or "rate limit" in lowered or "too many requests" in lowered:
        return (
            "LLM 限流（请求过于频繁）",
            "已自动等待重试仍未恢复；等 1-2 分钟再试，批量处理时降低批次数量。",
        )

    # ⑥ 源文件问题
    if "video file does not exist" in lowered or "no such file" in lowered:
        return (
            "找不到视频源文件",
            "确认外接盘已挂载、文件没有被移动或重命名，然后重试。",
        )

    # ⑦ 兜底：保留原始信息但截断，别让前端撑爆
    short = raw.strip().splitlines()[0][:200] if raw.strip() else "未知错误"
    return (short, "可以直接重试；若反复失败，把这条错误码反馈给管理员。")


