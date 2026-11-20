import logging
import os
import re
import shutil
import subprocess
import threading
from pathlib import Path

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from sqlalchemy import or_

from app.database import SessionLocal, settings
from app.utils.textclean import clean_video_title
from app.models import AiJob, Category, ChatSession, Video, WatchEvent
from app.services.sprite import has_sprite, generate_sprite
from app.utils.files import resolve_media_path

logger = logging.getLogger(__name__)

VIDEO_EXTENSIONS = {".mp4", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".webm", ".m4v"}

THUMBNAIL_FOLDER = Path(settings.thumbnail_dir)
THUMBNAIL_FOLDER.mkdir(parents=True, exist_ok=True)

observer: Observer | None = None
_recent_events: dict[str, float] = {}
_EVENT_DEBOUNCE_SECONDS = 2.0

# 目录级事件（整段课程拖进来 / 改名 / 删除）在 watchdog 里往往只有一条
# DirMovedEvent，不会逐文件触发。这里用一个防抖的整库扫描兜底：
#   - 正在大批量拷贝时不会每个文件都扫一遍
#   - 目录改名/删除后最终一定会落到 UPDATE / DELETE
_SCAN_DEBOUNCE_SECONDS = 8.0
_scan_timer: threading.Timer | None = None
_scan_timer_lock = threading.Lock()
_scan_run_lock = threading.Lock()
# Docker Desktop 把 Windows 目录以 9p/drvfs 挂进 Linux 容器，inotify 收不到
# 宿主机上的新增/改名事件；只能退回轮询。单位秒，默认 120 秒扫一轮目录树。
_VIDEO_WATCH_POLL_SECONDS = float(os.getenv("VIDEO_WATCH_POLL_SECONDS", "120"))
_poll_stop = threading.Event()
_poll_thread: threading.Thread | None = None
_poll_snapshot: set[str] | None = None


def _abs_path(value: str | Path) -> str:
    """只做字符串级绝对化，不调用 Path.resolve()。

    Docker Desktop 的 9p/drvfs 挂载上，Path.resolve() 会对每个文件做
    realpath/stat；遇到坏目录（当前库里的 PDF/PPT/WORD 目录返回 EIO）会
    直接卡住。扫描和轮询只需要统一的 /videos/... 口径，不需要解析符号链接。
    """
    return os.path.normpath(os.path.abspath(os.fspath(value)))


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
    video_root = _abs_path(settings.video_folder)
    relative = os.path.relpath(_abs_path(file_path), video_root)
    if relative in {os.curdir, os.pardir} or relative.startswith(os.pardir + os.sep):
        return ()
    parts = Path(relative).parts
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

    video_root = _abs_path(settings.video_folder)
    parent_id = None
    current_path = video_root

    for index, part in enumerate(category_parts):
        current_path = os.path.join(current_path, part)
        current_path_str = current_path
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
    resolved = _abs_path(file_path)
    stat = file_path.stat()
    existing = db.query(Video).filter(Video.filepath == resolved).first()

    if not existing:
        # 路径没命中时，按「文件名 + 字节数」再找一次。
        #
        # 为什么必须加这一步：项目从「本机直跑」迁到 Docker 后，扫描根路径
        # 从 D:\ITJC\... 变成 /videos/...，同一个文件的绝对路径变了。
        # 只按 filepath 匹配会把整个库重新入库一遍 —— 实际发生过：
        # 28654 条记录里 14659 条是这么来的，检索结果里同一内容占两个坑。
        #
        # 用「文件名 + 字节数」而不是内容 hash：后者要对 28GB 视频跑一遍，
        # 每次扫描都算等于自杀。同名同大小的概率已经足够低。
        if stat.st_size:
            existing = (
                db.query(Video)
                .filter(
                    Video.filename == file_path.name,
                    Video.file_size == stat.st_size,
                )
                .first()
            )
            if existing:
                # 只修路径。title / chunks / 观看记录都不动 ——
                # 这条记录可能已经带着几万条 chunks 和历史进度。
                existing.filepath = resolved
                db.commit()

    category_id = get_or_create_category(db, file_path)

    if existing:
        existing.title = clean_video_title(file_path.stem)
        existing.filename = file_path.name
        existing.sort_key = natural_sort_value(file_path.name)
        existing.file_size = stat.st_size
        existing.category_id = category_id
        need_probe = not existing.duration
        # 先落盘并结束事务，再跑 ffprobe。
        #
        # get_video_duration 是 subprocess.run(timeout=30)，在事务里跑就等于
        # 给 videos 表挂一个最长 30 秒的 ACCESS SHARE —— 文件监听线程和
        # 启动扫描都会走这里，正好撞上迁移的 ALTER TABLE 就会卡住启动。
        db.commit()
        if need_probe:
            dur = get_video_duration(str(file_path))
            if dur:
                existing.duration = dur
                db.commit()
        return False

    duration = get_video_duration(str(file_path))
    video = Video(
        title=clean_video_title(file_path.stem),
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


# ── 文件变化后的自动编排 ────────────────────────────────────────


def _path_key(value: str | Path) -> str:
    """统一路径口径。数据库里是 /videos/...，watchdog 也是这个口径。"""
    return _abs_path(value)


def _is_under_video_root(value: str | Path) -> bool:
    root = _abs_path(settings.video_folder)
    path = _abs_path(value)
    return path == root or path.startswith(root + os.sep)


def _video_id_for_path(db, file_path: str | Path) -> int | None:
    row = db.query(Video.id).filter(Video.filepath == _path_key(file_path)).first()
    return int(row[0]) if row else None


def auto_start_video_pipeline(video_id: int, *, reason: str = "file_event") -> None:
    """新视频入库后，把下游链路一次性挂上。

    这是「文件系统事件」和「后台任务」之间的唯一衔接点：

      缩略图   → 进程内 ThumbnailWorker，立即投递
      转写     → AiJob（转写 + 总结；队列暂停时只落 DB，恢复后由现有逻辑补投）
      向量     → 有字幕就投 chunk_index；没有字幕时由转写完成钩子投递

    幂等：重复调用不会给同一个视频堆出第二个 queued/running 的 AiJob；
    缩略图 worker 自己按 video_id 去重；chunk_index 也有 (kind,target_id) 去重。
    """
    try:
        db = SessionLocal()
        try:
            video = db.query(Video).filter(Video.id == video_id).first()
            if video is None:
                return
            need_thumbnail = not (video.thumbnail or "").strip()
            has_transcript = bool((video.transcription or "").strip()) or bool(
                (video.transcript_segments or "").strip()
                and (video.transcript_segments or "").strip() not in {"[]", "null"}
            )
            has_summary = bool((video.summary or "").strip())
            need_index = has_transcript and not video.chunk_indexed_at
            active_job = (
                db.query(AiJob.id)
                .filter(
                    AiJob.video_id == video_id,
                    AiJob.status.in_(("queued", "running")),
                )
                .first()
            )
        finally:
            db.close()

        if need_thumbnail:
            try:
                # 延迟 import：thumbnail_worker 反向依赖本模块的 generate_thumbnail
                from app.services.thumbnail_worker import get_thumbnail_worker

                get_thumbnail_worker().submit([video_id])
            except Exception:  # noqa: BLE001
                logger.warning("自动投递缩略图失败 video=%s", video_id, exc_info=True)

        # 已有字幕但还没有索引的（例如刚搬进来、旧记录没有 chunk_indexed_at）
        # 才补向量；已经索引过的移动不重复跑。
        if need_index:
            try:
                from app.services.background_tasks import enqueue_task

                enqueue_task("chunk_index", target_id=str(video_id))
            except Exception:  # noqa: BLE001
                logger.warning("自动投递索引任务失败 video=%s", video_id, exc_info=True)

        # 已经有字幕且有总结 = 完整；只缺总结时仍交给 AI worker 用现有字幕补。
        if has_summary and has_transcript:
            return
        if active_job:
            return

        from app.services.admin_ai_queue import _is_queue_paused, enqueue_ai_jobs
        from app.services.admin_settings import load_transcription_settings
        from app.services.ai_jobs import create_ai_job

        stored = load_transcription_settings()
        db = SessionLocal()
        try:
            job = create_ai_job(
                db=db,
                video_id=video_id,
                whisper_model=stored.get("whisper_model") or settings.default_whisper_model,
                whisper_engine=stored.get("whisper_engine"),
                language=stored.get("language") or settings.default_language,
                do_summary=True,
                word_limit=int(stored.get("word_limit") or 200),
                ollama_model=None,
            )
        finally:
            db.close()

        if job.status == "queued" and not _is_queue_paused():
            enqueue_ai_jobs([job.id], at_front=False)
        logger.info(
            "文件变化自动启动 video=%s job=%s reason=%s transcript=%s summary=%s",
            video_id, job.id, reason, has_transcript, has_summary,
        )
    except Exception:  # noqa: BLE001
        # 事件回调里绝不能抛异常，watchdog 线程会被吞掉，后续所有文件都不再处理
        logger.exception("自动启动流水线失败 video=%s reason=%s", video_id, reason)


def _probe_duration_if_missing(db, video: Video, file_path: Path) -> None:
    """保持原 upsert 的「先提交、再跑 ffprobe」约定，别在事务里挂 videos 锁。"""
    db.commit()
    if video.duration:
        return
    duration = get_video_duration(str(file_path))
    if duration:
        video.duration = duration
        db.commit()


def _move_video_path(old_path: str | Path, new_path: str | Path) -> int | None:
    """文件在同一库内移动：只改路径，不删除/重建记录。

    这是这次修复的核心。原实现 on_moved 先 on_deleted 再 on_created：
    删掉 Video 会级联删字幕、观看记录和 content_chunks，然后新建一条
    空记录——用户只是给课程文件夹改个名，整段学习历史就没了。
    """
    old_key = _path_key(old_path)
    new_key = _path_key(new_path)
    db = SessionLocal()
    try:
        video = db.query(Video).filter(Video.filepath == old_key).first()
        if video is None:
            return None

        if not is_video(new_key):
            db.delete(video)
            db.commit()
            return None

        stat = Path(new_path).stat()
        category_id = get_or_create_category(db, Path(new_path))
        video.filepath = new_key
        video.filename = Path(new_path).name
        video.title = clean_video_title(Path(new_path).stem)
        video.sort_key = natural_sort_value(Path(new_path).name)
        video.file_size = stat.st_size
        video.category_id = category_id
        _probe_duration_if_missing(db, video, Path(new_path))
        return video.id
    finally:
        db.close()


def _delete_video_records(db, videos: list[Video]) -> int:
    """删除视频记录，并先清掉没有 ORM cascade 的外键引用。

    watch_events 只有普通 FK，没有 ON DELETE CASCADE；直接 delete(Video)
    会在 commit 时整批回滚（启动扫描曾经因此失败）。chat_sessions.video_id
    也允许为空，删除视频时把它置空，会话本身保留。
    """
    if not videos:
        return 0
    video_ids = [video.id for video in videos]
    db.query(WatchEvent).filter(WatchEvent.video_id.in_(video_ids)).delete(
        synchronize_session=False
    )
    db.query(ChatSession).filter(ChatSession.video_id.in_(video_ids)).update(
        {ChatSession.video_id: None}, synchronize_session=False
    )
    for video in videos:
        # 其余关系（watch_history / notes / ai_jobs / subtitle_segments）
        # 由 Video 模型上的 ORM cascade 处理。
        db.delete(video)
    return len(video_ids)


def _delete_video_path(file_path: str | Path) -> None:
    db = SessionLocal()
    try:
        video = db.query(Video).filter(Video.filepath == _path_key(file_path)).first()
        if video:
            _delete_video_records(db, [video])
            db.commit()
    finally:
        db.close()


def _move_directory_paths(src_path: str | Path, dest_path: str | Path) -> int:
    """目录改名/移动：前缀替换所有 Video.filepath 和 Category.path。

    不走 upsert 的「文件名 + 字节数」兜底，因为那个兜底在「同库里有同名
    同大小文件」时会认错记录；目录级移动有明确的旧前缀，能精确改。
    """
    src_prefix = _path_key(src_path)
    dest_prefix = _path_key(dest_path)
    db = SessionLocal()
    try:
        categories = (
            db.query(Category)
            .filter(Category.path.like(f"{src_prefix}%"))
            .all()
        )
        for category in categories:
            category.path = dest_prefix + category.path[len(src_prefix):]

        videos = (
            db.query(Video)
            .filter(Video.filepath.like(f"{src_prefix}%"))
            .all()
        )
        for video in videos:
            video.filepath = dest_prefix + video.filepath[len(src_prefix):]
        db.commit()
        moved = len(videos)
    finally:
        db.close()

    if moved:
        logger.info("目录移动：%s -> %s，更新 %s 条视频路径", src_path, dest_path, moved)
    return moved


def _delete_videos_under_directory(dir_path: str | Path) -> int:
    prefix = _path_key(dir_path)
    db = SessionLocal()
    try:
        videos = db.query(Video).filter(Video.filepath.like(f"{prefix}%")).all()
        removed = _delete_video_records(db, videos)
        db.commit()
    finally:
        db.close()
    if removed:
        logger.info("目录删除：%s，移除 %s 条视频记录", dir_path, removed)
    return removed


def _run_scheduled_scan(reason: str) -> None:
    global _scan_timer
    retry = False
    try:
        result = scan_video_library()
        retry = result.get("status") == "busy"
        logger.info("文件系统事件触发扫描完成 reason=%s result=%s", reason, result)
    except Exception:  # noqa: BLE001
        logger.exception("文件系统事件触发扫描失败 reason=%s", reason)
    finally:
        with _scan_timer_lock:
            _scan_timer = None
    # startup scan / 管理端 rescan 可能还在跑；本次抢锁失败并不代表
    # 文件变化丢了，过几秒再试，直到真正的扫描拿到锁。
    if retry and not _poll_stop.is_set():
        _schedule_library_scan(f"{reason}:retry")


def _schedule_library_scan(reason: str) -> None:
    """目录级事件防抖后跑一次整库扫描。

    目录 created/deleted 不保证逐文件发事件；扫描会补齐新增、删除，
    并修正「靠文件名+大小识别到旧记录」的路径。连续事件只保留最后一次。
    """
    global _scan_timer
    with _scan_timer_lock:
        if _scan_timer is not None:
            _scan_timer.cancel()
        _scan_timer = threading.Timer(
            _SCAN_DEBOUNCE_SECONDS,
            _run_scheduled_scan,
            args=(reason,),
        )
        _scan_timer.daemon = True
        _scan_timer.start()


def generate_missing_thumbnails(limit: int = 3) -> int:
    """给缺缩略图的视频补几张（rescan 时用）。

    三段式：短事务读 → 无事务跑 ffmpeg → 短事务写。
    原来把 generate_thumbnail 夹在查询和 commit 之间，ffmpeg 跑多久
    videos 的读锁就持多久 —— 和把后端启动卡死 12 分钟那次是同一模式。

    另外原实现直接拿 video.filepath 喂 ffmpeg。库里存的是宿主机路径
    （D://ITJC//...），容器里必然 FileNotFoundError，所以一张也生成不出来。
    必须走 resolve_media_path。
    """
    # ① 短事务：只取 id 和路径
    db = SessionLocal()
    try:
        rows = (
            db.query(Video.id, Video.filepath)
            .filter(or_(Video.thumbnail.is_(None), Video.thumbnail == ""))
            .order_by(Video.sort_key, Video.id)
            .limit(limit)
            .all()
        )
    finally:
        db.close()

    generated = 0
    for row in rows:
        # ② 无事务
        source = resolve_media_path(row.filepath)
        if not source.exists():
            continue
        thumbnail = generate_thumbnail(str(source), row.id)
        if not thumbnail:
            continue

        # ③ 短事务写
        db = SessionLocal()
        try:
            db.query(Video).filter(Video.id == row.id).update(
                {"thumbnail": thumbnail, "thumbnail_attempts": 0, "thumbnail_failed_at": None},
                synchronize_session=False,
            )
            db.commit()
            generated += 1
        finally:
            db.close()
    return generated


def generate_missing_sprites(limit: int = 3) -> int:
    """给缺雪碧图的视频补几张。

    两个问题都修了：

    1. **原来 `.all()` 把全表 1.4 万条视频（含几十 MB 的 transcript）
       全实例化进内存**，只为了挑出 3 条候选。现在投影成两列并加 SQL LIMIT。
    2. **ffmpeg 抽帧在事务里跑**（每张要抽几十帧，几秒到十几秒）。
       改成三段式，事务不跨越子进程。

    取候选时多查一些（limit*40）：has_sprite 是文件系统判断，SQL 里
    表达不了，所以要多取一批再做 Python 过滤。
    """
    db = SessionLocal()
    try:
        rows = (
            db.query(Video.id, Video.filepath)
            .filter(Video.duration.isnot(None))
            .order_by(Video.sort_key, Video.id)
            .limit(max(limit * 40, 200))
            .all()
        )
    finally:
        db.close()

    generated = 0
    for row in rows:
        if generated >= limit:
            break
        if has_sprite(row.id):
            continue
        source = resolve_media_path(row.filepath)
        if not source.exists():
            continue
        if generate_sprite(str(source), row.id):
            generated += 1
    return generated


def remove_missing_videos(
    db, existing_files: set[str], failed_dirs: set[str] | None = None
) -> int:
    failed_dirs = failed_dirs or set()
    removed_videos: list[Video] = []
    videos = db.query(Video).all()
    for video in videos:
        if video.filepath in existing_files:
            continue
        if _is_under_any(video.filepath, failed_dirs):
            continue
        if not os.path.exists(video.filepath):
            removed_videos.append(video)
    if removed_videos:
        _delete_video_records(db, removed_videos)
        db.commit()
    return len(removed_videos)


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


def _serialized_scan(fn):
    """同一时间只允许一个整库扫描。

    startup scan、目录事件兜底扫描、管理端 rescan 可能同时触发；
    14k 文件 + 9p 目录树本身就不便宜，叠起来既慢又会把同一条记录
    来回 upsert。抢不到锁的调用直接返回 busy，下一轮事件再扫。
    """

    def wrapper(*args, **kwargs):
        if not _scan_run_lock.acquire(blocking=False):
            logger.info("视频库扫描已在运行，跳过本次重复扫描")
            return {"status": "busy", "added": 0, "removed": 0, "total": 0}
        try:
            return fn(*args, **kwargs)
        finally:
            _scan_run_lock.release()

    wrapper.__name__ = fn.__name__
    return wrapper


@_serialized_scan
def scan_video_library(target: str | None = None) -> dict:
    """扫描视频库，或只扫描库内一个子目录。

    target 为空时保持原来的整库行为：新增/更新后还会清理已消失的记录。
    指定子目录时只 upsert 该范围，不做全库删除判断 —— 否则在控制台点
    “扫描课程 A”会把课程 B 的记录当成丢失文件清掉。
    """
    video_root = Path(settings.video_folder)
    video_root.mkdir(parents=True, exist_ok=True)
    scan_root = video_root
    prune_missing = True
    if target:
        candidate = Path(target)
        if not candidate.is_absolute():
            candidate = video_root / candidate
        candidate = Path(_abs_path(candidate))
        if not _is_under_video_root(candidate):
            raise ValueError("扫描路径必须在视频库根目录内")
        scan_root = candidate
        prune_missing = False

    db = SessionLocal()
    try:
        all_files = []
        failed_dirs: set[str] = set()
        scan_errors = 0

        def _onerror(exc: OSError):
            nonlocal scan_errors
            scan_errors += 1
            filename = getattr(exc, "filename", None)
            if filename:
                failed_dirs.add(_abs_path(filename))

        if scan_root.is_file():
            if is_video(scan_root):
                all_files.append(scan_root)
        else:
            for root, _dirs, files in os.walk(scan_root, onerror=_onerror):
                for filename in files:
                    if is_video(filename):
                        all_files.append(Path(root) / filename)

        all_files.sort(key=lambda item: natural_sort_key(item.name))

        added = 0
        added_ids: list[int] = []
        seen = set()
        for file_path in all_files:
            seen.add(_path_key(file_path))
            if upsert_video(db, file_path):
                added += 1
                video_id = _video_id_for_path(db, file_path)
                if video_id:
                    added_ids.append(video_id)

        removed = 0
        if prune_missing:
            removed = remove_missing_videos(db, seen, failed_dirs)
        if scan_errors:
            logger.warning(
                "视频库扫描有 %s 个目录读取失败，跳过这些目录下的删除判断",
                scan_errors,
            )
        remove_empty_categories(db)
        # Clear stale thumbnail paths
        for video in db.query(Video).filter(Video.thumbnail.isnot(None)).all():
            if not resolve_media_path(video.thumbnail).exists():
                video.thumbnail = None
        db.commit()
        total = db.query(Video).count()
    finally:
        db.close()

    # 扫描发现的新视频也走同一条自动链路。放在事务外，避免自动任务
    # 创建时和扫描的大事务互相锁住 videos。
    for video_id in added_ids:
        auto_start_video_pipeline(video_id, reason="library_scan_new")

    return {
        "status": "ok",
        "added": added,
        "removed": removed,
        "total": total,
        "scope": _abs_path(scan_root),
        "pruned": prune_missing,
    }


class VideoFolderHandler(FileSystemEventHandler):
    def _handle(self, src_path: str, *, auto_start: bool = True) -> None:
        now = __import__("time").monotonic()
        resolved = _path_key(src_path)
        if now - _recent_events.get(resolved, 0) < _EVENT_DEBOUNCE_SECONDS:
            return
        _recent_events[resolved] = now

        db = SessionLocal()
        try:
            upsert_video(db, Path(src_path))
            video_id = _video_id_for_path(db, Path(src_path))
        finally:
            db.close()

        if auto_start and video_id:
            auto_start_video_pipeline(video_id, reason="watchdog")

    def _handle_move(self, src_path: str, dest_path: str) -> None:
        src_in_root = _is_under_video_root(src_path)
        dest_in_root = _is_under_video_root(dest_path)

        if src_in_root and dest_in_root and is_video(dest_path):
            video_id = _move_video_path(src_path, dest_path)
            if video_id:
                auto_start_video_pipeline(video_id, reason="watchdog_move")
            else:
                # 旧记录不存在（例如库外文件第一次进库），按新增处理
                self._handle(dest_path, auto_start=True)
            return

        if src_in_root:
            # 移出视频库 / 改成非视频文件：原记录失效
            _delete_video_path(src_path)
        if dest_in_root and is_video(dest_path):
            # 从库外移进来：没有可复用的旧记录
            self._handle(dest_path, auto_start=True)

    def on_created(self, event):
        if event.is_directory:
            _schedule_library_scan("directory_created")
            return
        if is_video(event.src_path):
            self._handle(event.src_path, auto_start=True)

    def on_modified(self, event):
        if event.is_directory:
            return
        # 只刷新元数据；真正的新增在 on_created，避免大文件拷贝期间反复建任务
        if is_video(event.src_path):
            self._handle(event.src_path, auto_start=False)

    def on_deleted(self, event):
        if event.is_directory:
            _delete_videos_under_directory(event.src_path)
            return
        if is_video(event.src_path):
            _delete_video_path(event.src_path)

    def on_moved(self, event):
        if event.is_directory:
            src_in_root = _is_under_video_root(event.src_path)
            dest_in_root = _is_under_video_root(event.dest_path)
            if src_in_root and dest_in_root:
                _move_directory_paths(event.src_path, event.dest_path)
            elif dest_in_root:
                # 整段课程移进来：逐文件事件不一定齐全，扫描兜底
                _schedule_library_scan("directory_moved_in")
            elif src_in_root:
                _delete_videos_under_directory(event.src_path)
            return

        self._handle_move(event.src_path, event.dest_path)


def _video_folder_mount_fstype() -> str:
    mount_point = _abs_path(settings.video_folder)
    try:
        with open("/proc/mounts", "r", encoding="utf-8") as mounts:
            for line in mounts:
                parts = line.split()
                if len(parts) >= 3 and parts[1] == mount_point:
                    return parts[2].lower()
    except OSError:
        pass
    return ""


def _collect_video_paths() -> tuple[set[str], int, set[str]]:
    """walk 一遍视频库，返回视频路径集合、读取错误数和失败目录。

    9p/drvfs 上个别 Windows 目录会返回 EIO（当前库里有 `PDF` 目录就是），
    watchdog 的 DirectorySnapshot 遇到一个错误就整个 startup 崩掉。
    这里不用 watchdog 的快照器，自己容错：坏目录计数后跳过；删除判断
    会排除这些失败目录，避免把暂时读不到的目录误判成已删。
    """
    root = _abs_path(settings.video_folder)
    paths: set[str] = set()
    errors = 0
    failed_dirs: set[str] = set()

    def _onerror(exc: OSError):
        nonlocal errors
        errors += 1
        filename = getattr(exc, "filename", None)
        if filename:
            failed_dirs.add(_abs_path(filename))

    logger.info("轮询目录收集开始 root=%s", root)
    try:
        for root_dir, _dirs, files in os.walk(root, onerror=_onerror):
            for filename in files:
                if is_video(filename):
                    paths.add(_path_key(Path(root_dir) / filename))
    finally:
        logger.info("轮询目录收集完成 files=%s errors=%s", len(paths), errors)
    return paths, errors, failed_dirs


def _is_under_any(path: str, roots: set[str]) -> bool:
    return any(path == root or path.startswith(root + os.sep) for root in roots)


def _prune_videos_not_in_paths(
    db, current_paths: set[str], failed_dirs: set[str]
) -> int:
    """以数据库为准做一次轻量删除对账。

    轮询快照偶尔会在 9p 缓存/目录删除时序上漏掉 removed；这里直接拿
    Video.filepath 和当前路径集合比，避免「文件已经没了、数据库还留着」
    的幽灵记录。处于失败目录下的路径一律不删。
    """
    rows = db.query(Video.id, Video.filepath).all()
    missing_ids = [
        video_id
        for video_id, filepath in rows
        if filepath not in current_paths and not _is_under_any(filepath, failed_dirs)
    ]
    if not missing_ids:
        return 0
    videos = db.query(Video).filter(Video.id.in_(missing_ids)).all()
    removed = _delete_video_records(db, videos)
    db.commit()
    logger.info("轮询对账删除数据库残留视频 %s 条", removed)
    return removed


def _apply_poll_changes(
    added: set[str],
    removed: set[str],
    failed_dirs: set[str] | None = None,
    current_paths: set[str] | None = None,
) -> None:
    """只处理轮询发现的变化文件，不跑整库扫描。

    顺序很重要：先 upsert 新增路径，再删除消失路径。文件移动时
    upsert 会用「文件名 + 字节数」把旧记录改到新路径，后面的 removed
    再按旧路径查就已经查不到，不会误删刚修好的记录。

    9p 上有几个目录会稳定返回 EIO（当前是 PDF/PPT/WORD 这类目录），
    这些目录下的 removed 不能当作真删除；只删除不在失败目录下的路径，
    否则一次读盘抖动就会把整段课程从数据库里删掉。
    """
    failed_dirs = failed_dirs or set()
    added_ids: list[int] = []
    db = SessionLocal()
    try:
        for path in sorted(added):
            if not is_video(path):
                continue
            try:
                upsert_video(db, Path(path))
                video_id = _video_id_for_path(db, path)
                if video_id:
                    added_ids.append(video_id)
            except Exception:  # noqa: BLE001
                logger.warning("轮询 upsert 失败 path=%s", path, exc_info=True)

        if current_paths is not None:
            _prune_videos_not_in_paths(db, current_paths, failed_dirs)
        else:
            for path in sorted(removed):
                if _is_under_any(path, failed_dirs):
                    logger.info("轮询跳过失败目录下的删除 path=%s", path)
                    continue
                try:
                    _delete_video_path(path)
                except Exception:  # noqa: BLE001
                    logger.warning("轮询删除失败 path=%s", path, exc_info=True)
    finally:
        db.close()

    for video_id in added_ids:
        auto_start_video_pipeline(video_id, reason="polling_change")


def _poll_loop() -> None:
    global _poll_snapshot
    interval = _VIDEO_WATCH_POLL_SECONDS if _VIDEO_WATCH_POLL_SECONDS > 0 else 120.0
    # 第一次先建立快照，不和 startup scan 同时抢 9p I/O
    if _poll_stop.wait(2):
        return
    while not _poll_stop.is_set():
        try:
            if _poll_snapshot is None:
                # 首轮只读一次目录树建立基线；不等待 startup scan 的锁，
                # 否则 14k 文件的首扫期间轮询会一直不工作。
                current, errors, failed_dirs = _collect_video_paths()
                _poll_snapshot = current
                logger.info(
                    "视频库轮询建立初始快照 files=%s errors=%s",
                    len(current), errors,
                )
                if _poll_stop.wait(interval):
                    return
                continue

            current, errors, failed_dirs = _collect_video_paths()
            added = current - _poll_snapshot
            removed = _poll_snapshot - current
            has_changes = bool(added or removed)
            if has_changes:
                logger.info(
                    "视频库轮询发现变化 added=%s removed=%s errors=%s failed_dirs=%s",
                    len(added), len(removed), errors, len(failed_dirs),
                )
            # 和 startup scan / 管理端 rescan 互斥；抢不到就保留旧快照，
            # 下一轮再处理，避免把大量 upsert 叠在一起。即使本轮没有
            # 路径差异，也做一次 DB 对账，清掉 9p 缓存漏掉的 removed。
            if _scan_run_lock.acquire(blocking=False):
                try:
                    _apply_poll_changes(added, removed, failed_dirs, current)
                    _poll_snapshot = current
                finally:
                    _scan_run_lock.release()
            elif has_changes:
                logger.info("整库扫描正在运行，轮询变化留到下一轮")
        except Exception:  # noqa: BLE001
            logger.exception("视频库轮询失败，保留上一份快照")

        if _poll_stop.wait(interval):
            return


def _start_polling_watcher() -> None:
    global _poll_thread
    if _poll_thread is not None and _poll_thread.is_alive():
        return
    _poll_stop.clear()
    _poll_thread = threading.Thread(target=_poll_loop, name="video-library-poller", daemon=True)
    _poll_thread.start()
    logger.info("视频库监听使用轮询 interval=%.0fs", _VIDEO_WATCH_POLL_SECONDS)


def start_file_watcher() -> None:
    global observer
    if observer is not None or (_poll_thread is not None and _poll_thread.is_alive()):
        return

    watch_path = Path(settings.video_folder)
    watch_path.mkdir(parents=True, exist_ok=True)

    mode = os.getenv("VIDEO_WATCH_MODE", "auto").strip().lower()
    fstype = _video_folder_mount_fstype()
    use_polling = mode in {"polling", "poll"} or (
        mode == "auto" and fstype in {"9p", "drvfs", "cifs", "smb3", "nfs", "nfs4"}
    )
    if use_polling:
        _start_polling_watcher()
        return

    event_handler = VideoFolderHandler()
    current_observer = Observer()
    current_observer.schedule(event_handler, str(watch_path), recursive=True)
    current_observer.start()
    observer = current_observer


def stop_file_watcher() -> None:
    global observer, _scan_timer, _poll_thread
    with _scan_timer_lock:
        if _scan_timer is not None:
            _scan_timer.cancel()
            _scan_timer = None
    _poll_stop.set()
    if _poll_thread is not None:
        _poll_thread.join(timeout=5)
        _poll_thread = None
    if observer is None:
        return
    observer.stop()
    observer.join()
    observer = None
