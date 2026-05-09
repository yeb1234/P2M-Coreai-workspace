import shutil
import subprocess
from pathlib import Path

from app.database import settings


def _resolve_threads(cpu_threads: int | None = None) -> int:
    value = cpu_threads if cpu_threads is not None else settings.whisper_cpu_threads
    try:
        return max(1, min(128, int(value)))
    except (TypeError, ValueError):
        return 4


def extract_wav_16k_mono(video_path: Path, wav_path: Path, cpu_threads: int | None = None) -> None:
    wav_path.parent.mkdir(parents=True, exist_ok=True)

    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not found. Please install ffmpeg and make sure it is on PATH.")

    cmd = [
        "ffmpeg",
        "-y",
        "-threads",
        str(_resolve_threads(cpu_threads)),
        "-i",
        str(video_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        str(wav_path),
    ]
    process = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if process.returncode != 0:
        raise RuntimeError(process.stderr.strip() or "ffmpeg failed")
