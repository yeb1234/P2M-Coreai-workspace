"""学习行为采集与用户画像聚合。

数据分两层：
- watch_events：事件流，记录「发生了什么」（播放/暂停/拖动/心跳/倍速）
- user_profiles：画像快照，由事件流聚合而成，供推荐与路径规划读取

为什么要事件流而不是只靠 watch_history：
watch_history 只有「当前进度」一个快照，算不出真实观看时长（跳过片头、
倍速、反复重看都失真）。事件流按 delta_sec 累加才是真实投入时间。
"""

from __future__ import annotations

import logging
from collections import Counter, defaultdict
from datetime import datetime, timedelta

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.models import Note, ScheduleItem, User, UserProfile, Video, WatchEvent, WatchHistory

logger = logging.getLogger(__name__)

VALID_EVENT_TYPES = {"play", "pause", "seek", "rate", "heartbeat", "ended", "close"}


def ingest_event(
    db: Session,
    *,
    video_id: int,
    event_type: str,
    position_sec: float,
    duration_sec: float | None = None,
    playback_rate: float = 1.0,
    delta_sec: float = 0.0,
    session_id: str | None = None,
    user_id: int | None = None,
) -> WatchEvent:
    """写入一条行为事件。

    delta_sec 由客户端按「实际播放时间」上报；服务端做上界钳制，
    防止一次事件把画像时长刷爆（例如客户端 bug 报来 10 万秒）。
    """
    if event_type not in VALID_EVENT_TYPES:
        raise ValueError(f"未知事件类型: {event_type}")

    safe_delta = max(0.0, min(float(delta_sec or 0.0), 3600.0))
    event = WatchEvent(
        user_id=user_id,
        video_id=video_id,
        session_id=(session_id or "")[:64] or None,
        event_type=event_type,
        position_sec=max(0.0, float(position_sec or 0.0)),
        duration_sec=float(duration_sec) if duration_sec else None,
        playback_rate=max(0.25, min(float(playback_rate or 1.0), 4.0)),
        delta_sec=safe_delta,
        occurred_at=datetime.now(),
    )
    db.add(event)
    db.commit()
    return event


def _hour_histogram(db: Session, user_id: int | None, since: datetime) -> dict[str, int]:
    query = db.query(WatchEvent.occurred_at, WatchEvent.delta_sec).filter(
        WatchEvent.occurred_at >= since, WatchEvent.delta_sec > 0
    )
    if user_id is not None:
        query = query.filter(WatchEvent.user_id == user_id)

    buckets: dict[str, float] = defaultdict(float)
    for occurred_at, delta in query.all():
        if occurred_at is None:
            continue
        buckets[str(occurred_at.hour)] += float(delta or 0)
    # 转成分钟并只保留有数据的时段
    return {hour: int(seconds // 60) for hour, seconds in sorted(buckets.items()) if seconds >= 60}


def _top_categories(db: Session, user_id: int | None, since: datetime, limit: int = 6) -> list[dict]:
    query = (
        db.query(Video.category_id, func.sum(WatchEvent.delta_sec).label("secs"))
        .join(Video, Video.id == WatchEvent.video_id)
        .filter(WatchEvent.occurred_at >= since, WatchEvent.delta_sec > 0)
    )
    if user_id is not None:
        query = query.filter(WatchEvent.user_id == user_id)
    rows = query.group_by(Video.category_id).order_by(func.sum(WatchEvent.delta_sec).desc()).limit(limit).all()

    total = sum(float(row[1] or 0) for row in rows) or 1.0
    result = []
    for category_id, secs in rows:
        if category_id is None:
            continue
        label = db.execute(
            text("SELECT name FROM categories WHERE id = :cid"), {"cid": category_id}
        ).scalar()
        result.append(
            {
                "category_id": int(category_id),
                "name": label or f"分类{category_id}",
                "minutes": int(float(secs or 0) // 60),
                "share": round(float(secs or 0) / total, 3),
            }
        )
    return result


def _streak_days(db: Session, user_id: int | None) -> int:
    """连续学习天数。

    从「最近有学习记录的那天」往前数，而不是从今天。
    但如果最近一次学习已经是前天或更早，说明链条断了，直接归零 ——
    否则会出现「三周没学习，却显示连续 5 天」的荒谬结果。
    """
    query = db.query(func.date(WatchEvent.occurred_at)).filter(WatchEvent.delta_sec > 0)
    if user_id is not None:
        query = query.filter(WatchEvent.user_id == user_id)
    raw_days = [row[0] for row in query.distinct().all() if row[0]]
    if not raw_days:
        return 0

    def to_date(value):
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, str):
            try:
                return datetime.strptime(value[:10], "%Y-%m-%d").date()
            except ValueError:
                return None
        return value

    days = sorted({d for d in (to_date(v) for v in raw_days) if d}, reverse=True)
    if not days:
        return 0

    today = datetime.now().date()
    if (today - days[0]).days > 1:
        return 0  # 断档超过一天，连续记录清零

    day_set = set(days)
    streak = 0
    cursor = days[0]
    while cursor in day_set:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def resolve_user_id(db: Session, user_id: int | None) -> int:
    """把 None 解析成一个真实存在的 user_id。

    user_profiles 的主键是 user_id 且有外键约束，传 None/0 会直接违反约束。
    单机场景下落到最早创建的用户；一个用户都没有时建一个本地占位账号。
    """
    if user_id is not None:
        exists = db.query(User.id).filter(User.id == user_id).first()
        if exists:
            return user_id

    first = db.query(User.id).order_by(User.id).first()
    if first:
        return int(first[0])

    guest = User(username="local", password_hash="!", display_name="本地用户")
    db.add(guest)
    db.commit()
    db.refresh(guest)
    logger.info("创建本地占位用户 id=%s", guest.id)
    return int(guest.id)


def recompute_profile(db: Session, user_id: int | None = None) -> UserProfile:
    """重算画像。30 天窗口统计活跃习惯，全量窗口统计累计投入。"""
    resolved_id = resolve_user_id(db, user_id)
    since_30d = datetime.now() - timedelta(days=30)

    event_query = db.query(WatchEvent)
    if user_id is not None:
        event_query = event_query.filter(WatchEvent.user_id == user_id)
    events = event_query.all()

    total_watch_sec = sum(float(e.delta_sec or 0) for e in events)
    event_video_ids = {e.video_id for e in events if e.event_type in ("play", "heartbeat")}

    # 完成度以 watch_history 为准（播放器上报的进度快照）
    # 注：watch_history 目前没有 user_id 列，单用户场景下不按用户过滤
    history = db.query(WatchHistory).all()
    history_video_ids = {h.video_id for h in history}
    completed_ids = {h.video_id for h in history if h.completed}

    # 「开始过」要把历史快照也算进来：新埋点上线前的老数据只有 history
    videos_started = len(event_video_ids | history_video_ids)
    videos_completed = len(completed_ids)
    completion_rate = round(videos_completed / videos_started, 4) if videos_started else 0.0

    # 单次会话时长：按 session_id 聚合，没有 session_id 的按天退化
    session_secs: dict[str, float] = defaultdict(float)
    for event in events:
        key = event.session_id or (event.occurred_at.strftime("%Y%m%d") if event.occurred_at else "unknown")
        session_secs[key] += float(event.delta_sec or 0)
    session_minutes = [secs / 60 for secs in session_secs.values() if secs >= 60]
    avg_session_min = round(sum(session_minutes) / len(session_minutes), 1) if session_minutes else 0.0

    active_days = len({e.occurred_at.date() for e in events if e.occurred_at and e.delta_sec > 0})
    last_active = max((e.occurred_at for e in events if e.occurred_at), default=None)

    notes_query = db.query(func.count(Note.id))
    notes_count = notes_query.scalar() or 0

    profile = db.query(UserProfile).filter(UserProfile.user_id == resolved_id).first()
    if profile is None:
        profile = UserProfile(user_id=resolved_id)
        db.add(profile)

    profile.total_watch_sec = round(total_watch_sec, 1)
    profile.videos_started = videos_started
    profile.videos_completed = videos_completed
    profile.completion_rate = completion_rate
    profile.avg_session_min = avg_session_min
    profile.active_days_30d = len(
        {e.occurred_at.date() for e in events if e.occurred_at and e.occurred_at >= since_30d and e.delta_sec > 0}
    )
    profile.streak_days = _streak_days(db, user_id)
    profile.notes_count = int(notes_count)
    profile.active_hours = _hour_histogram(db, user_id, since_30d)
    profile.top_categories = _top_categories(db, user_id, since_30d)
    profile.last_active_at = last_active
    profile.computed_at = datetime.now()

    db.commit()
    db.refresh(profile)
    return profile


def profile_to_dict(profile: UserProfile) -> dict:
    """给 LLM 与前端消费的可读画像。"""
    total_min = int((profile.total_watch_sec or 0) // 60)
    return {
        "total_watch_minutes": total_min,
        "videos_started": profile.videos_started,
        "videos_completed": profile.videos_completed,
        "completion_rate": profile.completion_rate,
        "avg_session_minutes": profile.avg_session_min,
        "active_days_30d": profile.active_days_30d,
        "streak_days": profile.streak_days,
        "notes_count": profile.notes_count,
        "active_hours": profile.active_hours or {},
        "top_categories": profile.top_categories or [],
        "last_active_at": profile.last_active_at.isoformat() if profile.last_active_at else None,
        "computed_at": profile.computed_at.isoformat() if profile.computed_at else None,
    }


def profile_summary_text(profile: UserProfile) -> str:
    """压成一段话喂给 LLM，避免把整个 JSON 塞进 prompt。"""
    data = profile_to_dict(profile)
    parts = [
        f"累计观看 {data['total_watch_minutes']} 分钟，"
        f"接触 {data['videos_started']} 个视频，完成 {data['videos_completed']} 个"
        f"（完成率 {data['completion_rate']:.0%}）",
        f"单次平均专注 {data['avg_session_minutes']} 分钟",
        f"近 30 天活跃 {data['active_days_30d']} 天，连续学习 {data['streak_days']} 天",
    ]
    if data["top_categories"]:
        tops = "，".join(f"{c['name']}({c['minutes']}min)" for c in data["top_categories"][:4])
        parts.append(f"投入最多的是 {tops}")
    if data["active_hours"]:
        best_hours = sorted(data["active_hours"].items(), key=lambda kv: kv[1], reverse=True)[:3]
        parts.append("最常学习时段：" + "、".join(f"{h}点" for h, _ in best_hours))
    if data["notes_count"]:
        parts.append(f"累计笔记 {data['notes_count']} 篇")
    return "；".join(parts) + "。"
