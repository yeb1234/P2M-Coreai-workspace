from pathlib import Path
import json
import shutil
from datetime import datetime, timedelta

from fastapi import APIRouter
import requests
from sqlalchemy import and_, or_, text

from app.database import SessionLocal, engine, settings
from app.models import AiJob, AppSetting, Video
from app.schemas import AssistantRuntimeSettingsIn, AssistantRuntimeSettingsOut, RescanOut, TranscriptionSettingsIn, TranscriptionSettingsOut
from app.services.ai_queue import is_queue_paused, pause_queue, resume_queue
from app.services.file_scanner import generate_missing_thumbnails, generate_thumbnail, scan_video_library
from app.services.llm_client import OllamaClient, OpenAICompatibleClient
from app.services.prompts import SUBTITLE_CORRECTION_DEFAULT


router = APIRouter(prefix="/api/admin", tags=["admin"])

WHISPER_MODEL_FILES = {
    "tiny": "ggml-tiny.bin",
    "base": "ggml-base.bin",
    "small": "ggml-small.bin",
    "medium": "ggml-medium.bin",
    "large": "ggml-large.bin",
    "large-v3": "ggml-large-v3.bin",
}

TRANSCRIPTION_SETTINGS_KEY = "transcription_settings"
ASSISTANT_RUNTIME_SETTINGS_KEY = "assistant_runtime_settings"
DEFAULT_SUBTITLE_CORRECTION_PROMPT = SUBTITLE_CORRECTION_DEFAULT
LLM_USAGE_POLICIES = {"local_first", "external_first", "local_only", "external_only"}


def _normalize_openai_base_url(value: str) -> str:
    trimmed = value.strip().rstrip("/")
    if trimmed.endswith("/v1/chat/completions"):
        return trimmed[: -len("/chat/completions")]
    if trimmed.endswith("/chat/completions"):
        return trimmed[: -len("/chat/completions")]
    return trimmed


def _default_assistant_runtime_settings() -> dict:
    return {
        "local_base_url": settings.openai_base_url,
        "local_api_key": settings.openai_api_key,
        "local_model": settings.openai_model,
        "external_base_url": settings.external_llm_base_url,
        "external_api_key": settings.external_llm_api_key,
        "external_model": settings.external_llm_model,
        "llm_usage_policy": settings.llm_usage_policy if settings.llm_usage_policy in LLM_USAGE_POLICIES else "local_first",
    }


def _coerce_assistant_runtime_settings(raw: dict | None = None) -> dict:
    data = {**_default_assistant_runtime_settings(), **(raw or {})}
    data["local_base_url"] = _normalize_openai_base_url(str(data.get("local_base_url") or ""))
    data["local_api_key"] = str(data.get("local_api_key") or "")
    data["local_model"] = str(data.get("local_model") or "").strip()
    data["external_base_url"] = _normalize_openai_base_url(str(data.get("external_base_url") or ""))
    data["external_api_key"] = str(data.get("external_api_key") or "")
    data["external_model"] = str(data.get("external_model") or "").strip()
    data["llm_usage_policy"] = data["llm_usage_policy"] if data.get("llm_usage_policy") in LLM_USAGE_POLICIES else "local_first"
    return data


def load_assistant_runtime_settings() -> dict:
    db = SessionLocal()
    try:
        row = db.query(AppSetting).filter(AppSetting.key == ASSISTANT_RUNTIME_SETTINGS_KEY).first()
        if not row:
            return _coerce_assistant_runtime_settings()
        try:
            return _coerce_assistant_runtime_settings(json.loads(row.value))
        except Exception:
            return _coerce_assistant_runtime_settings()
    finally:
        db.close()


def _default_transcription_settings() -> dict:
    return {
        "whisper_engine": settings.whisper_engine,
        "whisper_model": settings.default_whisper_model,
        "language": settings.default_language,
        "do_summary": True,
        "word_limit": 200,
        "cpu_threads": settings.whisper_cpu_threads,
        "compute_type": settings.whisper_compute_type,
        "beam_size": settings.whisper_beam_size,
        "best_of": settings.whisper_best_of,
        "temperature": settings.whisper_temperature,
        "vad_filter": settings.whisper_vad_filter,
        "subtitle_correction_enabled": settings.subtitle_correction_enabled,
        "subtitle_correction_scope": "off" if settings.subtitle_correction_scope == "off" else "full",
        "subtitle_correction_prompt": DEFAULT_SUBTITLE_CORRECTION_PROMPT,
        "llm_usage_policy": settings.llm_usage_policy if settings.llm_usage_policy in LLM_USAGE_POLICIES else "local_first",
    }


def _coerce_transcription_settings(raw: dict | None = None) -> dict:
    data = {**_default_transcription_settings(), **(raw or {})}
    data["whisper_engine"] = data["whisper_engine"] if data["whisper_engine"] in {"faster-whisper", "whisper.cpp"} else settings.whisper_engine
    data["whisper_model"] = data["whisper_model"] if data["whisper_model"] in WHISPER_MODEL_FILES else settings.default_whisper_model
    data["language"] = str(data.get("language") or settings.default_language)
    data["do_summary"] = bool(data.get("do_summary"))
    data["word_limit"] = max(50, min(2000, int(data.get("word_limit") or 200)))
    data["cpu_threads"] = max(1, min(128, int(data.get("cpu_threads") or settings.whisper_cpu_threads)))
    data["compute_type"] = str(data.get("compute_type") or settings.whisper_compute_type).strip() or settings.whisper_compute_type
    data["beam_size"] = max(1, min(10, int(data.get("beam_size") or settings.whisper_beam_size)))
    data["best_of"] = max(1, min(10, int(data.get("best_of") or settings.whisper_best_of)))
    data["temperature"] = max(0.0, min(1.0, float(data.get("temperature") if data.get("temperature") is not None else settings.whisper_temperature)))
    data["vad_filter"] = bool(data.get("vad_filter"))
    data["subtitle_correction_enabled"] = bool(data.get("subtitle_correction_enabled"))
    data["subtitle_correction_scope"] = "off" if data.get("subtitle_correction_scope") == "off" else "full"
    data["llm_usage_policy"] = data["llm_usage_policy"] if data.get("llm_usage_policy") in LLM_USAGE_POLICIES else "local_first"
    prompt = str(data.get("subtitle_correction_prompt") or DEFAULT_SUBTITLE_CORRECTION_PROMPT)
    if "????" in prompt or "\u5fd9" in prompt or "\ufffd" in prompt or "\u00e6" in prompt or "\u929d" in prompt:
        prompt = DEFAULT_SUBTITLE_CORRECTION_PROMPT
    data["subtitle_correction_prompt"] = prompt
    return data


def load_transcription_settings() -> dict:
    db = SessionLocal()
    try:
        row = db.query(AppSetting).filter(AppSetting.key == TRANSCRIPTION_SETTINGS_KEY).first()
        if not row:
            return _coerce_transcription_settings()
        try:
            return _coerce_transcription_settings(json.loads(row.value))
        except Exception:
            return _coerce_transcription_settings()
    finally:
        db.close()


def _save_transcription_settings(data: dict) -> dict:
    normalized = _coerce_transcription_settings(data)
    db = SessionLocal()
    try:
        row = db.query(AppSetting).filter(AppSetting.key == TRANSCRIPTION_SETTINGS_KEY).first()
        value = json.dumps(normalized, ensure_ascii=False)
        if row:
            row.value = value
        else:
            db.add(AppSetting(key=TRANSCRIPTION_SETTINGS_KEY, value=value))
        db.commit()
        return normalized
    finally:
        db.close()


def _health_item(name: str, ok: bool, message: str, details: dict | None = None) -> dict:
    return {
        "name": name,
        "ok": ok,
        "message": message,
        "details": details or {},
    }


def _check_http_json(name: str, url: str, timeout_s: float = 2.0) -> dict:
    try:
        response = requests.get(url, timeout=timeout_s)
        if response.status_code == 200:
            return _health_item(name, True, "连接正常", {"url": url})
        return _health_item(name, False, f"HTTP {response.status_code}", {"url": url})
    except Exception as exc:
        return _health_item(name, False, str(exc), {"url": url})


def _probe_llm_contexts() -> dict:
    probes = {}
    for key, label, runner in (
        (
            "local_openai",
            "LM Studio / OpenAI 兼容接口",
            lambda: OpenAICompatibleClient(
                base_url=settings.openai_base_url,
                api_key=settings.openai_api_key,
                timeout_s=3,
            ).model_context_length(settings.openai_model),
        ),
        (
            "external_openai",
            "外部网络 LLM",
            lambda: OpenAICompatibleClient(
                base_url=settings.external_llm_base_url,
                api_key=settings.external_llm_api_key,
                timeout_s=3,
            ).model_context_length(settings.external_llm_model),
        ),
        (
            "ollama",
            "Ollama",
            lambda: OllamaClient(base_url=settings.ollama_base_url, timeout_s=3).model_context_length(settings.ollama_model),
        ),
    ):
        try:
            context_length, raw = runner()
            probes[key] = {
                "name": label,
                "context_length": context_length,
                "message": f"探测到 {context_length} tokens" if context_length else "模型接口未返回上下文字段",
                "raw_keys": sorted(raw.keys())[:20] if isinstance(raw, dict) else [],
            }
        except Exception as exc:
            probes[key] = {
                "name": label,
                "context_length": None,
                "message": str(exc),
                "raw_keys": [],
            }
    return probes


@router.post("/rescan", response_model=RescanOut)
def rescan_library():
    result = scan_video_library()
    generate_missing_thumbnails(limit=3)
    return RescanOut(**result)


@router.post("/generate-thumbnails")
def generate_thumbnails_for_ids(payload: dict):
    video_ids = payload.get("video_ids", [])
    if not video_ids:
        return {"generated": 0, "total": 0, "pending": 0}
    db = SessionLocal()
    try:
        # Filter to videos that actually need thumbnails
        videos = db.query(Video).filter(Video.id.in_(video_ids), Video.thumbnail.is_(None)).all()
        pending = len(videos)
        if pending == 0:
            return {"generated": 0, "total": len(video_ids), "pending": 0}
        # Process in background thread
        def _generate():
            gen_db = SessionLocal()
            try:
                vids = gen_db.query(Video).filter(Video.id.in_([v.id for v in videos])).all()
                for v in vids:
                    if v.thumbnail:
                        continue
                    result = generate_thumbnail(v.filepath, v.id)
                    if result:
                        v.thumbnail = result
                gen_db.commit()
            except Exception:
                gen_db.rollback()
            finally:
                gen_db.close()
        import threading
        threading.Thread(target=_generate, daemon=True).start()
        return {"generated": 0, "total": len(video_ids), "pending": pending}
    finally:
        db.close()


@router.get("/whisper-models")
def whisper_models():
    model_dir = Path(settings.whisper_cpp_model).parent if settings.whisper_cpp_model else Path(settings.work_dir).parent / "tools" / "models" / "whisper"
    items = []
    for model_id, filename in WHISPER_MODEL_FILES.items():
        path = model_dir / filename
        items.append({
            "id": model_id,
            "filename": filename,
            "installed": path.exists(),
            "path": str(path),
            "size": path.stat().st_size if path.exists() else None,
        })
    return {
        "model_dir": str(model_dir),
        "items": items,
    }


@router.get("/transcription-settings", response_model=TranscriptionSettingsOut)
def get_transcription_settings():
    return TranscriptionSettingsOut(**load_transcription_settings())


@router.put("/transcription-settings", response_model=TranscriptionSettingsOut)
def save_transcription_settings(payload: TranscriptionSettingsIn):
    current = load_transcription_settings()
    updates = payload.model_dump(exclude_unset=True)
    next_settings = _save_transcription_settings({**current, **updates})
    if "llm_usage_policy" in updates:
        runtime = load_assistant_runtime_settings()
        _save_assistant_runtime_settings({**runtime, "llm_usage_policy": next_settings["llm_usage_policy"]})
    return TranscriptionSettingsOut(**next_settings)


@router.get("/assistant-settings", response_model=AssistantRuntimeSettingsOut)
def get_assistant_runtime_settings():
    return AssistantRuntimeSettingsOut(**load_assistant_runtime_settings())


@router.put("/assistant-settings", response_model=AssistantRuntimeSettingsOut)
def save_assistant_runtime_settings(payload: AssistantRuntimeSettingsIn):
    current = load_assistant_runtime_settings()
    updates = payload.model_dump(exclude_unset=True)
    next_settings = _save_assistant_runtime_settings({**current, **updates})
    if "llm_usage_policy" in updates:
        transcription = load_transcription_settings()
        _save_transcription_settings({**transcription, "llm_usage_policy": next_settings["llm_usage_policy"]})
    return AssistantRuntimeSettingsOut(**next_settings)


def _save_assistant_runtime_settings(data: dict) -> dict:
    next_settings = _coerce_assistant_runtime_settings(data)
    db = SessionLocal()
    try:
        row = db.query(AppSetting).filter(AppSetting.key == ASSISTANT_RUNTIME_SETTINGS_KEY).first()
        value = json.dumps(next_settings, ensure_ascii=False)
        if row:
            row.value = value
            row.updated_at = datetime.now()
        else:
            db.add(AppSetting(key=ASSISTANT_RUNTIME_SETTINGS_KEY, value=value, updated_at=datetime.now()))
        db.commit()
        return next_settings
    finally:
        db.close()


@router.get("/health")
def backend_health():
    checks = []

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        checks.append(_health_item("数据库", True, "SQLite 连接正常", {"url": settings.database_url}))
    except Exception as exc:
        checks.append(_health_item("数据库", False, str(exc), {"url": settings.database_url}))

    for name, folder in (
        ("视频目录", settings.video_folder),
        ("输出目录", settings.output_dir),
        ("工作目录", settings.work_dir),
        ("缩略图目录", settings.thumbnail_dir),
        ("雪碧图目录", settings.sprite_dir),
    ):
        path = Path(folder)
        checks.append(_health_item(name, path.exists(), "可访问" if path.exists() else "目录不存在", {"path": str(path)}))

    ffmpeg_path = shutil.which("ffmpeg")
    ffprobe_path = shutil.which("ffprobe")
    checks.append(_health_item("ffmpeg", bool(ffmpeg_path), "已找到" if ffmpeg_path else "未找到，请确认 PATH", {"path": ffmpeg_path or ""}))
    checks.append(_health_item("ffprobe", bool(ffprobe_path), "已找到" if ffprobe_path else "未找到，请确认 PATH", {"path": ffprobe_path or ""}))

    whisper_cpp_exe = Path(settings.whisper_cpp_exe) if settings.whisper_cpp_exe else None
    whisper_cpp_model = Path(settings.whisper_cpp_model) if settings.whisper_cpp_model else None
    checks.append(_health_item(
        "whisper.cpp 可执行文件",
        bool(whisper_cpp_exe and whisper_cpp_exe.exists()),
        "已配置" if whisper_cpp_exe and whisper_cpp_exe.exists() else "未配置或文件不存在",
        {"path": str(whisper_cpp_exe or ""), "extra_args": settings.whisper_cpp_extra_args},
    ))
    checks.append(_health_item(
        "whisper.cpp 模型",
        bool(whisper_cpp_model and whisper_cpp_model.exists()),
        "已配置" if whisper_cpp_model and whisper_cpp_model.exists() else "未配置或文件不存在",
        {"path": str(whisper_cpp_model or "")},
    ))

    checks.append(_check_http_json("LM Studio / OpenAI 兼容接口", settings.openai_base_url.rstrip("/") + "/models"))
    checks.append(_check_http_json("Ollama", settings.ollama_base_url.rstrip("/") + "/api/tags"))
    context_probes = _probe_llm_contexts()
    detected = [item["context_length"] for item in context_probes.values() if item.get("context_length")]
    checks.append(_health_item(
        "LLM 上下文窗口",
        True,
        f"当前总结压缩按 {settings.llm_context_token_limit} tokens 配置值计算",
        {
            "configured_context_token_limit": settings.llm_context_token_limit,
            "compression_starts_at_percent": 90,
            "detected_context_token_limits": detected,
            "probes": context_probes,
        },
    ))

    db = SessionLocal()
    try:
        queued = db.query(AiJob).filter(AiJob.status == "queued").count()
        running = db.query(AiJob).filter(AiJob.status == "running").count()
        failed = db.query(AiJob).filter(AiJob.status == "failed").count()
        videos = db.query(Video).count()
        checks.append(_health_item(
            "AI 队列",
            True,
            f"运行 {running}，排队 {queued}，失败 {failed}",
            {
                "running": running,
                "queued": queued,
                "failed": failed,
                "worker_concurrency": settings.ai_worker_concurrency,
                "paused": is_queue_paused(),
            },
        ))
        checks.append(_health_item("视频库", True, f"{videos} 个视频", {"videos": videos}))
    finally:
        db.close()

    checks.append(_health_item(
        "转写默认配置",
        True,
        (
            f"{settings.default_whisper_model} / whisper.cpp GPU/外部引擎"
        )
        if settings.whisper_engine == "whisper.cpp"
        else f"{settings.default_whisper_model} / {settings.whisper_cpu_threads} 个 CPU 转写线程 / {settings.whisper_compute_type}",
        {
            "model": settings.default_whisper_model,
            "language": settings.default_language,
            "cpu_threads": None if settings.whisper_engine == "whisper.cpp" else settings.whisper_cpu_threads,
            "thread_role": "GPU/external whisper.cpp transcription; cpu_threads is ignored" if settings.whisper_engine == "whisper.cpp" else "faster-whisper CPU transcription threads",
            "subtitle_correction_runtime": "LM Studio/OpenAI-compatible API; GPU/CPU placement is decided by the LLM server",
            "compute_type": settings.whisper_compute_type,
            "subtitle_correction_enabled": settings.subtitle_correction_enabled,
            "thumbnail_background_enabled": settings.thumbnail_background_enabled,
            "whisper_engine": settings.whisper_engine,
            "whisper_cpp_exe": settings.whisper_cpp_exe,
            "whisper_cpp_model": settings.whisper_cpp_model,
        },
    ))

    ok = all(item["ok"] for item in checks if item["name"] not in ("LM Studio / OpenAI 兼容接口", "Ollama"))
    return {
        "ok": ok,
        "checks": checks,
    }


@router.get("/ai-jobs/queue")
def ai_queue_state():
    db = SessionLocal()
    try:
        return {
            "paused": is_queue_paused(),
            "running": db.query(AiJob).filter(AiJob.status == "running").count(),
            "queued": db.query(AiJob).filter(AiJob.status == "queued").count(),
            "failed": db.query(AiJob).filter(AiJob.status == "failed").count(),
            "completed": db.query(AiJob).filter(AiJob.status == "completed").count(),
        }
    finally:
        db.close()


@router.post("/ai-jobs/clear-queued")
def clear_queued_ai_jobs():
    db = SessionLocal()
    try:
        jobs = db.query(AiJob).filter(AiJob.status == "queued").all()
        video_ids = {job.video_id for job in jobs}
        for job in jobs:
            job.status = "cancelled"
            job.stage = "cancelled"
            job.message = "Cancelled before processing"
            job.error = "Cancelled before processing"
        if video_ids:
            videos = db.query(Video).filter(Video.id.in_(video_ids)).all()
            for video in videos:
                if video.ai_status == "queued":
                    video.ai_status = "idle"
                    video.ai_stage = None
                    video.ai_error = None
        db.commit()
        return {"cleared": len(jobs)}
    finally:
        db.close()


@router.post("/ai-jobs/recover-stuck")
def recover_stuck_ai_jobs(minutes: int = 60, correction_minutes: int = 15, force: bool = False):
    stale_minutes = max(5, min(minutes, 24 * 60))
    correction_stale_minutes = max(5, min(correction_minutes, stale_minutes))
    now = datetime.now()
    cutoff = now - timedelta(minutes=stale_minutes)
    correction_cutoff = now - timedelta(minutes=correction_stale_minutes)
    db = SessionLocal()
    try:
        jobs = (
            db.query(AiJob)
            .filter(
                AiJob.status == "running",
                or_(
                    force,
                    and_(AiJob.stage == "correcting-subtitles", AiJob.updated_at < correction_cutoff),
                    and_(
                        or_(AiJob.stage != "correcting-subtitles", AiJob.stage.is_(None)),
                        AiJob.updated_at < cutoff,
                    ),
                ),
            )
            .all()
        )
        for job in jobs:
            was_correcting_subtitles = job.stage == "correcting-subtitles"
            video = db.query(Video).filter(Video.id == job.video_id).first()
            job.status = "queued"
            job.stage = "queued"
            job.message = "Recovered from stale subtitle correction state" if was_correcting_subtitles else "Recovered from stale running state"
            job.error = None
            if video:
                video.ai_status = "queued"
                video.ai_stage = "queued"
                video.ai_error = None
        if jobs:
            db.commit()
        return {
            "recovered": len(jobs),
            "cutoff_minutes": stale_minutes,
            "correction_cutoff_minutes": correction_stale_minutes,
        }
    finally:
        db.close()


@router.post("/ai-jobs/pause")
def pause_ai_queue():
    pause_queue()
    return {"paused": True}


@router.post("/ai-jobs/resume")
def resume_ai_queue():
    resume_queue()
    return {"paused": False}


@router.post("/ai-jobs/{job_id}/cancel")
def cancel_ai_job(job_id: str):
    db = SessionLocal()
    try:
        job = db.query(AiJob).filter(AiJob.id == job_id).first()
        if not job:
            return {"cancelled": False, "reason": "not_found"}
        if job.status not in ("queued", "running"):
            return {"cancelled": False, "reason": "not_active"}
        video = db.query(Video).filter(Video.id == job.video_id).first()
        job.status = "cancelled"
        job.stage = "cancelled"
        job.message = "Cancelled by user"
        job.error = "Cancelled by user"
        if video:
            video.ai_status = "idle"
            video.ai_stage = None
            video.ai_error = None
        db.commit()
        return {"cancelled": True}
    finally:
        db.close()


@router.post("/ai-jobs/{job_id}/resume")
def resume_ai_job(job_id: str):
    db = SessionLocal()
    try:
        job = db.query(AiJob).filter(AiJob.id == job_id).first()
        if not job:
            return {"resumed": False, "reason": "not_found"}
        existing_active = (
            db.query(AiJob)
            .filter(AiJob.video_id == job.video_id, AiJob.id != job.id, AiJob.status.in_(("queued", "running")))
            .first()
        )
        if existing_active:
            return {"resumed": False, "reason": "active_job", "job_id": existing_active.id}
        video = db.query(Video).filter(Video.id == job.video_id).first()
        if not video:
            return {"resumed": False, "reason": "missing_video"}

        job.status = "queued"
        job.stage = "queued"
        job.message = "Resumed by user"
        job.error = None
        video.ai_status = "queued"
        video.ai_stage = "queued"
        video.ai_error = None
        db.commit()
        return {"resumed": True, "job_id": job.id}
    finally:
        db.close()


@router.post("/ai-jobs/sync-queued-settings")
def sync_queued_ai_job_settings():
    current = load_transcription_settings()
    db = SessionLocal()
    try:
        jobs = db.query(AiJob).filter(AiJob.status == "queued").all()
        for job in jobs:
            job.whisper_engine = current["whisper_engine"]
            job.whisper_model = current["whisper_model"]
            job.language = current["language"]
            job.do_summary = current["do_summary"]
            job.word_limit = current["word_limit"]
            job.cpu_threads = None if current["whisper_engine"] == "whisper.cpp" else current["cpu_threads"]
            job.compute_type = current["compute_type"]
            job.beam_size = current["beam_size"]
            job.best_of = current["best_of"]
            job.temperature = current["temperature"]
            job.vad_filter = current["vad_filter"]
            job.subtitle_correction_enabled = current["subtitle_correction_enabled"]
            job.subtitle_correction_scope = "off" if current["subtitle_correction_scope"] == "off" else "full"
            job.subtitle_correction_prompt = current["subtitle_correction_prompt"] or None
            job.message = "Queued with current transcription settings"
            job.error = None
            job.updated_at = datetime.now()
        db.commit()
        return {"updated": len(jobs)}
    finally:
        db.close()


@router.post("/ai-jobs/clear-active")
def clear_active_ai_jobs():
    db = SessionLocal()
    try:
        jobs = db.query(AiJob).filter(AiJob.status.in_(("queued", "running"))).all()
        video_ids = {job.video_id for job in jobs}
        for job in jobs:
            job.status = "cancelled"
            job.stage = "cancelled"
            job.message = "Cancelled by user"
            job.error = "Cancelled by user"
        if video_ids:
            videos = db.query(Video).filter(Video.id.in_(video_ids)).all()
            for video in videos:
                video.ai_status = "idle"
                video.ai_stage = None
                video.ai_error = None
        db.commit()
        return {"cleared": len(jobs)}
    finally:
        db.close()


@router.post("/ai-jobs/clear-history")
def clear_finished_ai_jobs():
    db = SessionLocal()
    try:
        jobs = db.query(AiJob).filter(AiJob.status.in_(("completed", "failed", "cancelled"))).all()
        count = len(jobs)
        for job in jobs:
            db.delete(job)
        db.commit()
        return {"cleared": count}
    finally:
        db.close()


@router.post("/ai-jobs/clear-completed")
def clear_completed_ai_jobs():
    db = SessionLocal()
    try:
        jobs = db.query(AiJob).filter(AiJob.status == "completed").all()
        count = len(jobs)
        for job in jobs:
            db.delete(job)
        db.commit()
        return {"cleared": count}
    finally:
        db.close()


@router.post("/ai-jobs/clear-all")
def clear_all_ai_jobs():
    db = SessionLocal()
    try:
        jobs = db.query(AiJob).all()
        video_ids = {job.video_id for job in jobs}
        count = len(jobs)
        for job in jobs:
            if job.status == "running":
                job.status = "cancelled"
                job.stage = "cancelled"
                job.message = "Cancelled by clear all"
                job.error = "Cancelled by clear all"
            else:
                db.delete(job)
        if video_ids:
            videos = db.query(Video).filter(Video.id.in_(video_ids)).all()
            for video in videos:
                if video.ai_status in ("queued", "running", "failed", "cancelled"):
                    video.ai_status = "idle"
                    video.ai_stage = None
                    video.ai_error = None
        db.commit()
        return {"cleared": count}
    finally:
        db.close()
