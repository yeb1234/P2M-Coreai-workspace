from pathlib import Path
import threading

from app.database import SessionLocal, settings
from app.models import Video
from app.services.admin_settings import WHISPER_MODEL_FILES
from app.services.file_scanner import generate_missing_thumbnails, generate_thumbnail, scan_video_library


def rescan_library() -> dict:
    result = scan_video_library()
    generate_missing_thumbnails(limit=3)
    return result


def generate_thumbnails_for_ids(video_ids: list[int]) -> dict:
    if not video_ids:
        return {"generated": 0, "total": 0, "pending": 0}

    db = SessionLocal()
    try:
        videos = db.query(Video).filter(Video.id.in_(video_ids), Video.thumbnail.is_(None)).all()
        pending = len(videos)
        if pending == 0:
            return {"generated": 0, "total": len(video_ids), "pending": 0}
        video_ids_to_generate = [video.id for video in videos]
    finally:
        db.close()

    def _generate():
        gen_db = SessionLocal()
        try:
            vids = gen_db.query(Video).filter(Video.id.in_(video_ids_to_generate)).all()
            for video in vids:
                if video.thumbnail:
                    continue
                result = generate_thumbnail(video.filepath, video.id)
                if result:
                    video.thumbnail = result
            gen_db.commit()
        except Exception:
            gen_db.rollback()
        finally:
            gen_db.close()

    threading.Thread(target=_generate, daemon=True).start()
    return {"generated": 0, "total": len(video_ids), "pending": pending}


def whisper_models() -> dict:
    model_dir = Path(settings.whisper_cpp_model).parent if settings.whisper_cpp_model else Path(settings.work_dir).parent / "tools" / "models" / "whisper"
    items = []
    for model_id, filename in WHISPER_MODEL_FILES.items():
        path = model_dir / filename
        items.append({
            "id": model_id,
            "filename": filename,
            "installed": path.exists(),
            "path": str(path),
            "size": path.stat().st_size if path.exists() else None,
        })
    return {
        "model_dir": str(model_dir),
        "items": items,
    }
