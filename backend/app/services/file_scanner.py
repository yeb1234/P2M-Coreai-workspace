import os
import re
import shutil
import subprocess
from pathlib import Path

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from app.database import SessionLocal, settings
from app.models import Category, Video
from app.services.sprite import has_sprite, generate_sprite
from app.utils.files import resolve_media_path


VIDEO_EXTENSIONS = {".mp4", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".webm", ".m4v"}

THUMBNAIL_FOLDER = Path(settings.thumbnail_dir)
THUMBNAIL_FOLDER.mkdir(parents=True, exist_ok=True)

observer: Observer | None = None
_recent_events: dict[str, float] = {}
_EVENT_DEBOUNCE_SECONDS = 2.0


def natural_sort_key(filename: str):
    parts = re.split(r"(\d+)", filename)
    result = []
    for part in parts:
        result.append(int(part) if part.isdigit() else part.lower())
    return result


def natural_sort_value(filename: str) -> str:
    parts = re.split(r"(\d+)", filename)
    normalized = []
    for part in parts:
        normalized.append(f"{int(part):012d}" if part.isdigit() else part.lower())
    return "".join(normalized)


def is_video(path: str | Path) -> bool:
    return Path(path).suffix.lower() in VIDEO_EXTENSIONS


def get_category_parts(file_path: Path) -> tuple[str, ...]:
    video_root = Path(settings.video_folder).resolve()
    relative = file_path.resolve().relative_to(video_root)
    parts = relative.parts
    if len(parts) <= 1:
        return ()
    return parts[:-1]


def generate_thumbnail(video_path: str, video_id: int) -> str | None:
    if shutil.which("ffmpeg") is None:
        return None

    output_path = THUMBNAIL_FOLDER / f"{video_id}.jpg"
    command = [
        "ffmpeg",
        "-y",
        "-ss",
        "00:00:01",
        "-i",
        str(video_path),
        "-vframes",
        "1",
        "-vf",
        "scale=480:-1",
        str(output_path),
    ]
    process = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8", errors="replace")
    if process.returncode == 0 and output_path.exists():
        return str(output_path)
    return None


def get_video_duration(video_path: str) -> float | None:
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
        if result.returncode == 0 and result.stdout.strip():
            return float(result.stdout.strip())
    except Exception:
        pass
    return None


def get_or_create_category(db, file_path: Path) -> int | None:
    from sqlalchemy.exc import IntegrityError

    category_parts = get_category_parts(file_path)
    if not category_parts:
        return None

    video_root = Path(settings.video_folder).resolve()
    parent_id = None
    current_path = video_root

    for index, part in enumerate(category_parts):
        current_path = current_path / part
        current_path_str = str(current_path.resolve())
        category = db.query(Category).filter(Category.path == current_path_str).first()
        if not category:
            category = db.query(Category).filter(
                Category.name == part,
                Category.parent_id == parent_id,
            ).first()
        if not category:
            category = Category(
                name=part,
                path=current_path_str,
                sort_order=db.query(Category).count(),
                parent_id=parent_id,
            )
            db.add(category)
            try:
                db.commit()
                db.refresh(category)
            except IntegrityError:
                db.rollback()
                category = db.query(Category).filter(Category.path == current_path_str).first()
                if not category:
                    category = db.query(Category).filter(
                        Category.name == part,
                        Category.parent_id == parent_id,
                    ).first()
                if category:
                    db.refresh(category)
        if not category:
            return None
        parent_id = category.id

    return parent_id


def upsert_video(db, file_path: Path) -> bool:
    resolved = str(file_path.resolve())
    stat = file_path.stat()
    existing = db.query(Video).filter(Video.filepath == resolved).first()
    category_id = get_or_create_category(db, file_path)

    if existing:
        existing.title = file_path.stem
        existing.filename = file_path.name
        existing.sort_key = natural_sort_value(file_path.name)
        existing.file_size = stat.st_size
        existing.category_id = category_id
        if not existing.duration:
            dur = get_video_duration(str(file_path))
            if dur:
                existing.duration = dur
        db.commit()
        return False

    duration = get_video_duration(str(file_path))
    video = Video(
        title=file_path.stem,
        filename=file_path.name,
        sort_key=natural_sort_value(file_path.name),
        filepath=resolved,
        file_size=stat.st_size,
        category_id=category_id,
        duration=duration,
    )
    db.add(video)
    db.commit()
    db.refresh(video)
    return True


def generate_missing_thumbnails(limit: int = 3) -> int:
    db = SessionLocal()
    generated = 0
    try:
        videos = (
            db.query(Video)
            .filter(Video.thumbnail.is_(None))
            .order_by(Video.sort_key, Video.id)
            .limit(limit)
            .all()
        )
        for video in videos:
            if not os.path.exists(video.filepath):
                continue
            thumbnail = generate_thumbnail(video.filepath, video.id)
            if thumbnail:
                video.thumbnail = thumbnail
                generated += 1
                db.commit()
        return generated
    finally:
        db.close()


def generate_missing_sprites(limit: int = 3) -> int:
    db = SessionLocal()
    generated = 0
    try:
        videos = (
            db.query(Video)
            .filter(Video.duration.isnot(None))
            .order_by(Video.sort_key, Video.id)
            .all()
        )
        count = 0
        for video in videos:
            if count >= limit:
                break
            if has_sprite(video.id):
                continue
            if not os.path.exists(video.filepath):
                continue
            if generate_sprite(video.filepath, video.id):
                generated += 1
                count += 1
        return generated
    finally:
        db.close()


def remove_missing_videos(db, existing_files: set[str]) -> int:
    removed = 0
    videos = db.query(Video).all()
    for video in videos:
        if video.filepath not in existing_files or not os.path.exists(video.filepath):
            db.delete(video)
            removed += 1
    if removed:
        db.commit()
    return removed


def remove_empty_categories(db) -> int:
    removed = 0
    while True:
        cats = db.query(Category).all()
        empty = []
        for cat in cats:
            has_videos = db.query(Video).filter(Video.category_id == cat.id).count() > 0
            has_children = db.query(Category).filter(Category.parent_id == cat.id).count() > 0
            if not has_videos and not has_children:
                empty.append(cat)
        if not empty:
            break
        for cat in empty:
            db.delete(cat)
            removed += 1
        db.commit()
    return removed


def scan_video_library() -> dict:
    video_root = Path(settings.video_folder)
    video_root.mkdir(parents=True, exist_ok=True)

    db = SessionLocal()
    try:
        all_files = []
        for root, _dirs, files in os.walk(video_root):
            for filename in files:
                if is_video(filename):
                    all_files.append((Path(root) / filename).resolve())

        all_files.sort(key=lambda item: natural_sort_key(item.name))

        added = 0
        seen = set()
        for file_path in all_files:
            seen.add(str(file_path))
            if upsert_video(db, file_path):
                added += 1

        removed = remove_missing_videos(db, seen)
        remove_empty_categories(db)
        # Clear stale thumbnail paths
        for video in db.query(Video).filter(Video.thumbnail.isnot(None)).all():
            if not resolve_media_path(video.thumbnail).exists():
                video.thumbnail = None
        db.commit()
        total = db.query(Video).count()
        return {"status": "ok", "added": added, "removed": removed, "total": total}
    finally:
        db.close()


class VideoFolderHandler(FileSystemEventHandler):
    def _handle(self, src_path: str) -> None:
        now = __import__("time").monotonic()
        resolved = str(Path(src_path).resolve())
        if now - _recent_events.get(resolved, 0) < _EVENT_DEBOUNCE_SECONDS:
            return
        _recent_events[resolved] = now

        db = SessionLocal()
        try:
            upsert_video(db, Path(src_path))
        finally:
            db.close()

    def on_created(self, event):
        if event.is_directory or not is_video(event.src_path):
            return
        self._handle(event.src_path)

    def on_modified(self, event):
        if event.is_directory or not is_video(event.src_path):
            return
        self._handle(event.src_path)

    def on_deleted(self, event):
        if event.is_directory or not is_video(event.src_path):
            return
        db = SessionLocal()
        try:
            video = db.query(Video).filter(Video.filepath == str(Path(event.src_path).resolve())).first()
            if video:
                db.delete(video)
                db.commit()
        finally:
            db.close()

    def on_moved(self, event):
        if event.is_directory:
            return
        self.on_deleted(type("E", (), {"is_directory": False, "src_path": event.src_path})())
        if is_video(event.dest_path):
            self.on_created(type("E", (), {"is_directory": False, "src_path": event.dest_path})())


def start_file_watcher() -> None:
    global observer
    if observer is not None:
        return

    watch_path = Path(settings.video_folder)
    watch_path.mkdir(parents=True, exist_ok=True)
    event_handler = VideoFolderHandler()
    current_observer = Observer()
    current_observer.schedule(event_handler, str(watch_path), recursive=True)
    current_observer.start()
    observer = current_observer


def stop_file_watcher() -> None:
    global observer
    if observer is None:
        return
    observer.stop()
    observer.join()
    observer = None
