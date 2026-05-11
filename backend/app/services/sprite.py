from __future__ import annotations

import json
import logging
import math
import os
import shutil
import subprocess
from pathlib import Path

from app.database import settings

logger = logging.getLogger(__name__)

SPRITE_FOLDER = Path(settings.sprite_dir)
SPRITE_FOLDER.mkdir(parents=True, exist_ok=True)

# Sprite sheet config
FRAME_WIDTH = max(160, int(settings.sprite_frame_width or 320))
FRAME_INTERVAL = max(1, int(settings.sprite_frame_interval or 5))  # seconds between frames
COLS = max(1, int(settings.sprite_columns or 10))
JPEG_QUALITY = min(31, max(1, int(settings.sprite_jpeg_quality or 2)))


def _get_video_duration(video_path: str) -> float | None:
    if shutil.which("ffprobe") is None:
        return None
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                video_path,
            ],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            encoding="utf-8", errors="replace",
            timeout=30,
        )
        if result.returncode == 0:
            return float(result.stdout.strip())
    except Exception:
        pass
    return None


def get_sprite_path(video_id: int) -> Path:
    return SPRITE_FOLDER / f"{video_id}.jpg"


def get_sprite_meta_path(video_id: int) -> Path:
    return SPRITE_FOLDER / f"{video_id}.json"


def has_sprite(video_id: int) -> bool:
    if not get_sprite_path(video_id).exists() or not get_sprite_meta_path(video_id).exists():
        return False
    try:
        meta = json.loads(get_sprite_meta_path(video_id).read_text(encoding="utf-8"))
    except Exception:
        return False
    return (
        int(meta.get("frame_width") or 0) == FRAME_WIDTH
        and int(meta.get("frame_interval") or 0) == FRAME_INTERVAL
        and int(meta.get("cols") or 0) == COLS
        and int(meta.get("jpeg_quality") or 0) == JPEG_QUALITY
    )


def generate_sprite(video_path: str, video_id: int) -> dict | None:
    if shutil.which("ffmpeg") is None:
        logger.warning("ffmpeg not found, cannot generate sprite")
        return None

    duration = _get_video_duration(video_path)
    if not duration or duration <= 0:
        logger.warning("Cannot determine duration for sprite generation: %s", video_path)
        return None

    total_frames = max(1, math.ceil(duration / FRAME_INTERVAL))
    rows = math.ceil(total_frames / COLS)
    frame_height = int(FRAME_WIDTH * 9 / 16)  # assume 16:9

    output_path = get_sprite_path(video_id)
    meta_path = get_sprite_meta_path(video_id)

    vf = (
        f"fps=1/{FRAME_INTERVAL},"
        f"scale={FRAME_WIDTH}:{frame_height}:force_original_aspect_ratio=decrease,"
        f"pad={FRAME_WIDTH}:{frame_height}:(ow-iw)/2:(oh-ih)/2:black,"
        f"tile={COLS}x{rows}"
    )

    command = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vf", vf,
        "-frames:v", "1",
        "-q:v", str(JPEG_QUALITY),
        str(output_path),
    ]

    try:
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            encoding="utf-8", errors="replace",
            timeout=300,
        )
        if result.returncode != 0 or not output_path.exists():
            logger.error("Sprite generation failed: %s", result.stderr[:500])
            return None
    except subprocess.TimeoutExpired:
        logger.error("Sprite generation timed out for video %d", video_id)
        return None

    meta = {
        "video_id": video_id,
        "cols": COLS,
        "rows": rows,
        "frame_width": FRAME_WIDTH,
        "frame_height": frame_height,
        "frame_interval": FRAME_INTERVAL,
        "total_frames": total_frames,
        "duration": duration,
        "jpeg_quality": JPEG_QUALITY,
        "version": 2,
    }
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
    logger.info("Sprite generated: %s (%dx%d, %d frames)", output_path, COLS, rows, total_frames)
    return meta


def get_or_generate_sprite(video_path: str, video_id: int) -> dict | None:
    meta_path = get_sprite_meta_path(video_id)
    if has_sprite(video_id) and meta_path.exists():
        try:
            return json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return generate_sprite(video_path, video_id)
