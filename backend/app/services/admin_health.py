from pathlib import Path
import shutil

import requests
from sqlalchemy import text

from app.database import SessionLocal, engine, settings
from app.models import AiJob, Video
from app.services.ai_queue import is_queue_paused
from app.services.llm_client import OllamaClient, OpenAICompatibleClient


def health_item(name: str, ok: bool, message: str, details: dict | None = None) -> dict:
    return {
        "name": name,
        "ok": ok,
        "message": message,
        "details": details or {},
    }


def check_http_json(name: str, url: str, timeout_s: float = 2.0) -> dict:
    try:
        response = requests.get(url, timeout=timeout_s)
        if response.status_code == 200:
            return health_item(name, True, "连接正常", {"url": url})
        return health_item(name, False, f"HTTP {response.status_code}", {"url": url})
    except Exception as exc:
        return health_item(name, False, str(exc), {"url": url})


def probe_llm_contexts() -> dict:
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


def backend_health() -> dict:
    checks = []

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        checks.append(health_item("数据库", True, "SQLite 连接正常", {"url": settings.database_url}))
    except Exception as exc:
        checks.append(health_item("数据库", False, str(exc), {"url": settings.database_url}))

    for name, folder in (
        ("视频目录", settings.video_folder),
        ("输出目录", settings.output_dir),
        ("工作目录", settings.work_dir),
        ("缩略图目录", settings.thumbnail_dir),
        ("雪碧图目录", settings.sprite_dir),
    ):
        path = Path(folder)
        checks.append(health_item(name, path.exists(), "可访问" if path.exists() else "目录不存在", {"path": str(path)}))

    ffmpeg_path = shutil.which("ffmpeg")
    ffprobe_path = shutil.which("ffprobe")
    checks.append(health_item("ffmpeg", bool(ffmpeg_path), "已找到" if ffmpeg_path else "未找到，请确认 PATH", {"path": ffmpeg_path or ""}))
    checks.append(health_item("ffprobe", bool(ffprobe_path), "已找到" if ffprobe_path else "未找到，请确认 PATH", {"path": ffprobe_path or ""}))

    whisper_cpp_exe = Path(settings.whisper_cpp_exe) if settings.whisper_cpp_exe else None
    whisper_cpp_model = Path(settings.whisper_cpp_model) if settings.whisper_cpp_model else None
    checks.append(health_item(
        "whisper.cpp 可执行文件",
        bool(whisper_cpp_exe and whisper_cpp_exe.exists()),
        "已配置" if whisper_cpp_exe and whisper_cpp_exe.exists() else "未配置或文件不存在",
        {"path": str(whisper_cpp_exe or ""), "extra_args": settings.whisper_cpp_extra_args},
    ))
    checks.append(health_item(
        "whisper.cpp 模型",
        bool(whisper_cpp_model and whisper_cpp_model.exists()),
        "已配置" if whisper_cpp_model and whisper_cpp_model.exists() else "未配置或文件不存在",
        {"path": str(whisper_cpp_model or "")},
    ))

    checks.append(check_http_json("LM Studio / OpenAI 兼容接口", settings.openai_base_url.rstrip("/") + "/models"))
    checks.append(check_http_json("Ollama", settings.ollama_base_url.rstrip("/") + "/api/tags"))
    context_probes = probe_llm_contexts()
    detected = [item["context_length"] for item in context_probes.values() if item.get("context_length")]
    checks.append(health_item(
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
        checks.append(health_item(
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
        checks.append(health_item("视频库", True, f"{videos} 个视频", {"videos": videos}))
    finally:
        db.close()

    checks.append(health_item(
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
