import shutil
import subprocess
from pathlib import Path

from app.database import settings


def extract_wav_16k_mono(video_path: Path, wav_path: Path) -> None:
    wav_path.parent.mkdir(parents=True, exist_ok=True)

    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not found. Please install ffmpeg and make sure it is on PATH.")

    cmd = [
        "ffmpeg",
        "-y",
        "-threads",
        str(max(1, int(settings.whisper_cpu_threads or 4))),
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
