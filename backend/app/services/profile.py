"""学习行为采集与用户画像聚合。

数据分两层：
- watch_events：事件流，记录「发生了什么」（播放/暂停/拖动/心跳/倍速）
- user_profiles：画像快照，由事件流聚合而成，供推荐与路径规划读取

为什么要事件流而不是只靠 watch_history：
watch_history 只有「当前进度」一个快照，算不出真实观看时长（跳过片头、
倍速、反复重看都失真）。事件流按 delta_sec 累加才是真实投入时间。
"""

from __future__ import annotations

import json
import logging
import threading
from collections import Counter, defaultdict
from datetime import datetime, timedelta

from sqlalchemy import distinct, func, text
from sqlalchemy.orm import Session

from app.database import settings
from app.models import Note, ScheduleItem, User, UserProfile, Video, WatchEvent, WatchHistory

logger = logging.getLogger(__name__)

PROFILE_CACHE_TTL_SECONDS = 300
_PROFILE_CACHE_PREFIX = "profile:v1:"
_PROFILE_REDIS = None
_PROFILE_REDIS_LOCK = threading.Lock()


def _cache_client():
    """懒加载 Redis；连不上就返回 None，画像读取不因缓存故障失败。"""
    global _PROFILE_REDIS
    if _PROFILE_REDIS is not None:
        return _PROFILE_REDIS
    with _PROFILE_REDIS_LOCK:
        if _PROFILE_REDIS is not None:
            return _PROFILE_REDIS
        try:
            import redis

            _PROFILE_REDIS = redis.Redis.from_url(
                settings.redis_url,
                decode_responses=True,
                socket_connect_timeout=0.2,
                socket_timeout=0.2,
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("画像缓存 Redis 不可用: %s", exc)
            return None
    return _PROFILE_REDIS


def _profile_cache_key(user_id: int) -> str:
    return f"{_PROFILE_CACHE_PREFIX}{user_id}"


def invalidate_profile_cache(user_id: int | None) -> None:
    """删除画像缓存。观看事件、进度写入或手动重算时调用。"""
    if user_id is None:
        return
    client = _cache_client()
    if client is None:
        return
    try:
        client.delete(_profile_cache_key(user_id))
    except Exception as exc:  # noqa: BLE001
        logger.debug("画像缓存失效失败 user=%s: %s", user_id, exc)


VALID_EVENT_TYPES = {"play", "pause", "seek", "rate", "heartbeat", "ended", "close"}


def _hour_histogram(db: Session, user_id: int | None, since: datetime) -> dict[str, int]:
    """活跃时段分布（分钟）。30 天窗口一次 GROUP BY，不把事件行捞出来。"""
    hour_expr = func.extract("hour", WatchEvent.occurred_at)
    query = (
        db.query(hour_expr.label("h"), func.sum(WatchEvent.delta_sec))
        .filter(
            WatchEvent.occurred_at >= since,
            WatchEvent.delta_sec > 0,
            WatchEvent.occurred_at.isnot(None),
        )
    )
    if user_id is not None:
        query = query.filter(WatchEvent.user_id == user_id)

    # 转成分钟并只保留有数据的时段
    return {
        str(int(hour)): int(round(float(secs or 0) / 60))
        for hour, secs in query.group_by("h").all()
        if hour is not None and secs
    }


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
    """重算画像。30 天窗口统计活跃习惯，全量窗口统计累计投入。

    ## 所有聚合都下推到 SQL

    心跳是 30 秒一条：重度用户一年就是几十万行。原实现把这些行
    **整表捞进内存**再在 Python 里 sum/set/groupby —— 而 recompute_profile
    在每次聊天、每次路径规划、每个 agent 工具调用里都会跑一次，
    内存和延迟都随使用时长线性增长。

    现在每个指标都是一条带 GROUP BY / DISTINCT 的聚合查询，
    返回的是几十个标量，不是几十万行。

    另外修了一个越权：notes_count 原来数的是**全库笔记**（不加 user_id 也不加
    scope），所有用户看到同一个数字，而且把 8770 条 AI 生成的 shared 笔记
    也算成「我写的」。改成只数本人 private 笔记。
    """
    resolved_id = resolve_user_id(db, user_id)
    since_30d = datetime.now() - timedelta(days=30)

    # 必须用 resolved_id 而不是入参 user_id。
    # 入参为 None 时原实现会跳过过滤，把所有用户的事件加在一起算到一个人头上，
    # 多用户下等于画像串号。

    # ① 累计时长 + 最后活跃：一次聚合
    total_watch_sec, last_active = (
        db.query(
            func.coalesce(func.sum(WatchEvent.delta_sec), 0),
            func.max(WatchEvent.occurred_at),
        )
        .filter(WatchEvent.user_id == resolved_id)
        .one()
    )
    total_watch_sec = float(total_watch_sec or 0)

    # ② 播放过的视频：只要 DISTINCT video_id
    event_video_ids = {
        vid
        for (vid,) in db.query(distinct(WatchEvent.video_id))
        .filter(
            WatchEvent.user_id == resolved_id,
            WatchEvent.event_type.in_(("play", "heartbeat")),
            WatchEvent.video_id.isnot(None),
        )
        .all()
    }

    # ③ 完成度以 watch_history 为准（播放器上报的进度快照）
    history = db.query(WatchHistory).filter(WatchHistory.user_id == resolved_id).all()
    history_video_ids = {h.video_id for h in history}
    completed_ids = {h.video_id for h in history if h.completed}

    videos_started = len(event_video_ids | history_video_ids)
    videos_completed = len(completed_ids)
    completion_rate = round(videos_completed / videos_started, 4) if videos_started else 0.0

    # ④ 单次会话时长：有 session_id 的按会话聚合；
    #    没有 session_id 的老数据按天退化（不能丢，否则老用户画像全是 0）
    session_secs = dict(
        db.query(WatchEvent.session_id, func.sum(WatchEvent.delta_sec))
        .filter(WatchEvent.user_id == resolved_id, WatchEvent.session_id.isnot(None))
        .group_by(WatchEvent.session_id)
        .all()
    )
    legacy_day_secs = dict(
        db.query(
            func.date(WatchEvent.occurred_at).label("d"),
            func.sum(WatchEvent.delta_sec),
        )
        .filter(WatchEvent.user_id == resolved_id, WatchEvent.session_id.is_(None))
        .group_by("d")
        .all()
    )
    session_minutes = [
        secs / 60
        for secs in list(session_secs.values()) + list(legacy_day_secs.values())
        if secs and secs >= 60
    ]
    avg_session_min = round(sum(session_minutes) / len(session_minutes), 1) if session_minutes else 0.0

    # ⑤ 活跃天数：全量一次、30 天一次
    active_days = (
        db.query(func.count(distinct(func.date(WatchEvent.occurred_at))))
        .filter(WatchEvent.user_id == resolved_id, WatchEvent.delta_sec > 0)
        .scalar()
    ) or 0

    active_days_30d = (
        db.query(func.count(distinct(func.date(WatchEvent.occurred_at))))
        .filter(
            WatchEvent.user_id == resolved_id,
            WatchEvent.delta_sec > 0,
            WatchEvent.occurred_at >= since_30d,
        )
        .scalar()
    ) or 0

    # ⑥ 笔记数：只数本人 private。shared 是 AI 转写产物，
    #    属于共享视频库，不该算进「我写的笔记」。
    notes_count = (
        db.query(func.count(Note.id))
        .filter(Note.user_id == resolved_id, Note.scope == "private")
        .scalar()
    ) or 0

    profile = db.query(UserProfile).filter(UserProfile.user_id == resolved_id).first()
    if profile is None:
        profile = UserProfile(user_id=resolved_id)
        db.add(profile)

    profile.total_watch_sec = round(total_watch_sec, 1)
    profile.videos_started = videos_started
    profile.videos_completed = videos_completed
    profile.completion_rate = completion_rate
    profile.avg_session_min = avg_session_min
    profile.active_days_30d = int(active_days_30d)
    profile.streak_days = _streak_days(db, resolved_id)
    profile.notes_count = int(notes_count)
    profile.active_hours = _hour_histogram(db, resolved_id, since_30d)
    profile.top_categories = _top_categories(db, resolved_id, since_30d)
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


def get_profile_data(db: Session, user_id: int | None = None) -> dict:
    """读取画像 dict，优先走 5 分钟 Redis 缓存。

    缓存的是 profile_to_dict 的可序列化结果，不是 ORM 对象；
    这样 session 关闭后不会触发 lazy load，也不会把连接绑在缓存里。
    """
    resolved_id = resolve_user_id(db, user_id)
    key = _profile_cache_key(resolved_id)
    client = _cache_client()
    if client is not None:
        try:
            cached = client.get(key)
            if cached:
                return json.loads(cached)
        except Exception as exc:  # noqa: BLE001
            logger.debug("画像缓存读取失败 user=%s: %s", resolved_id, exc)

    profile = recompute_profile(db, resolved_id)
    data = profile_to_dict(profile)
    if client is not None:
        try:
            client.setex(
                key,
                PROFILE_CACHE_TTL_SECONDS,
                json.dumps(data, ensure_ascii=False),
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("画像缓存写入失败 user=%s: %s", resolved_id, exc)
    return data


def profile_summary_text(profile: UserProfile | dict) -> str:
    """压成一段话喂给 LLM，避免把整个 JSON 塞进 prompt。"""
    data = profile if isinstance(profile, dict) else profile_to_dict(profile)
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
        # 这里统计的是 recompute_profile 里按 user_id 过滤后的 private 笔记，
        # 不能再写成“视频库全库转写笔记”，否则模型会把个人记录误读成共享库数量。
        parts.append(f"你已记录 {data['notes_count']} 篇私人笔记")
    return "；".join(parts) + "。"
