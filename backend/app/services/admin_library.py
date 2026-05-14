from pathlib import Path
import threading

from app.database import SessionLocal, settings
from app.models import Video
from app.services.admin_settings import WHISPER_MODEL_FILES
from app.services.file_scanner import generate_missing_thumbnails, generate_thumbnail, scan_video_library
from app.services.transcribe_whisper import _FASTER_WHISPER_MODEL_ALIASES
from faster_whisper.utils import available_models as _faster_whisper_available_models, download_model as _faster_whisper_download_model
import faster_whisper.utils as _fw_utils

_FASTER_WHISPER_BUILTIN_MODELS = set(_faster_whisper_available_models())


def _resolve_hf_repo_id(model_id: str) -> str | None:
    """Map a model id to its HuggingFace repo id for faster-whisper."""
    if model_id in _FASTER_WHISPER_MODEL_ALIASES:
        return _FASTER_WHISPER_MODEL_ALIASES[model_id]
    return _fw_utils._MODELS.get(model_id)


def _is_model_in_hf_cache(model_id: str) -> bool:
    """Check if a faster-whisper model is already in the local HuggingFace cache."""
    import huggingface_hub
    repo_id = _resolve_hf_repo_id(model_id)
    if not repo_id:
        return False
    try:
        path = huggingface_hub.snapshot_download(repo_id, local_files_only=True)
        return (Path(path) / "model.bin").exists()
    except Exception:
        return False


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
        file_exists = path.exists()
        auto_dl = model_id in _FASTER_WHISPER_BUILTIN_MODELS or model_id in _FASTER_WHISPER_MODEL_ALIASES
        installed = file_exists or (auto_dl and _is_model_in_hf_cache(model_id))
        items.append({
            "id": model_id,
            "filename": filename,
            "installed": installed,
            "path": str(path),
            "size": path.stat().st_size if file_exists else None,
            "auto_downloadable": auto_dl,
        })
    return {
        "model_dir": str(model_dir),
        "items": items,
    }


_DOWNLOAD_JOBS: dict[str, dict] = {}


def _clean_hf_incomplete_files(repo_id: str) -> None:
    """Remove stale .incomplete blobs left by interrupted HuggingFace downloads."""
    import huggingface_hub
    try:
        cache_dir = huggingface_hub.constants.HF_HUB_CACHE
    except Exception:
        cache_dir = Path.home() / ".cache" / "huggingface" / "hub"
    # e.g. models--deepdml--faster-whisper-large-v3-turbo-ct2
    safe_repo = repo_id.replace("/", "--")
    repo_cache = Path(cache_dir) / f"models--{safe_repo}"
    if not repo_cache.exists():
        return
    for blob in repo_cache.rglob("*.incomplete"):
        try:
            blob.unlink()
        except Exception:
            pass


def _do_download(model_id: str, actual: str) -> None:
    """Background thread target for downloading a whisper model."""
    _DOWNLOAD_JOBS[model_id] = {"status": "running", "started_at": threading.current_thread().ident}
    try:
        _clean_hf_incomplete_files(actual)
        _faster_whisper_download_model(actual)
        _DOWNLOAD_JOBS[model_id] = {"status": "completed", "downloaded": True}
    except Exception as exc:
        _DOWNLOAD_JOBS[model_id] = {"status": "failed", "error": str(exc)}


def download_whisper_model(model_id: str) -> dict:
    actual = _resolve_hf_repo_id(model_id)
    if not actual:
        raise ValueError(f"未知模型: {model_id}")
    # If already running, just return current status
    existing = _DOWNLOAD_JOBS.get(model_id)
    if existing and existing.get("status") == "running":
        return {"model_id": model_id, "actual": actual, "status": "running"}
    if existing and existing.get("status") == "completed":
        return {"model_id": model_id, "actual": actual, "status": "completed", "downloaded": True}
    threading.Thread(target=_do_download, args=(model_id, actual), daemon=True).start()
    return {"model_id": model_id, "actual": actual, "status": "started"}


def get_download_status(model_id: str) -> dict | None:
    return _DOWNLOAD_JOBS.get(model_id)
