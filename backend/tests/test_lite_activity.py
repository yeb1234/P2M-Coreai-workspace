"""P2 Lite 学习状态快照的纯格式化测试。

不连库：验证空数据不会崩、文本包含关键事实、天数会被收敛到 1-90。
真实库的聚合在 Lite 容器里用 smoke/手工接口验证。
"""

from __future__ import annotations

from app.services.lite_activity import _clamp_days, format_lite_activity


def _empty_stats() -> dict:
    return {
        "period_days": 7,
        "range": {"start": "2026-11-14", "end": "2026-11-20"},
        "usage": {
            "active_days": 0,
            "current_streak": 0,
            "longest_streak": 0,
            "active_today": False,
            "by_source": {},
            "daily": [],
            "last_active_at": None,
        },
        "todos": {
            "created": 0,
            "completed": 0,
            "completion_rate": None,
            "open": 0,
            "overdue": 0,
            "focus_minutes": 0,
            "pomodoro_rounds": 0,
            "recent_completed": [],
            "due_today": [],
        },
        "calendar": {
            "events": 0,
            "today": 0,
            "upcoming_7d": 0,
            "busy_minutes": 0,
            "by_type": {},
        },
        "notes": {"created": 0, "updated": 0, "total_private": 0, "chars": 0, "recent": []},
        "interview": {
            "attempts": 0,
            "questions": 0,
            "avg_score": None,
            "pass_rate": None,
            "groups": {},
            "mastered": 0,
            "starred": 0,
            "practice_count": 0,
        },
        "chat": {"sessions": 0, "runs": 0, "messages": 0},
    }


def test_clamp_days():
    assert _clamp_days(0) == 1
    assert _clamp_days(None) == 7
    assert _clamp_days(999) == 90
    assert _clamp_days("14") == 14


def test_empty_snapshot_does_not_claim_progress():
    text = format_lite_activity(_empty_stats())
    assert "活跃：0/7 天" in text
    assert "这段时间没有记录到任何站内活动" in text
    assert "不能据此推断视频学习量" in text


def test_snapshot_surfaces_activity_facts():
    stats = _empty_stats()
    stats["usage"].update({
        "active_days": 4,
        "current_streak": 2,
        "longest_streak": 3,
        "active_today": True,
        "daily": [
            {"date": "11-18", "sources": ["todo", "notes"], "events": 3},
            {"date": "11-20", "sources": ["chat", "interview"], "events": 2},
        ],
        "last_active_at": "2026-11-20 12:30",
    })
    stats["todos"].update({
        "created": 3,
        "completed": 2,
        "completion_rate": 66.7,
        "open": 1,
        "overdue": 1,
        "focus_minutes": 50,
        "pomodoro_rounds": 2,
        "recent_completed": ["复盘 RAG"],
        "due_today": ["写周报"],
    })
    stats["calendar"].update({
        "events": 2,
        "today": 1,
        "upcoming_7d": 1,
        "busy_minutes": 90,
        "by_type": {"study": 2},
    })
    stats["notes"].update({
        "created": 1,
        "updated": 1,
        "total_private": 2,
        "chars": 600,
        "recent": [{"title": "FastAPI 依赖注入", "updated_at": "11-20 10:00"}],
    })
    stats["interview"].update({
        "attempts": 2,
        "questions": 2,
        "avg_score": 72.5,
        "pass_rate": 50.0,
        "groups": {"backend": 2},
        "mastered": 1,
        "starred": 1,
        "practice_count": 4,
    })
    stats["chat"].update({"sessions": 2, "runs": 5, "messages": 4})

    text = format_lite_activity(stats)
    assert "活跃：4/7 天" in text
    assert "当前连续 2 天" in text
    assert "完成 2/3（66.7%）" in text
    assert "专注 50 分钟 / 2 个番茄" in text
    assert "FastAPI 依赖注入" in text
    assert "平均 72.5 分" in text
    assert "通过率 50.0%" in text
