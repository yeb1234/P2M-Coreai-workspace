"""学习轨迹：把散在五个地方的数据串成一条成长线。

为什么单独做这一层
----------------
数据一直是有的，但没人把它们放在一起看：
    观看时长    watch_events
    完成率      watch_history
    笔记        notes
    日历        schedule_items
    专注        user_data['p2m-pomodoro-history-v2']   ← 番茄钟，前端同步上来的

画像（profile.py）只聚合了前三项，而且是给 Agent 做判断用的，不是给人看的。
这个模块的目标不同：**让人看见自己在进步**。所以它关心的是等级、连续、里程碑，
而不是「你该学什么」。

经验值算法
---------
刻意保持简单可解释，不做加权魔法：
    观看 1 分钟 = 1 点
    专注 1 分钟 = 2 点（番茄钟的专注度高于被动看视频）
    写 1 篇笔记 = 5 点
    完成 1 个视频 = 20 点

面试时如果被问「这个等级怎么算的」，能一句话说清比复杂公式有用。
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Note, UserData, UserProfile, WatchEvent, WatchHistory

logger = logging.getLogger(__name__)

POMODORO_KEY = "p2m-pomodoro-history-v2"

# (累计经验下限, 等级名, 一句话描述)
LEVELS: list[tuple[int, str, str]] = [
    (0, "刚上路", "还在找方向，先把第一个视频看完"),
    (300, "初窥门径", "开始有节奏了"),
    (1000, "渐入佳境", "能连着几天坐下来学"),
    (2500, "小有所成", "手上的东西开始串起来"),
    (5000, "独当一面", "能独立把一个东西搭起来"),
    (9000, "渐成体系", "知识之间开始互相支撑"),
    (15000, "融会贯通", "能讲给别人听"),
    (24000, "炉火纯青", "开始有自己的判断"),
]


def _pomodoro_stats(db: Session, user_id: int) -> tuple[float, int, int]:
    """返回 (专注分钟, 完成的番茄数, 总番茄数)。"""
    row = (
        db.query(UserData)
        .filter(UserData.user_id == user_id, UserData.store_key == POMODORO_KEY)
        .first()
    )
    if not row or not row.value:
        return 0.0, 0, 0
    try:
        payload = json.loads(row.value)
    except (TypeError, ValueError):
        logger.warning("番茄钟数据解析失败 user=%s", user_id)
        return 0.0, 0, 0

    sessions = payload.get("sessions") or {}
    if isinstance(sessions, list):  # 兼容早期数组格式
        sessions = {str(i): s for i, s in enumerate(sessions)}

    total_sec = 0.0
    completed = 0
    for item in sessions.values():
        if not isinstance(item, dict):
            continue
        if item.get("completed"):
            completed += 1
            # actualDuration 单位是秒
            total_sec += float(item.get("actualDuration") or 0)
    return total_sec / 60.0, completed, len(sessions)


def _heatmap(db: Session, user_id: int, days: int = 91) -> list[dict]:
    """近 N 天每天的观看分钟，用于画热力图。缺的天补 0。"""
    since = datetime.now() - timedelta(days=days - 1)
    rows = (
        db.query(
            func.date(WatchEvent.occurred_at).label("d"),
            func.sum(WatchEvent.delta_sec).label("secs"),
        )
        .filter(WatchEvent.user_id == user_id, WatchEvent.occurred_at >= since)
        .group_by(func.date(WatchEvent.occurred_at))
        .all()
    )
    by_day: dict[str, int] = {}
    for r in rows:
        key = str(r.d)
        by_day[key] = int(round((r.secs or 0) / 60))

    out: list[dict] = []
    today = date.today()
    for offset in range(days - 1, -1, -1):
        d = today - timedelta(days=offset)
        key = d.isoformat()
        out.append({"date": key, "minutes": by_day.get(key, 0)})
    return out


def _milestones(
    *,
    total_minutes: float,
    streak_days: int,
    videos_completed: int,
    notes_count: int,
    focus_count: int,
    category_count: int,
) -> list[dict]:
    """成就墙。未解锁的带进度，这样看得出「差多少」。"""
    def make(mid: str, title: str, desc: str, current: float, target: float, icon: str) -> dict:
        unlocked = current >= target
        return {
            "id": mid,
            "title": title,
            "desc": desc,
            "icon": icon,
            "unlocked": unlocked,
            "current": round(current, 1),
            "target": target,
            "progress": 1.0 if unlocked else round(min(current / target, 0.999), 3),
        }

    return [
        make("first_blood", "第一次坐下来", "累计观看 1 分钟", total_minutes, 1, "sprout"),
        make("hour_10", "十小时俱乐部", "累计观看 10 小时", total_minutes, 600, "clock"),
        make("hour_50", "五十小时", "累计观看 50 小时", total_minutes, 3000, "flame"),
        make("streak_7", "一周不断", "连续学习 7 天", streak_days, 7, "calendar"),
        make("streak_30", "月满", "连续学习 30 天", streak_days, 30, "moon"),
        make("streak_100", "百日筑基", "连续学习 100 天", streak_days, 100, "trophy"),
        make("finish_1", "完整看完一课", "完成 1 个视频", videos_completed, 1, "check"),
        make("finish_20", "有始有终", "完成 20 个视频", videos_completed, 20, "target"),
        make("note_10", "开始记录", "写 10 篇笔记", notes_count, 10, "pen"),
        make("note_50", "笔耕不辍", "写 50 篇笔记", notes_count, 50, "book"),
        make("focus_50", "专注五十", "完成 50 个番茄", focus_count, 50, "timer"),
        make("explore_5", "跨界选手", "接触 5 个不同领域", category_count, 5, "compass"),
    ]


def build_journey(db: Session, user_id: int) -> dict:
    profile = (
        db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
    )
    total_minutes = float(profile.total_watch_sec or 0) / 60.0 if profile else 0.0
    streak_days = int(profile.streak_days or 0) if profile else 0
    videos_started = int(profile.videos_started or 0) if profile else 0
    videos_completed = int(profile.videos_completed or 0) if profile else 0
    notes_count = int(profile.notes_count or 0) if profile else 0
    active_days = int(profile.active_days_30d or 0) if profile else 0

    # notes 表有两个坑：
    # 1. 没有 user_id —— 笔记按视频关联，是全局数据
    # 2. source='ai' 的是转写时自动生成的，每个有字幕的视频都有一条
    #
    # 如果不过滤 source，demo 账号会显示「笔记 8770 篇」，
    # 经验值直接冲到满级 —— 那些是系统产物，不是人写的。
    # 所以这里只统计 source != 'ai' 的（用户手写的）。
    # profile.py 那边仍然是全库计数，两处口径不同是有意的：
    # 画像关心「库里有内容」，轨迹关心「这个人做了多少」。
    live_notes = (
        db.query(func.count(Note.id))
        .filter((Note.source.is_(None)) | (Note.source != "ai"))
        .scalar()
        or 0
    )
    notes_count = int(live_notes)

    focus_minutes, focus_count, focus_total = _pomodoro_stats(db, user_id)

    top_categories = profile.top_categories if profile and profile.top_categories else []
    category_count = len(top_categories) if isinstance(top_categories, list) else 0

    # 经验：观看 + 专注(×2) + 笔记(×5) + 完成(×20)
    exp = int(
        total_minutes
        + focus_minutes * 2
        + notes_count * 5
        + videos_completed * 20
    )

    current_level = LEVELS[0]
    next_level = None
    for idx, level in enumerate(LEVELS):
        if exp >= level[0]:
            current_level = level
            next_level = LEVELS[idx + 1] if idx + 1 < len(LEVELS) else None

    if next_level:
        span = next_level[0] - current_level[0]
        done = exp - current_level[0]
        level_progress = round(min(done / span, 1.0), 3) if span else 1.0
        to_next = max(next_level[0] - exp, 0)
    else:
        level_progress = 1.0
        to_next = 0

    milestones = _milestones(
        total_minutes=total_minutes,
        streak_days=streak_days,
        videos_completed=videos_completed,
        notes_count=notes_count,
        focus_count=focus_count,
        category_count=category_count,
    )

    heat = _heatmap(db, user_id)
    # 最近 14 天明细，给「本周」卡片用
    recent = heat[-14:]
    week_minutes = sum(d["minutes"] for d in recent[-7:])
    prev_week_minutes = sum(d["minutes"] for d in recent[:7])

    return {
        "level": {
            "index": LEVELS.index(current_level) + 1,
            "title": current_level[1],
            "desc": current_level[2],
            "exp": exp,
            "next_title": next_level[1] if next_level else None,
            "next_exp": next_level[0] if next_level else None,
            "to_next": to_next,
            "progress": level_progress,
        },
        "sources": {
            "watch_minutes": round(total_minutes, 1),
            "focus_minutes": round(focus_minutes, 1),
            "notes": notes_count,
            "videos_started": videos_started,
            "videos_completed": videos_completed,
            "streak_days": streak_days,
            "active_days_30d": active_days,
            "pomodoro_done": focus_count,
            "pomodoro_total": focus_total,
            "categories": category_count,
        },
        "this_week": {
            "minutes": week_minutes,
            "prev_week_minutes": prev_week_minutes,
            "delta": week_minutes - prev_week_minutes,
        },
        "milestones": milestones,
        "heatmap": heat,
        "unlocked": sum(1 for m in milestones if m["unlocked"]),
        "total_milestones": len(milestones),
    }
