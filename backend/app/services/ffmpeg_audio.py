import shutil
import subprocess
from pathlib import Path

from app.database import settings


def _resolve_threads(cpu_threads: int | None = None) -> int | None:
    if cpu_threads is None:
        return None
    value = cpu_threads
    try:
        return max(1, min(128, int(value)))
    except (TypeError, ValueError):
        return None


def extract_wav_16k_mono(video_path: Path, wav_path: Path, cpu_threads: int | None = None, job_id: str | None = None) -> None:
    wav_path.parent.mkdir(parents=True, exist_ok=True)

    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not found. Please install ffmpeg and make sure it is on PATH.")

    cmd = [
        "ffmpeg",
        "-y",
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
    resolved_threads = _resolve_threads(cpu_threads)
    if resolved_threads is not None:
        cmd[2:2] = ["-threads", str(resolved_threads)]

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    try:
        stdout, stderr = process.communicate()
        if process.returncode != 0:
            raise RuntimeError(stderr.strip() or "ffmpeg failed")
    finally:
        pass
