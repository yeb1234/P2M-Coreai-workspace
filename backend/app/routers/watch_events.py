"""播放行为埋点 API。

为什么要批量接口而不是一条一个请求：
播放器每 15 秒上报一次心跳，一个 2 小时的视频就是 480 次。
逐条 POST 会把连接数打满，而且每次 commit 都是独立事务，写入开销远大于数据本身。

服务端对 delta_sec 做上界钳制（客户端 bug 报来 10 万秒会直接毁掉画像），
并且对未知 event_type 直接拒绝，不做静默兜底。
"""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import desc, func

from app.auth import get_current_user, get_optional_user
from app.database import SessionLocal
from app.models import User, Video, WatchEvent
from app.services.profile import VALID_EVENT_TYPES, recompute_profile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/watch-events", tags=["watch-events"])

MAX_EVENTS_PER_BATCH = 200
MAX_DELTA_SEC = 3600.0


class WatchEventIn(BaseModel):
    video_id: int
    event_type: str = Field(min_length=2, max_length=20)
    position_sec: float = Field(default=0.0, ge=0)
    duration_sec: float | None = Field(default=None, ge=0)
    playback_rate: float = Field(default=1.0, ge=0.25, le=4.0)
    delta_sec: float = Field(default=0.0, ge=0)
    session_id: str = Field(default="", max_length=64)
    occurred_at: datetime | None = None


class WatchEventBatchIn(BaseModel):
    events: list[WatchEventIn] = Field(min_length=1, max_length=MAX_EVENTS_PER_BATCH)


class WatchEventBatchOut(BaseModel):
    accepted: int
    rejected: int
    total_delta_sec: float


@router.post("", response_model=WatchEventBatchOut)
def ingest_watch_events(
    payload: WatchEventBatchIn,
    user: User | None = Depends(get_optional_user),
):
    """批量写入播放事件。整体一次事务，避免 480 次心跳产生 480 次 commit。

    用可选登录而不是强制登录：埋点属于统计链路，令牌过期不该让播放器报错。
    未登录时 user_id 落 NULL，管理员可在后台看到这批「无主」数据。
    """
    db = SessionLocal()
    accepted = 0
    rejected = 0
    total_delta = 0.0
    user_id = user.id if user else None
    try:
        valid_video_ids = {
            row[0]
            for row in db.query(Video.id)
            .filter(Video.id.in_({event.video_id for event in payload.events}))
            .all()
        }

        rows: list[WatchEvent] = []
        for event in payload.events:
            if event.event_type not in VALID_EVENT_TYPES:
                rejected += 1
                continue
            if event.video_id not in valid_video_ids:
                rejected += 1
                continue

            delta = max(0.0, min(float(event.delta_sec or 0.0), MAX_DELTA_SEC))
            rows.append(
                WatchEvent(
                    user_id=user_id,
                    video_id=event.video_id,
                    session_id=(event.session_id or "")[:64] or None,
                    event_type=event.event_type,
                    position_sec=max(0.0, float(event.position_sec or 0.0)),
                    duration_sec=float(event.duration_sec) if event.duration_sec else None,
                    playback_rate=event.playback_rate,
                    delta_sec=delta,
                    occurred_at=event.occurred_at or datetime.now(),
                )
            )
            accepted += 1
            total_delta += delta

        if rows:
            db.add_all(rows)
            db.commit()
    finally:
        db.close()

    return WatchEventBatchOut(
        accepted=accepted,
        rejected=rejected,
        total_delta_sec=round(total_delta, 1),
    )


@router.get("/stats")
def watch_event_stats(
    days: int = Query(7, ge=1, le=365),
    user: User = Depends(get_current_user),
):
    """埋点健康度：有多少天有数据、累计多久、最近一次是什么时候。

    按当前用户过滤。管理员想看全局用 /api/admin/health。
    """
    db = SessionLocal()
    try:
        since = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        base = db.query(WatchEvent).filter(WatchEvent.user_id == user.id)
        total = base.count()
        recent = base.filter(WatchEvent.occurred_at >= since).count()
        last_at = db.query(func.max(WatchEvent.occurred_at)).filter(
            WatchEvent.user_id == user.id
        ).scalar()
        total_sec = db.query(func.coalesce(func.sum(WatchEvent.delta_sec), 0.0)).filter(
            WatchEvent.user_id == user.id
        ).scalar() or 0.0
        active_days = (
            db.query(func.count(func.distinct(func.date(WatchEvent.occurred_at))))
            .filter(WatchEvent.user_id == user.id, WatchEvent.delta_sec > 0)
            .scalar()
            or 0
        )
        return {
            "total_events": int(total),
            "today_events": int(recent),
            "active_days": int(active_days),
            "total_watch_minutes": round(float(total_sec) / 60, 1),
            "last_event_at": last_at.isoformat() if last_at else None,
            "instrumented": total > 0,
        }
    finally:
        db.close()


@router.post("/recompute-profile")
def recompute(user: User = Depends(get_current_user)):
    """手动触发画像重算（埋点灌入后、或想立刻看到最新画像时用）。"""
    db = SessionLocal()
    try:
        profile = recompute_profile(db, user.id)
        return {
            "user_id": profile.user_id,
            "videos_started": profile.videos_started,
            "completion_rate": profile.completion_rate,
            "total_watch_minutes": round((profile.total_watch_sec or 0) / 60, 1),
            "computed_at": profile.computed_at.isoformat() if profile.computed_at else None,
        }
    finally:
        db.close()
