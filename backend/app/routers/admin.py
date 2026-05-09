from pathlib import Path
import shutil

from fastapi import APIRouter
import requests
from sqlalchemy import text

from app.database import SessionLocal, engine, settings
from app.models import AiJob, Video
from app.schemas import RescanOut
from app.services.file_scanner import generate_missing_thumbnails, scan_video_library


router = APIRouter(prefix="/api/admin", tags=["admin"])


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


@router.post("/rescan", response_model=RescanOut)
def rescan_library():
    result = scan_video_library()
    generate_missing_thumbnails(limit=3)
    return RescanOut(**result)


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

    checks.append(_check_http_json("LM Studio / OpenAI 兼容接口", settings.openai_base_url.rstrip("/") + "/models"))
    checks.append(_check_http_json("Ollama", settings.ollama_base_url.rstrip("/") + "/api/tags"))

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
            },
        ))
        checks.append(_health_item("视频库", True, f"{videos} 个视频", {"videos": videos}))
    finally:
        db.close()

    checks.append(_health_item(
        "转写默认配置",
        True,
        f"{settings.default_whisper_model} / {settings.whisper_cpu_threads} 线程 / {settings.whisper_compute_type}",
        {
            "model": settings.default_whisper_model,
            "language": settings.default_language,
            "cpu_threads": settings.whisper_cpu_threads,
            "compute_type": settings.whisper_compute_type,
            "subtitle_correction_enabled": settings.subtitle_correction_enabled,
            "thumbnail_background_enabled": settings.thumbnail_background_enabled,
        },
    ))

    ok = all(item["ok"] for item in checks if item["name"] not in ("LM Studio / OpenAI 兼容接口", "Ollama"))
    return {
        "ok": ok,
        "checks": checks,
    }


@router.post("/ai-jobs/clear-active")
def clear_active_ai_jobs():
    db = SessionLocal()
    try:
        jobs = db.query(AiJob).filter(AiJob.status.in_(("queued", "running"))).all()
        video_ids = {job.video_id for job in jobs}
        for job in jobs:
            job.status = "failed"
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
