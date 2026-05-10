from pathlib import Path
from typing import Optional
import os
import json
import shlex
import subprocess

from app.database import settings


_MODEL_CACHE = {}
_THREAD_ENV_KEYS = (
    "OMP_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
)


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


def get_whisper_model(model_size: str, cpu_threads: Optional[int] = None, compute_type: Optional[str] = None):
    resolved_threads = _resolve_cpu_threads(cpu_threads)
    resolved_compute_type = (compute_type or settings.whisper_compute_type).strip()
    _apply_thread_env(resolved_threads)
    key = (model_size, resolved_compute_type, resolved_threads)
    if key not in _MODEL_CACHE:
        from faster_whisper import WhisperModel

        _MODEL_CACHE[key] = WhisperModel(
            model_size,
            device="cpu",
            compute_type=resolved_compute_type,
            cpu_threads=resolved_threads,
            num_workers=1,
        )
    return _MODEL_CACHE[key]


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


def _transcribe_with_whisper_cpp(
    wav_path: Path,
    *,
    model_size: str,
    language: Optional[str],
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
    if model_size:
        # Kept for diagnostics; the actual model is controlled by WHISPER_CPP_MODEL.
        pass
    if settings.whisper_cpp_extra_args.strip():
        command.extend(shlex.split(settings.whisper_cpp_extra_args))

    process = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    if process.returncode != 0:
        raise RuntimeError(process.stderr.strip() or process.stdout.strip() or "whisper.cpp failed")
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
) -> dict:
    if _normalize_engine(engine) == "whisper.cpp":
        return _transcribe_with_whisper_cpp(
            wav_path,
            model_size=model_size,
            language=language,
        )

    model = get_whisper_model(model_size, cpu_threads=cpu_threads, compute_type=compute_type)
    segments, _info = model.transcribe(
        str(wav_path),
        language=language or None,
        vad_filter=settings.whisper_vad_filter if vad_filter is None else vad_filter,
        beam_size=beam_size or settings.whisper_beam_size,
        best_of=best_of or settings.whisper_best_of,
        temperature=settings.whisper_temperature if temperature is None else temperature,
        condition_on_previous_text=True,
    )

    parts: list[str] = []
    timestamped_segments: list[dict] = []

    for segment in segments:
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
