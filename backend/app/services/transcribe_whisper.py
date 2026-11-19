from pathlib import Path
from typing import Optional
import importlib
import logging
import os
import json
import shlex
import subprocess

from app.database import settings
from app.services.rq_client import is_job_cancelled


logger = logging.getLogger(__name__)

_MODEL_CACHE = {}
_BATCH_PIPELINE_CACHE = {}
_BATCH_SIZE = max(1, int(os.getenv("WHISPER_BATCH_SIZE", "8") or 8))
_THREAD_ENV_KEYS = (
    "OMP_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
)

# CTranslate2 supported compute types per device. faster-whisper rejects
# anything else with an opaque error, so we normalize at load time.
_CPU_COMPUTE_TYPES = {"int8", "int16", "float32", "auto", "default"}
_GPU_COMPUTE_TYPES = {
    "int8",
    "int8_float16",
    "int8_bfloat16",
    "float16",
    "bfloat16",
    "float32",
    "auto",
    "default",
}

# Map UI-friendly model ids to actual faster-whisper / HuggingFace repos.
# turbo only ships as GGUF in whisper.cpp world; for faster-whisper we use
# the community CT2 conversion.
_FASTER_WHISPER_MODEL_ALIASES = {
    "large-v3-turbo": "deepdml/faster-whisper-large-v3-turbo-ct2",
    "distil-large-v3.5": "distil-whisper/distil-large-v3.5-ct2",
}
_FASTER_WHISPER_UNSUPPORTED_MODELS = {}

_CUDA_LIBS_INJECTED = False


def _ensure_cuda_libs() -> None:
    """Inject DLL search paths from nvidia-* pip packages so faster-whisper
    can locate cublas64_12.dll / cudnn*.dll without a global CUDA install.
    No-op on non-Windows or when the packages are absent."""
    global _CUDA_LIBS_INJECTED
    if _CUDA_LIBS_INJECTED or os.name != "nt":
        return
    candidate_modules = (
        "nvidia.cublas",
        "nvidia.cudnn",
        "nvidia.cuda_runtime",
        "nvidia.cuda_nvrtc",
    )
    injected_any = False
    for mod_name in candidate_modules:
        try:
            mod = importlib.import_module(mod_name)
        except Exception:
            continue
        for path_str in getattr(mod, "__path__", []) or []:
            bin_dir = Path(path_str) / "bin"
            if not bin_dir.is_dir():
                continue
            try:
                os.add_dll_directory(str(bin_dir))
            except (OSError, AttributeError):
                pass
            current = os.environ.get("PATH", "")
            if str(bin_dir) not in current:
                os.environ["PATH"] = f"{bin_dir}{os.pathsep}{current}"
            injected_any = True
    _CUDA_LIBS_INJECTED = injected_any
    if injected_any:
        logger.info("[whisper] injected NVIDIA pip-package DLL paths into search path")


def _probe_cuda_runtime_libs() -> dict:
    """Try to load critical CUDA runtime DLLs faster-whisper needs.
    Returns {present: [labels], missing: [labels]}."""
    if os.name != "nt":
        return {"present": [], "missing": []}
    import ctypes

    targets = {
        "cuBLAS 12": ["cublas64_12.dll"],
        "cuDNN": [
            "cudnn_ops_infer64_8.dll",
            "cudnn_ops64_9.dll",
            "cudnn64_9.dll",
            "cudnn64_8.dll",
        ],
    }
    present, missing = [], []
    for label, names in targets.items():
        ok = False
        for name in names:
            try:
                ctypes.WinDLL(name)
                ok = True
                break
            except OSError:
                continue
        (present if ok else missing).append(label)
    return {"present": present, "missing": missing}


def _validate_compute_type(device: str, compute_type: Optional[str]) -> tuple[str, Optional[str]]:
    """Return (compute_type, warning_message). Auto-corrects invalid combos."""
    raw = (compute_type or "").strip() or "int8"
    if device == "cpu":
        if raw in _CPU_COMPUTE_TYPES:
            return raw, None
        return "int8", (
            f"compute_type={raw} 在 CPU 上不被支持，已自动回退到 int8"
        )
    # cuda / gpu
    if raw in _GPU_COMPUTE_TYPES:
        return raw, None
    return "int8_float16", (
        f"compute_type={raw} 在 CUDA 上不被支持，已自动回退到 int8_float16"
    )


def _resolve_faster_whisper_model(model_size: str) -> str:
    if model_size in _FASTER_WHISPER_UNSUPPORTED_MODELS:
        raise RuntimeError(_FASTER_WHISPER_UNSUPPORTED_MODELS[model_size])
    return _FASTER_WHISPER_MODEL_ALIASES.get(model_size, model_size)


def _normalize_engine(engine: str | None = None) -> str:
    value = (engine or settings.whisper_engine or "faster-whisper").strip().lower()
    if value in ("whisper_cpp", "whisper.cpp", "whisper-cpp"):
        return "whisper.cpp"
    return "faster-whisper"


def _resolve_cpu_threads(cpu_threads: Optional[int] = None) -> int:
    value = cpu_threads if cpu_threads is not None else settings.whisper_cpu_threads
    try:
        return max(1, min(128, int(value)))
    except (TypeError, ValueError):
        return 4


def _apply_thread_env(cpu_threads: int) -> None:
    # CTranslate2 honors cpu_threads, but its numeric backends may also consult
    # OpenMP/BLAS env vars. Set conservative defaults before faster_whisper loads.
    for key in _THREAD_ENV_KEYS:
        current = os.environ.get(key)
        if not current:
            os.environ[key] = str(cpu_threads)
            continue
        try:
            if int(current) > cpu_threads:
                os.environ[key] = str(cpu_threads)
        except ValueError:
            os.environ[key] = str(cpu_threads)


def _resolve_device(device_type: Optional[str] = None) -> str:
    value = (device_type or "auto").strip().lower()
    if value == "cpu":
        return "cpu"
    # auto or cuda: probe ctranslate2 and fall back gracefully when no GPU.
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda"
    except Exception:
        pass
    if value == "cuda":
        logger.warning("[whisper] device_type=cuda requested but no CUDA device detected; falling back to cpu")
    return "cpu"


def _looks_like_cuda_dll_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return any(token in msg for token in (
        "cublas", "cudnn", "cuda", "library", "dll", "so.",
    ))


def get_whisper_model(model_size: str, cpu_threads: Optional[int] = None, compute_type: Optional[str] = None, device_type: Optional[str] = None):
    resolved_threads = _resolve_cpu_threads(cpu_threads)
    resolved_device = _resolve_device(device_type)
    resolved_compute_type, ct_warning = _validate_compute_type(
        resolved_device, compute_type or settings.whisper_compute_type
    )
    if ct_warning:
        logger.warning("[whisper] %s", ct_warning)
    _apply_thread_env(resolved_threads)
    actual_model = _resolve_faster_whisper_model(model_size)

    if resolved_device == "cuda":
        _ensure_cuda_libs()

    # Clean up stale .incomplete blobs before loading, so that a prior
    # interrupted download does not prevent the model from being fetched.
    try:
        import huggingface_hub
        cache_dir = huggingface_hub.constants.HF_HUB_CACHE
    except Exception:
        cache_dir = str(Path.home() / ".cache" / "huggingface" / "hub")
    safe_repo = actual_model.replace("/", "--")
    repo_cache = Path(cache_dir) / f"models--{safe_repo}"
    if repo_cache.exists():
        for blob in repo_cache.rglob("*.incomplete"):
            try:
                blob.unlink()
            except Exception:
                pass

    key = (actual_model, resolved_compute_type, resolved_threads, resolved_device)
    if key in _MODEL_CACHE:
        return _MODEL_CACHE[key]

    from faster_whisper import WhisperModel

    try:
        _MODEL_CACHE[key] = WhisperModel(
            actual_model,
            device=resolved_device,
            compute_type=resolved_compute_type,
            cpu_threads=resolved_threads,
            num_workers=1,
        )
    except Exception as exc:
        if resolved_device == "cuda" and _looks_like_cuda_dll_error(exc):
            probe = _probe_cuda_runtime_libs()
            logger.warning(
                "[whisper] CUDA 加载失败 (%s)；缺失库: %s。自动回退到 CPU",
                exc, probe.get("missing") or "unknown",
            )
            cpu_compute, _ = _validate_compute_type("cpu", resolved_compute_type)
            fallback_key = (actual_model, cpu_compute, resolved_threads, "cpu")
            if fallback_key not in _MODEL_CACHE:
                _MODEL_CACHE[fallback_key] = WhisperModel(
                    actual_model,
                    device="cpu",
                    compute_type=cpu_compute,
                    cpu_threads=resolved_threads,
                    num_workers=1,
                )
            _MODEL_CACHE[key] = _MODEL_CACHE[fallback_key]
        else:
            msg = str(exc)
            if "Invalid model size" in msg or "Connection" in msg or "HTTP" in msg or "timeout" in msg.lower():
                raise RuntimeError(
                    f"无法加载模型 {model_size}（repo={actual_model}）。"
                    f"请检查网络连接，或设置 HF_ENDPOINT 镜像（如 https://hf-mirror.com）后重试。"
                ) from exc
            raise
    return _MODEL_CACHE[key]


def get_batched_pipeline(model_size: str, cpu_threads: Optional[int] = None, compute_type: Optional[str] = None, device_type: Optional[str] = None):
    """Return a cached BatchedInferencePipeline for the same loaded model.

    faster-whisper >= 1.1 supports feeding multiple audio windows to the GPU
    in one call. The pipeline holds a reference to the WhisperModel, so it
    shares the model cache instead of loading a second copy.
    """
    model = get_whisper_model(
        model_size,
        cpu_threads=cpu_threads,
        compute_type=compute_type,
        device_type=device_type,
    )
    key = (
        _resolve_faster_whisper_model(model_size),
        _validate_compute_type(_resolve_device(device_type), compute_type or settings.whisper_compute_type)[0],
        _resolve_cpu_threads(cpu_threads),
        _resolve_device(device_type),
    )
    pipeline = _BATCH_PIPELINE_CACHE.get(key)
    if pipeline is None:
        from faster_whisper import BatchedInferencePipeline

        pipeline = BatchedInferencePipeline(model=model)
        _BATCH_PIPELINE_CACHE[key] = pipeline
    return pipeline


def _parse_whisper_cpp_json(json_path: Path) -> dict:
    data = json.loads(json_path.read_text(encoding="utf-8"))
    source_segments = data.get("transcription") or data.get("segments") or []
    segments = []
    parts = []
    for item in source_segments:
        text = (item.get("text") or "").strip()
        if not text:
            continue
        start = item.get("offsets", {}).get("from") if isinstance(item.get("offsets"), dict) else item.get("start")
        end = item.get("offsets", {}).get("to") if isinstance(item.get("offsets"), dict) else item.get("end")
        start_sec = float(start or 0) / (1000 if (start or 0) > 1000 else 1)
        end_sec = float(end or start_sec) / (1000 if (end or 0) > 1000 else 1)
        parts.append(text)
        segments.append({"start": start_sec, "end": end_sec, "text": text})
    return {"text": "\n".join(parts).strip(), "segments": segments}


def _probe_whisper_cpp_exe(exe_path: Path) -> None:
    """Test-launch whisper-cli with --help to catch missing DLLs before real work."""
    import ctypes
    import subprocess

    # Try a minimal run: if DLLs are missing Windows will pop a system error.
    # We suppress that via CREATE_NO_WINDOW and a short timeout.
    try:
        proc = subprocess.run(
            [str(exe_path), "-h"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        if proc.returncode not in (0, 1):
            raise RuntimeError(
                f"whisper-cli.exe probe failed (exit {proc.returncode}). "
                f"stderr: {proc.stderr[:200]}"
            )
    except subprocess.TimeoutExpired:
        raise RuntimeError("whisper-cli.exe probe timed out (>5s)")
    except OSError as exc:
        if exc.winerror == 126:  # ERROR_MOD_NOT_FOUND
            raise RuntimeError(
                "whisper-cli.exe cannot start: missing DLL (e.g. vulkan-1.dll). "
                "Install Vulkan Runtime or use a CPU-only build."
            )
        raise RuntimeError(f"whisper-cli.exe cannot start: {exc}")


def _transcribe_with_whisper_cpp(
    wav_path: Path,
    *,
    model_size: str,
    language: Optional[str],
    cpu_threads: Optional[int] = None,
    job_id: Optional[str] = None,
) -> dict:
    exe = settings.whisper_cpp_exe.strip()
    model = settings.whisper_cpp_model.strip()
    if not exe:
        raise RuntimeError("WHISPER_CPP_EXE is not configured")
    if not model:
        raise RuntimeError("WHISPER_CPP_MODEL is not configured")
    exe_path = Path(exe)
    model_path = Path(model)
    model_filename = f"ggml-{model_size}.bin" if model_size else ""
    model_candidate = Path(settings.work_dir).parent / "tools" / "models" / "whisper" / model_filename
    if model_filename and model_candidate.exists():
        model_path = model_candidate
    if not exe_path.exists():
        raise RuntimeError(f"whisper.cpp executable not found: {exe_path}")
    if not model_path.exists():
        raise RuntimeError(f"whisper.cpp model not found: {model_path}")
    _probe_whisper_cpp_exe(exe_path)

    output_base = wav_path.with_suffix("")
    json_path = output_base.with_suffix(".json")
    command = [
        str(exe_path),
        "-m",
        str(model_path),
        "-f",
        str(wav_path),
        "-oj",
        "-of",
        str(output_base),
    ]
    if language:
        command.extend(["-l", language])
    resolved_threads = _resolve_cpu_threads(cpu_threads)
    command.extend(["-t", str(resolved_threads)])
    if model_size:
        # Kept for diagnostics; the actual model is controlled by WHISPER_CPP_MODEL.
        pass
    if settings.whisper_cpp_extra_args.strip():
        command.extend(shlex.split(settings.whisper_cpp_extra_args))

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    try:
        stdout, stderr = process.communicate()
        if process.returncode != 0:
            raise RuntimeError(stderr.strip() or stdout.strip() or "whisper.cpp failed")
    finally:
        pass
    if not json_path.exists():
        raise RuntimeError(f"whisper.cpp did not produce JSON output: {json_path}")
    return _parse_whisper_cpp_json(json_path)


def transcribe_wav(
    wav_path: Path,
    engine: Optional[str] = None,
    model_size: str = "small",
    language: Optional[str] = "zh",
    cpu_threads: Optional[int] = None,
    compute_type: Optional[str] = None,
    beam_size: Optional[int] = None,
    best_of: Optional[int] = None,
    temperature: Optional[float] = None,
    vad_filter: Optional[bool] = None,
    device_type: Optional[str] = None,
    job_id: Optional[str] = None,
) -> dict:
    if _normalize_engine(engine) == "whisper.cpp":
        return _transcribe_with_whisper_cpp(
            wav_path,
            model_size=model_size,
            language=language,
            cpu_threads=cpu_threads,
            job_id=job_id,
        )

    if job_id is not None and is_job_cancelled(job_id):
        raise RuntimeError("Job cancelled")

    transcribe_kwargs = dict(
        language=language or None,
        vad_filter=settings.whisper_vad_filter if vad_filter is None else vad_filter,
        beam_size=beam_size or settings.whisper_beam_size,
        best_of=best_of or settings.whisper_best_of,
        temperature=settings.whisper_temperature if temperature is None else temperature,
        condition_on_previous_text=False,
    )

    # faster-whisper >= 1.1 supports batched inference: multiple audio windows
    # are decoded and sent to the GPU together, which fills the idle gaps
    # between short serial transcriptions. Batch size is configurable via
    # WHISPER_BATCH_SIZE; 1 keeps the old single-pass path.
    if _BATCH_SIZE > 1:
        try:
            pipeline = get_batched_pipeline(
                model_size,
                cpu_threads=cpu_threads,
                compute_type=compute_type,
                device_type=device_type,
            )
            segments, _info = pipeline.transcribe(
                str(wav_path),
                batch_size=_BATCH_SIZE,
                **transcribe_kwargs,
            )
        except Exception as exc:
            logger.warning("[whisper] batched inference unavailable (%s), falling back to single-pass", exc)
            model = get_whisper_model(model_size, cpu_threads=cpu_threads, compute_type=compute_type, device_type=device_type)
            segments, _info = model.transcribe(str(wav_path), **transcribe_kwargs)
    else:
        model = get_whisper_model(model_size, cpu_threads=cpu_threads, compute_type=compute_type, device_type=device_type)
        segments, _info = model.transcribe(str(wav_path), **transcribe_kwargs)

    parts: list[str] = []
    timestamped_segments: list[dict] = []

    for segment in segments:
        if job_id is not None and is_job_cancelled(job_id):
            raise RuntimeError("Job cancelled")
        text = (segment.text or "").strip()
        if not text:
            continue
        parts.append(text)
        timestamped_segments.append(
            {
                "start": float(segment.start),
                "end": float(segment.end),
                "text": text,
            }
        )

    return {
        "text": "\n".join(parts).strip(),
        "segments": timestamped_segments,
    }
