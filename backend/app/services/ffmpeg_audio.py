import os
import shutil
import subprocess
from pathlib import Path

from app.database import settings

# On Windows a console-less parent (pythonw, scheduled task, GUI launcher)
# gives every console child a brand-new console window. ffmpeg is spawned once
# per queued video, so without this flag the audio-prep queue turns into a
# continuous stream of black windows. CREATE_NO_WINDOW keeps the child hidden.
_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0


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
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
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
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=_CREATE_NO_WINDOW,
    )
    try:
        stdout, stderr = process.communicate()
        if process.returncode != 0:
            raise RuntimeError(stderr.strip() or "ffmpeg failed")
    finally:
        pass
