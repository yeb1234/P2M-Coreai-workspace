from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, wait
import shutil
from typing import Callable

import requests
from sqlalchemy import text

from app.database import SessionLocal, engine, settings
from app.models import Video
from app.services.admin_ai_queue import _is_queue_paused, ai_job_status_counts
from app.services.llm_client import OllamaClient, OpenAICompatibleClient


# 这三个 LLM 探测是互相独立的。以前串行跑，3 个 3 秒超时叠起来，
# 再加上 LM Studio / Ollama 的 HTTP 探测，管理页点一次「检测后端状态」
# 就可能把 60 秒的前端超时耗尽。现在并行探测并给整体预算封顶。
_LLM_PROBE_BUDGET_S = 4.0
_LLM_PROBE_TIMEOUT_S = 3.0
_HTTP_PROBE_TIMEOUT_S = 2.0


def health_item(name: str, ok: bool, message: str, details: dict | None = None) -> dict:
    return {
        "name": name,
        "ok": ok,
        "message": message,
        "details": details or {},
    }


def check_http_json(name: str, url: str, timeout_s: float = _HTTP_PROBE_TIMEOUT_S) -> dict:
    try:
        response = requests.get(url, timeout=timeout_s)
        if response.status_code == 200:
            return health_item(name, True, "连接正常", {"url": url})
        return health_item(name, False, f"HTTP {response.status_code}", {"url": url})
    except Exception as exc:
        return health_item(name, False, str(exc), {"url": url})


def _run_llm_context_probe(key: str, label: str, runner) -> tuple[str, dict]:
    try:
        context_length, raw = runner()
        return key, {
            "name": label,
            "context_length": context_length,
            "message": f"探测到 {context_length} tokens" if context_length else "模型接口未返回上下文字段",
            "raw_keys": sorted(raw.keys())[:20] if isinstance(raw, dict) else [],
        }
    except Exception as exc:  # noqa: BLE001
        return key, {
            "name": label,
            "context_length": None,
            "message": str(exc)[:300],
            "raw_keys": [],
        }


def probe_llm_contexts(
    budget_s: float = _LLM_PROBE_BUDGET_S,
    specs: list[tuple[str, str, Callable[[], tuple[int | None, dict]]]] | None = None,
) -> dict:
    """并行探测 LLM 上下文窗口，整体最多等待 budget_s 秒。

    线程不能被强杀，所以超时的探测标记为 timeout 后不再等待；
    这些请求的底层 socket 超时是 _LLM_PROBE_TIMEOUT_S，不会无限挂住。
    """
    probes = {}
    if specs is None:
        specs = [
            (
                "local_openai",
                "LM Studio / OpenAI 兼容接口",
                lambda: OpenAICompatibleClient(
                    base_url=settings.openai_base_url,
                    api_key=settings.openai_api_key,
                    timeout_s=_LLM_PROBE_TIMEOUT_S,
                ).model_context_length(settings.openai_model),
            ),
            (
                "external_openai",
                "外部网络 LLM",
                lambda: OpenAICompatibleClient(
                    base_url=settings.external_llm_base_url,
                    api_key=settings.external_llm_api_key,
                    timeout_s=_LLM_PROBE_TIMEOUT_S,
                ).model_context_length(settings.external_llm_model),
            ),
            (
                "ollama",
                "Ollama",
                lambda: OllamaClient(
                    base_url=settings.ollama_base_url,
                    timeout_s=_LLM_PROBE_TIMEOUT_S,
                ).model_context_length(settings.ollama_model),
            ),
        ]

    executor = ThreadPoolExecutor(max_workers=len(specs), thread_name_prefix="llm-health")
    futures = {
        executor.submit(_run_llm_context_probe, key, label, runner): (key, label)
        for key, label, runner in specs
    }
    done, pending = wait(futures, timeout=budget_s)
    for future in done:
        key, item = future.result()
        probes[key] = item
    for future in pending:
        key, label = futures[future]
        probes[key] = {
            "name": label,
            "context_length": None,
            "message": f"探测超时（>{budget_s:g}s）",
            "raw_keys": [],
        }
        future.cancel()
    executor.shutdown(wait=False, cancel_futures=True)
    return probes


def backend_health() -> dict:
    checks = []

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        checks.append(health_item("数据库", True, "数据库连接正常", {"url": settings.database_url}))
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
        job_counts = ai_job_status_counts(db)
        queued = job_counts.get("queued", 0)
        running = job_counts.get("running", 0)
        failed = job_counts.get("failed", 0)
        videos = db.query(Video).count()
        try:
            paused = _is_queue_paused()
            queue_ok = True
            queue_message = f"运行 {running}，排队 {queued}，失败 {failed}"
            queue_details = {
                "running": running,
                "queued": queued,
                "failed": failed,
                "paused": paused,
            }
        except Exception as exc:  # Redis 不可用不应该让整个健康页 500
            queue_ok = False
            queue_message = f"Redis 队列不可用：{str(exc)[:160]}"
            queue_details = {
                "running": running,
                "queued": queued,
                "failed": failed,
                "paused": None,
            }
        checks.append(health_item("AI 队列", queue_ok, queue_message, queue_details))
        checks.append(health_item("视频库", True, f"{videos} 个视频", {"videos": videos}))
    except Exception as exc:  # noqa: BLE001
        checks.append(health_item("AI 队列", False, f"队列状态读取失败：{str(exc)[:160]}", {}))
    finally:
        db.close()

    cuda_devices = 0
    cuda_available = False
    resolved_device = "unavailable"
    try:
        import ctranslate2

        cuda_devices = ctranslate2.get_cuda_device_count()
        cuda_available = cuda_devices > 0
    except Exception as exc:  # noqa: BLE001
        cuda_probe_error = str(exc)[:160]
    else:
        cuda_probe_error = ""

    try:
        from app.services.transcribe_whisper import _resolve_device

        resolved_device = _resolve_device(settings.device_type)
        checks.append(health_item(
            "CUDA / GPU",
            cuda_available,
            f"检测到 {cuda_devices} 个 CUDA 设备，转写将使用 {resolved_device}" if cuda_available else f"未检测到 CUDA 设备，转写将使用 {resolved_device}",
            {
                "cuda_devices": cuda_devices,
                "resolved_device": resolved_device,
                "configured_device_type": settings.device_type,
            },
        ))
    except Exception as exc:  # noqa: BLE001
        # GPU-only 模式下，没有 CUDA 时 _resolve_device 会明确抛错。
        # 这是「当前机器不具备转写能力」，不是健康接口本身坏了；
        # 必须降级成一条失败检查项，不能让整个 /api/admin/health 返回 500。
        checks.append(health_item(
            "CUDA / GPU",
            False,
            f"转写设备不可用：{str(exc)[:200]}",
            {
                "cuda_devices": cuda_devices,
                "resolved_device": "unavailable",
                "configured_device_type": settings.device_type,
                "probe_error": cuda_probe_error,
            },
        ))

    # When CUDA is actually selected, also probe cuBLAS / cuDNN runtime DLLs because
    # faster-whisper fails opaquely if those are missing on Windows.
    if resolved_device == "cuda":
        try:
            from app.services.transcribe_whisper import _ensure_cuda_libs, _probe_cuda_runtime_libs
            _ensure_cuda_libs()
            probe = _probe_cuda_runtime_libs()
            missing = probe.get("missing") or []
            present = probe.get("present") or []
            checks.append(health_item(
                "CUDA 运行库 (cuBLAS/cuDNN)",
                not missing,
                (
                    "已加载: " + ", ".join(present)
                    if not missing
                    else "缺失: " + ", ".join(missing)
                    + "。请在后端 venv 中执行: pip install nvidia-cublas-cu12 nvidia-cudnn-cu12"
                ),
                {"present": present, "missing": missing},
            ))
        except Exception as exc:
            checks.append(health_item(
                "CUDA 运行库 (cuBLAS/cuDNN)", False, f"探测失败: {exc}", {},
            ))

    whisper_cpp_ok = False
    whisper_cpp_msg = "未配置"
    if whisper_cpp_exe and whisper_cpp_exe.exists():
        try:
            from app.services.transcribe_whisper import _probe_whisper_cpp_exe
            _probe_whisper_cpp_exe(whisper_cpp_exe)
            whisper_cpp_ok = True
            whisper_cpp_msg = "whisper-cli.exe 可正常启动"
        except RuntimeError as exc:
            whisper_cpp_msg = str(exc)
    checks.append(health_item(
        "whisper.cpp 可执行文件",
        whisper_cpp_ok,
        whisper_cpp_msg,
        {"path": str(whisper_cpp_exe or ""), "extra_args": settings.whisper_cpp_extra_args},
    ))

    checks.append(health_item(
        "转写默认配置",
        True,
        (
            f"{settings.default_whisper_model} / whisper.cpp GPU/外部引擎"
        )
        if settings.whisper_engine == "whisper.cpp"
        else f"{settings.default_whisper_model} / {settings.whisper_cpu_threads} 个 CPU 转写线程 / {settings.whisper_compute_type} / 设备 {resolved_device}",
        {
            "model": settings.default_whisper_model,
            "language": settings.default_language,
            "cpu_threads": None if settings.whisper_engine == "whisper.cpp" else settings.whisper_cpu_threads,
            "thread_role": "GPU/external whisper.cpp transcription; cpu_threads is ignored" if settings.whisper_engine == "whisper.cpp" else "faster-whisper CPU transcription threads",
            "subtitle_correction_runtime": "LM Studio/OpenAI-compatible API; GPU/CPU placement is decided by the LLM server",
            "compute_type": settings.whisper_compute_type,
            "subtitle_correction_enabled": settings.subtitle_correction_enabled,
            "whisper_engine": settings.whisper_engine,
            "whisper_cpp_exe": settings.whisper_cpp_exe,
            "whisper_cpp_model": settings.whisper_cpp_model,
            "resolved_device": resolved_device,
        },
    ))

    ok = all(item["ok"] for item in checks if item["name"] not in ("LM Studio / OpenAI 兼容接口", "Ollama"))
    return {
        "ok": ok,
        "checks": checks,
    }
