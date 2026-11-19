import json
import logging
import math
import os
import re
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session

from app.auth import get_current_user, get_optional_user, require_admin
from app.database import get_db
from app.models import AiJob, Category, Note, SubtitleSegment, User, UserVideoFavorite, Video, WatchHistory
from app.services.profile import invalidate_profile_cache
from app.utils.files import resolve_media_path
from app.schemas import (
    AiJobCreate,
    NoteOut,
    SegmentSearchResult,
    SubtitleSegmentOut,
    SubtitleSegmentUpdate,
    VideoOut,
    VideoPage,
    VideoFavoriteIn,
    WatchHistoryIn,
)
from app.services.admin_ai_queue import _is_queue_paused, enqueue_ai_jobs
from app.services.ai_jobs import create_ai_job_from_payload
from app.services.quota import quota_exceeded_detail, search_quota_for
from app.services.rate_limit import search_limiter
from app.services.sprite import get_or_generate_sprite, get_sprite_meta_path, get_sprite_path, has_sprite
from app.services.subtitle_writer import update_vtt_segment_text
from app.services.video_serialization import serialize_video
from app.utils.serialization import dump_segments, load_segments, to_output_url


router = APIRouter(prefix="/api/videos", tags=["videos"])

logger = logging.getLogger(__name__)


def _is_foreign_platform_path(raw: str) -> bool:
    """判断路径是否属于当前运行环境的「另一个平台」。

    Windows 容器化前的库在 Linux 容器里会看到 `D:\\...`；
    反之 Windows 上跑也可能遇到 `/data/...` 这种 Linux 路径。
    命中时说明是路径映射缺失，不是文件真的没了。
    """
    text = str(raw or "")
    if os.name != "nt" and re.match(r"^[A-Za-z]:[\\/]", text):
        return True
    if os.name == "nt" and text.startswith("/") and not text.startswith("//"):
        return True
    return False


def active_job_map(db: Session, video_ids: list[int]) -> dict[int, AiJob]:
    if not video_ids:
        return {}

    jobs = (
        db.query(AiJob)
        .filter(AiJob.video_id.in_(video_ids), AiJob.status.in_(("queued", "running")))
        .order_by(AiJob.created_at.desc())
        .all()
    )
    result = {}
    for job in jobs:
        if job.video_id not in result:
            result[job.video_id] = job
    return result


def _uid(user: User | None) -> int | None:
    """取用户 id；匿名返回 None（表示「不查个人进度」而不是「查所有人」）。"""
    return user.id if user is not None else None


def latest_watch_map(
    db: Session, video_ids: list[int], user_id: int | None
) -> dict[int, WatchHistory]:
    """每个视频「当前用户」的最新一条观看记录。

    user_id 必须传，且必须用于过滤 —— 原来没有这个参数，SQL 里也没有
    user_id 条件，于是：

      B 看到第 42 分钟 → A 打开首页，「继续观看」直接从 42 分钟开始
      列表里每个视频的完成状态显示的是「最后一个看它的人」

    save_watch_history 写入时是带 user_id 的，说明设计上进度本来就
    按用户隔离，只是读侧漏了。匿名用户（user_id=None）不查进度。
    """
    if not video_ids or user_id is None:
        return {}

    latest_rows = (
        db.query(WatchHistory.video_id, func.max(WatchHistory.watched_at).label("max_watched_at"))
        .filter(
            WatchHistory.video_id.in_(video_ids),
            WatchHistory.user_id == user_id,
        )
        .group_by(WatchHistory.video_id)
        .subquery()
    )
    histories = (
        db.query(WatchHistory)
        .join(
            latest_rows,
            (WatchHistory.video_id == latest_rows.c.video_id)
            & (WatchHistory.watched_at == latest_rows.c.max_watched_at),
        )
        .filter(WatchHistory.user_id == user_id)
        .all()
    )
    return {history.video_id: history for history in histories}


def favorite_map(
    db: Session, video_ids: list[int], user_id: int | None
) -> dict[int, UserVideoFavorite]:
    """每个视频「当前用户」的收藏；匿名返回空，代表没有个人收藏。

    不能再用 `Video.is_favorite`：那是共享库字段，A 的收藏会变成 B 的收藏。
    """
    if not video_ids or user_id is None:
        return {}
    rows = (
        db.query(UserVideoFavorite)
        .filter(
            UserVideoFavorite.user_id == user_id,
            UserVideoFavorite.video_id.in_(video_ids),
        )
        .all()
    )
    return {row.video_id: row for row in rows}


def fts_segment_rows(db: Session, query_text: str, limit: int):
    try:
        return db.execute(
            text(
                """
                SELECT s.id, s.video_id, s.segment_index, s.start_sec, s.end_sec, s.text,
                       v.title, v.category_id, v.subtitle_path
                FROM subtitle_segments_fts f
                JOIN subtitle_segments s ON s.id = f.rowid
                JOIN videos v ON v.id = s.video_id
                WHERE subtitle_segments_fts MATCH :query_text
                ORDER BY bm25(subtitle_segments_fts)
                LIMIT :limit
                """
            ),
            {"query_text": query_text, "limit": limit * 3},
        ).fetchall()
    except Exception:
        return []


@router.get("/search/segments", response_model=list[SegmentSearchResult])
def search_segments(
    request: Request,
    q: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """按字幕内容搜索视频片段。

    ## 为什么改走 hybrid_search

    原来是「FTS + 关键词计数」：先查全文索引，再用 `score_hint = 命中几个词`
    排序。这个分数没有任何语义权重 —— 「垃圾回收」命中 2 个词和
    「回收」命中 1 个词区分不出相关性，而且**路径/课程名完全不可检索**。

    现在走和 AI 助手同一条链路（三路召回 + RRF + 可选 rerank），
    附带元数据线索（课程 / 章 / 第 N 节）。搜索质量与对话里的引用卡片一致，
    不会出现「助手找得到、搜索页找不到」。

    代价：单次约 100-500ms（含 rerank），比原来的 FTS 慢。
    搜索是用户主动触发的低频操作，这个代价可以接受。
    """
    from app.services.hybrid_search import hybrid_search
    from app.utils.paths import display_folder_path
    from app.utils.textclean import clean_promo_text

    # 和 /api/search/hybrid 同一套成本边界：匿名只能走无 rerank 的检索，
    # 登录用户启用 rerank 时才受搜索配额/限流约束。
    identity = f"user:{user.id}" if user is not None else f"ip:{request.client.host if request.client else 'anonymous'}"
    allowed, _ = search_limiter.hit(identity)
    if not allowed:
        raise HTTPException(status_code=429, detail="搜索太频繁，缓一下再试")

    effective_rerank = user is not None
    quota = None
    if effective_rerank:
        quota = search_quota_for(user.role)
        ok, used, limit = quota.consume(user.id)
        if not ok:
            raise HTTPException(
                status_code=429,
                detail=quota_exceeded_detail(used, limit, "搜索"),
            )

    try:
        result = hybrid_search(
            q.strip(),
            top_k=limit,
            candidate_k=30,
            use_rerank=effective_rerank,
        )
        hits = result.get("hits") or []
    except Exception:
        # 没走到 rerank 就不该扣搜索额度；检索失败也一样。
        if quota is not None:
            quota.refund(user.id)
        logger.exception("片段搜索失败，回退到 FTS")
        hits = []

    if hits:
        return [
            SegmentSearchResult(
                video_id=hit.video_id,
                video_title=hit.video_title or "",
                category_id=hit.category_id,
                start_sec=round(hit.start_sec, 1),
                end_sec=round(getattr(hit, "end_sec", None) or hit.start_sec, 1),
                text=clean_promo_text(hit.text or "")[:400],
                subtitle_url=None,
                score_hint=round(hit.score or 0, 4),
                folder_path=display_folder_path(getattr(hit, "filepath", None)),
                meta=getattr(hit, "meta", None),
            )
            for hit in hits
        ]

    # 兜底：混合检索全挂（embedding 服务不可用 + 词法也没命中）时，
    # 还能靠最简单的 LIKE 给出东西，不让用户面对一个空列表。
    keywords = [part.strip() for part in q.split() if part.strip()] or [q.strip()]
    filters = [SubtitleSegment.text.contains(keyword) for keyword in keywords]
    rows = (
        db.query(SubtitleSegment, Video)
        .join(Video, Video.id == SubtitleSegment.video_id)
        .filter(or_(*filters))
        .limit(limit)
        .all()
    )
    return [
        SegmentSearchResult(
            video_id=video.id,
            video_title=video.title,
            category_id=video.category_id,
            start_sec=segment.start_sec,
            end_sec=segment.end_sec,
            text=segment.text,
            subtitle_url=to_output_url(video.subtitle_path),
            score_hint=0,
            folder_path=display_folder_path(video.filepath),
        )
        for segment, video in rows
    ]


@router.get("", response_model=VideoPage)
def get_videos(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=999999),
    category_id: int | None = None,
    category_ids: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    query = db.query(Video)
    if category_ids:
        ids = [int(x) for x in category_ids.split(",") if x.strip()]
        all_ids: list[int] = []
        for cid in ids:
            all_ids.extend(_collect_descendant_ids(db, cid))
        query = query.filter(Video.category_id.in_(set(all_ids)))
    elif category_id:
        all_ids = _collect_descendant_ids(db, category_id)
        query = query.filter(Video.category_id.in_(all_ids))
    if search:
        query = query.filter(Video.title.contains(search))

    total = query.count()
    offset = (page - 1) * page_size
    selected = (
        query
        .join(Category, Video.category_id == Category.id, isouter=True)
        .order_by(Category.path.asc().nullslast(), Video.sort_key.asc().nullslast(), Video.id.asc())
        .offset(offset)
        .limit(page_size)
        .all()
    )
    watch_map = latest_watch_map(db, [item.id for item in selected], _uid(user))
    favorite_by_video = favorite_map(db, [item.id for item in selected], _uid(user))
    job_map = active_job_map(db, [item.id for item in selected])
    category_ids = {item.category_id for item in selected if item.category_id}
    category_map = {c.id: c.path for c in db.query(Category).filter(Category.id.in_(category_ids)).all()} if category_ids else {}
    return VideoPage(
        items=[
            serialize_video(
                item,
                watch_map.get(item.id),
                job_map.get(item.id),
                category_map.get(item.category_id),
                include_segments=False,
                include_details=False,
                favorite=favorite_by_video.get(item.id),
            )
            for item in selected
        ],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total else 0,
    )


@router.get("/continue/last", response_model=VideoOut)
def get_continue_video(
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    if user is None:
        raise HTTPException(status_code=404, detail="No unfinished video")
    history = (
        db.query(WatchHistory)
        .filter(
            WatchHistory.user_id == user.id,
            WatchHistory.completed.is_(False),
            WatchHistory.progress > 5,
        )
        .order_by(WatchHistory.watched_at.desc())
        .first()
    )
    if not history:
        raise HTTPException(status_code=404, detail="No unfinished video")
    video = db.query(Video).filter(Video.id == history.video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    job_map = active_job_map(db, [video.id])
    category_path = None
    if video.category_id:
        category = db.query(Category).filter(Category.id == video.category_id).first()
        category_path = category.path if category else None
    favorite = favorite_map(db, [video.id], user.id).get(video.id)
    return serialize_video(
        video,
        history,
        job_map.get(video.id),
        category_path,
        include_segments=False,
        include_details=False,
        favorite=favorite,
    )


@router.get("/history/recent", response_model=list[VideoOut])
def get_recent_history(
    limit: int = Query(8, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    if user is None:
        return []
    latest_rows = (
        db.query(WatchHistory.video_id, func.max(WatchHistory.watched_at).label("max_watched_at"))
        .filter(WatchHistory.user_id == user.id)
        .group_by(WatchHistory.video_id)
        .subquery()
    )
    histories = (
        db.query(WatchHistory)
        .join(
            latest_rows,
            (WatchHistory.video_id == latest_rows.c.video_id)
            & (WatchHistory.watched_at == latest_rows.c.max_watched_at),
        )
        .filter(WatchHistory.user_id == user.id)
        .order_by(WatchHistory.watched_at.desc())
        .limit(limit)
        .all()
    )
    if not histories:
        return []

    video_ids = [history.video_id for history in histories]
    videos = {video.id: video for video in db.query(Video).filter(Video.id.in_(video_ids)).all()}
    favorite_by_video = favorite_map(db, video_ids, user.id)
    job_map = active_job_map(db, video_ids)
    category_ids = {video.category_id for video in videos.values() if video.category_id}
    categories = {c.id: c.path for c in db.query(Category).filter(Category.id.in_(category_ids)).all()} if category_ids else {}
    result = []
    for history in histories:
        video = videos.get(history.video_id)
        if not video:
            continue
        result.append(serialize_video(
            video,
            history,
            job_map.get(video.id),
            categories.get(video.category_id),
            include_segments=False,
            include_details=False,
            favorite=favorite_by_video.get(video.id),
        ))
    return result


@router.get("/recent", response_model=list[VideoOut])
def get_recent_videos(
    limit: int = Query(8, ge=1, le=30),
    category_id: int | None = None,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    query = db.query(Video)
    if category_id:
        query = query.filter(Video.category_id == category_id)

    videos = query.order_by(Video.created_at.desc(), Video.id.desc()).limit(limit).all()
    if not videos:
        return []

    video_ids = [video.id for video in videos]
    watch_map = latest_watch_map(db, video_ids, _uid(user))
    favorite_by_video = favorite_map(db, video_ids, _uid(user))
    job_map = active_job_map(db, video_ids)
    category_ids = {video.category_id for video in videos if video.category_id}
    categories = {c.id: c.path for c in db.query(Category).filter(Category.id.in_(category_ids)).all()} if category_ids else {}
    return [
        serialize_video(
            video,
            watch_map.get(video.id),
            job_map.get(video.id),
            categories.get(video.category_id),
            include_segments=False,
            include_details=False,
            favorite=favorite_by_video.get(video.id),
        )
        for video in videos
    ]


@router.get("/{video_id}", response_model=VideoOut)
def get_video(
    video_id: int,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    watch_map = latest_watch_map(db, [video.id], _uid(user))
    job_map = active_job_map(db, [video.id])
    category_path = None
    if video.category_id:
        category = db.query(Category).filter(Category.id == video.category_id).first()
        category_path = category.path if category else None
    favorite = favorite_map(db, [video.id], _uid(user)).get(video.id)
    return serialize_video(
        video,
        watch_map.get(video.id),
        job_map.get(video.id),
        category_path,
        favorite=favorite,
    )


def iter_file_range(path: Path, start: int, end: int, chunk_size: int = 1024 * 1024):
    with path.open("rb") as file:
      file.seek(start)
      remaining = end - start + 1
      while remaining > 0:
          chunk = file.read(min(chunk_size, remaining))
          if not chunk:
              break
          remaining -= len(chunk)
          yield chunk


@router.get("/{video_id}/file")
def stream_video(video_id: int, request: Request):
    """按 Range 分段返回视频文件。

    **故意不用 Depends(get_db)**。

    FastAPI 的 get_db 依赖在「响应发送完毕之后」才 close，而视频是
    几百 MB 到几 GB、可能传上一小时 —— 那样一个 SELECT 会开着一个
    `idle in transaction` 长达整个播放时长，既占死连接池的一个连接，
    又对 videos 表持有 ACCESS SHARE 锁，把迁移的 ALTER TABLE 堵死。

    这就是 2026-11-16 那次整站 502 的同一类问题（当时是缩略图把 ffmpeg
    夹在 SELECT 和 commit 之间）。所以这里手动开一个短 session，
    只取 filepath/filename，取完立刻关，之后纯文件 IO。
    """
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        row = (
            db.query(Video.filepath, Video.filename)
            .filter(Video.id == video_id)
            .first()
        )
    finally:
        db.close()

    if row is None:
        raise HTTPException(status_code=404, detail="Video not found")
    video_path = resolve_media_path(row.filepath)
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")

    file_size = video_path.stat().st_size
    range_header = request.headers.get("range")
    headers = {
        "Accept-Ranges": "bytes",
    }

    if not range_header:
        headers["Content-Length"] = str(file_size)
        return FileResponse(video_path, media_type="video/mp4", filename=row.filename, headers=headers)

    try:
        unit, range_value = range_header.strip().split("=", 1)
        if unit != "bytes":
            raise ValueError
        start_text, end_text = range_value.split("-", 1)
        if start_text:
            start = int(start_text)
            end = int(end_text) if end_text else file_size - 1
        else:
            suffix_length = int(end_text)
            start = max(file_size - suffix_length, 0)
            end = file_size - 1
        if start < 0 or end >= file_size or start > end:
            raise ValueError
    except ValueError:
        return StreamingResponse(
            iter(()),
            status_code=416,
            headers={**headers, "Content-Range": f"bytes */{file_size}"},
            media_type="video/mp4",
        )

    headers.update({
        "Content-Length": str(end - start + 1),
        "Content-Range": f"bytes {start}-{end}/{file_size}",
    })
    return StreamingResponse(
        iter_file_range(video_path, start, end),
        status_code=206,
        headers=headers,
        media_type="video/mp4",
    )


@router.get("/{video_id}/thumbnail")
def get_thumbnail(video_id: int, db: Session = Depends(get_db)):
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    if video.thumbnail and resolve_media_path(video.thumbnail).exists():
        return FileResponse(resolve_media_path(video.thumbnail), media_type="image/jpeg")
    # 清空失效记录前先判断：如果这条路径明显属于另一个平台
    # （例如 Linux 容器里存着 D:\... 的 Windows 路径），说明是路径映射没配好
    # 而不是文件真的没了。此时误清会把好数据洗掉，只报 404 不动数据。
    if video.thumbnail:
        if _is_foreign_platform_path(video.thumbnail):
            logger.warning(
                "缩略图路径属于其他平台，不做清理（检查 PATH_MAP）: video=%s path=%s",
                video_id,
                video.thumbnail,
            )
        else:
            logger.info("缩略图文件缺失，清除记录: video=%s path=%s", video_id, video.thumbnail)
            video.thumbnail = None
            db.commit()
    placeholder = Path(__file__).parent.parent / "static" / "placeholder.png"
    if placeholder.exists():
        return FileResponse(str(placeholder), media_type="image/png")
    raise HTTPException(status_code=404, detail="Thumbnail not found")


@router.post("/history")
def save_watch_history(
    payload: WatchHistoryIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    video = db.query(Video).filter(Video.id == payload.video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    # duration 是共享视频元数据，只能由导入/管理流程写。
    # 原来这里会在 duration 为空时接受成员上报，等于任何登录用户
    # 都能改全库的时长，进而影响完成率和推荐。
    completed = bool(payload.duration and payload.progress / payload.duration >= 0.9)
    # 必须带 user_id：否则「2 分钟内合并同一条记录」会把别人的进度当成自己的覆盖掉
    latest = (
        db.query(WatchHistory)
        .filter(WatchHistory.video_id == payload.video_id, WatchHistory.user_id == user.id)
        .order_by(WatchHistory.watched_at.desc())
        .first()
    )
    now = datetime.now()
    previous_completed = bool(latest.completed) if latest else None
    created_new = latest is None or latest.watched_at is None or (
        now - latest.watched_at > timedelta(minutes=2)
    )
    if latest and latest.watched_at and now - latest.watched_at <= timedelta(minutes=2):
        latest.progress = payload.progress
        latest.duration = payload.duration
        latest.completed = completed
        latest.watched_at = now
    else:
        db.add(
            WatchHistory(
                user_id=user.id,
                video_id=payload.video_id,
                progress=payload.progress,
                duration=payload.duration,
                completed=completed,
                watched_at=now,
            )
        )
    db.commit()
    # 进度通常十几秒就上报一次。每报一次都删画像缓存会让 5 分钟 TTL 失效，
    # 只在「新建进度记录」或「完成状态发生变化」时失效；中间的累计时长
    # 最多陈旧一个 TTL，对聊天/路径规划足够。
    if created_new or previous_completed != completed:
        invalidate_profile_cache(user.id)
    return {"status": "ok", "completed": completed}


@router.post("/{video_id}/ai-jobs")
def start_ai_job(
    video_id: int,
    payload: AiJobCreate,
    db: Session = Depends(get_db),
    # 起转写任务会长时间占满 CPU，属管理操作
    _admin=Depends(require_admin),
):
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    job = create_ai_job_from_payload(db, video_id, payload)
    if job.status == "queued" and not _is_queue_paused():
        enqueue_ai_jobs([job.id], at_front=True)
    return {"job_id": job.id, "status": job.status, "stage": job.stage}


@router.post("/{video_id}/favorite", response_model=VideoOut)
def set_video_favorite(
    video_id: int,
    payload: VideoFavoriteIn,
    db: Session = Depends(get_db),
    # 收藏是当前用户的个人状态，不再改共享 videos.is_favorite
    user: User = Depends(get_current_user),
):
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    favorite = (
        db.query(UserVideoFavorite)
        .filter(
            UserVideoFavorite.user_id == user.id,
            UserVideoFavorite.video_id == video.id,
        )
        .first()
    )
    if payload.is_favorite:
        if favorite is None:
            favorite = UserVideoFavorite(
                user_id=user.id,
                video_id=video.id,
                favorited_at=datetime.now(),
            )
            db.add(favorite)
        # 已收藏时保留第一次收藏时间，重复点不刷新 favorited_at
    elif favorite is not None:
        db.delete(favorite)
        favorite = None
    db.commit()

    watch_map = latest_watch_map(db, [video.id], user.id)
    job_map = active_job_map(db, [video.id])
    category_path = None
    if video.category_id:
        category = db.query(Category).filter(Category.id == video.category_id).first()
        category_path = category.path if category else None
    return serialize_video(
        video,
        watch_map.get(video.id),
        job_map.get(video.id),
        category_path,
        favorite=favorite,
    )


@router.get("/{video_id}/playlist")
def get_playlist(
    video_id: int,
    scope: str = "leaf",
    category_id: int | None = None,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    query = db.query(Video)
    if scope == "descendants" and category_id:
        # Use the browsing context (the folder user clicked into)
        all_ids = _collect_descendant_ids(db, category_id)
        query = query.filter(Video.category_id.in_(all_ids))
        query = query.join(Category, Video.category_id == Category.id, isouter=True)
        query = query.order_by(Category.path.asc().nullslast(), Video.sort_key.asc().nullslast(), Video.id.asc())
    elif video.category_id:
        query = query.filter(Video.category_id == video.category_id)
        query = query.order_by(Video.sort_key.asc().nullslast(), Video.id.asc())
    else:
        query = query.filter(Video.id == video.id)
    videos = query.all()
    watch_map = latest_watch_map(db, [item.id for item in videos], _uid(user))
    favorite_by_video = favorite_map(db, [item.id for item in videos], _uid(user))

    items = []
    current_index = 0
    category_ids = {item.category_id for item in videos if item.category_id}
    category_map = {c.id: c.path for c in db.query(Category).filter(Category.id.in_(category_ids)).all()} if category_ids else {}
    for index, item in enumerate(videos):
        last_watch = watch_map.get(item.id)
        favorite = favorite_by_video.get(item.id)
        if item.id == video_id:
            current_index = index
        items.append(
            {
                "id": item.id,
                "title": item.title,
                "thumbnail": item.thumbnail,
                "category_path": category_map.get(item.category_id),
                "watch_progress": last_watch.progress if last_watch else None,
                "completed": bool(last_watch.completed) if last_watch else False,
                "is_favorite": bool(favorite),
                "favorited_at": favorite.favorited_at if favorite else None,
                "subtitle_url": to_output_url(item.subtitle_path),
            }
        )
    return {"videos": items, "current_index": current_index, "total": len(items)}


@router.get("/{video_id}/notes", response_model=NoteOut)
def get_video_note(
    video_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """读视频的共享笔记（AI 转写产物）。

    三处修正：

    1. **加鉴权**。原来不需要登录，而这接口会经 ensure_video_note 落到
       notes 表上 —— 在修 scope 过滤之前，它能读到任意用户的私有笔记。
       现在虽然只读 shared，但共享笔记也不该对匿名开放（视频库是登录内容）。
    2. **去掉写副作用**。原来「没有笔记就建一条」，于是每打开一次视频详情
       就多插一行。GET 应该是幂等的，创建交给转写流程或显式 POST。
    3. **读文件前解析路径**。库里存的可能是宿主机路径（D://...），
       容器里直接 Path() 必然找不到，会静默返回空内容。
    """
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    note = (
        db.query(Note)
        .filter(Note.video_id == video_id, Note.scope == "shared")
        .order_by(Note.updated_at.desc())
        .first()
    )
    if note is None:
        raise HTTPException(status_code=404, detail="该视频还没有共享笔记")

    if note.markdown_path:
        note_path = resolve_media_path(note.markdown_path)
        if note_path.exists():
            # 只读出内容返回，不写回 DB：这个字段是文件内容的镜像，
            # 每次 GET 都 commit 一次会让 updated_at 无意义地跳动。
            note.content = note_path.read_text(encoding="utf-8")
    return note


@router.get("/{video_id}/subtitle")
def get_subtitle_file(video_id: int, db: Session = Depends(get_db)):
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video or not video.subtitle_path:
        raise HTTPException(status_code=404, detail="Subtitle not found")
    subtitle_file = resolve_media_path(video.subtitle_path)
    if not subtitle_file.exists():
        raise HTTPException(status_code=404, detail="Subtitle file missing")
    return FileResponse(subtitle_file, media_type="text/vtt", filename=subtitle_file.name)


@router.get("/{video_id}/segments", response_model=list[SubtitleSegmentOut])
def get_video_segments(video_id: int, db: Session = Depends(get_db)):
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    return (
        db.query(SubtitleSegment)
        .filter(SubtitleSegment.video_id == video_id)
        .order_by(SubtitleSegment.segment_index)
        .all()
    )


@router.get("/{video_id}/sprite")
def get_sprite_sheet(video_id: int):
    """缩略图雪碧图。首次请求会现场抽帧，所以要短事务。

    get_or_generate_sprite 要跑几十次 ffmpeg 抽帧再拼图，几秒到十几秒。
    原来用 Depends(get_db)，那段时间一直握着 videos 的读事务 ——
    和缩略图 worker 那个把后端启动卡死 12 分钟的问题是同一模式。
    """
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        row = db.query(Video.filepath).filter(Video.id == video_id).first()
    finally:
        db.close()

    if row is None:
        raise HTTPException(status_code=404, detail="Video not found")
    source_path = resolve_media_path(row.filepath)
    if not source_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")

    sprite_path = get_sprite_path(video_id)
    if not has_sprite(video_id):
        meta = get_or_generate_sprite(str(source_path), video_id)
        if not meta:
            raise HTTPException(status_code=500, detail="Sprite generation failed")
    else:
        meta_path = get_sprite_meta_path(video_id)
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            meta = None

    if not sprite_path.exists():
        raise HTTPException(status_code=404, detail="Sprite not found")

    return FileResponse(sprite_path, media_type="image/jpeg", headers={
        "X-Sprite-Meta": json.dumps(meta) if meta else "{}",
        "Cache-Control": "public, max-age=86400",
    })


@router.put("/{video_id}/segments/{segment_index}")
def update_segment(
    video_id: int,
    segment_index: int,
    payload: SubtitleSegmentUpdate,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),  # 改字幕等于改检索语料，仅管理员可操作
):
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    segment = (
        db.query(SubtitleSegment)
        .filter(SubtitleSegment.video_id == video_id, SubtitleSegment.segment_index == segment_index)
        .first()
    )
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")

    new_text = payload.text.strip()
    segment.text = new_text

    # Update transcript_segments JSON in Video model
    segments = load_segments(video.transcript_segments) if video.transcript_segments else []
    if 0 <= segment_index < len(segments):
        segments[segment_index]["text"] = new_text
        video.transcript_segments = dump_segments(segments)

    # Rebuild transcription from segments
    if segments:
        video.transcription = "\n".join((s.get("text") or "").strip() for s in segments).strip()

    # Update VTT file on disk
    if video.subtitle_path:
        subtitle_file = resolve_media_path(video.subtitle_path)
        if subtitle_file.exists():
            update_vtt_segment_text(subtitle_file, segment_index, new_text)

    db.commit()
    return {"status": "ok"}
