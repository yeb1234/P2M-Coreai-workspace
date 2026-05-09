from pathlib import Path
from typing import Optional
import os

from app.database import settings


_MODEL_CACHE = {}
_THREAD_ENV_KEYS = (
    "OMP_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
)


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


def transcribe_wav(
    wav_path: Path,
    model_size: str = "small",
    language: Optional[str] = "zh",
    cpu_threads: Optional[int] = None,
    compute_type: Optional[str] = None,
    beam_size: Optional[int] = None,
    best_of: Optional[int] = None,
    temperature: Optional[float] = None,
    vad_filter: Optional[bool] = None,
) -> dict:
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
