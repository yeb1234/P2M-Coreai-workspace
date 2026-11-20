"""P2 Lite 站内学习活动快照。

Lite 没有视频库、观看记录和学习路径，所以学习评价不能从完整版的
watch_events / learning_paths 推算。这里只汇总 Lite 自己真正留下的记录：

- Todo（schedule_items）：创建、完成、逾期、专注分钟
- 日历（calendar_events）：安排数量、今天/未来 7 天、类型
- 私人笔记（notes, scope=private）：新建、更新、字数、最近标题
- 面试练习（interview_attempts / interview_card_states）：作答、得分、掌握
- 使用痕迹：登录、聊天、Agent 运行、动作审计、user_data 更新

输出先给结构化数字，再压成一段给 LLM 读的短文本。LLM 负责评价，
这里不替它下结论，避免把「数据少」说成「学得差」。
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.models import (
    AgentAction,
    AgentRun,
    CalendarEvent,
    ChatMessage,
    ChatSession,
    InterviewAttempt,
    InterviewCardState,
    Note,
    ScheduleItem,
    User,
    UserData,
)

MAX_DAYS = 90
DEFAULT_DAYS = 7


def _clamp_days(days: int | None) -> int:
    if days is None:
        return DEFAULT_DAYS
    try:
        value = int(days)
    except (TypeError, ValueError):
        value = DEFAULT_DAYS
    return max(1, min(MAX_DAYS, value))


def _as_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _as_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, time.min)
    return None


def _parse_clock(value: str | None) -> int | None:
    """把 09:30 / 9:30 解析成分钟；解析不了返回 None。"""
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    parts = text.split(":")
    if len(parts) < 2:
        return None
    try:
        hour = int(parts[0])
        minute = int(parts[1][:2])
    except (TypeError, ValueError):
        return None
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return hour * 60 + minute


def _event_minutes(event: CalendarEvent) -> int:
    start = _parse_clock(event.start_time)
    end = _parse_clock(event.end_time)
    if start is None or end is None or end <= start:
        return 0
    return end - start


def build_lite_activity(db: Session, user_id: int, days: int = DEFAULT_DAYS) -> dict[str, Any]:
    """按用户汇总最近 N 天的 Lite 活动，返回可 JSON 化的字典。"""
    window = _clamp_days(days)
    now = datetime.now()
    today = now.date()
    start_day = today - timedelta(days=window - 1)
    start_at = datetime.combine(start_day, time.min)
    end_at = now

    daily: dict[date, Counter[str]] = defaultdict(Counter)
    last_active_at: datetime | None = None

    def mark(ts: Any, source: str, count: int = 1) -> None:
        nonlocal last_active_at
        moment = _as_datetime(ts)
        if moment is None or moment < start_at or moment > end_at:
            return
        daily[moment.date()][source] += count
        if last_active_at is None or moment > last_active_at:
            last_active_at = moment

    # ---- Todo ----
    todos = (
        db.query(ScheduleItem)
        .filter(ScheduleItem.user_id == user_id, ScheduleItem.deleted_at.is_(None))
        .all()
    )
    todo_created = 0
    todo_completed = 0
    todo_overdue = 0
    todo_open = 0
    todo_focus_minutes = 0
    todo_pomodoro_rounds = 0
    todo_recent_completed: list[str] = []
    todo_due_today: list[str] = []
    for item in todos:
        created = _as_datetime(item.created_at)
        updated = _as_datetime(item.updated_at)
        completed = _as_datetime(item.completed_at)
        active_in_window = any(
            moment is not None and start_at <= moment <= end_at
            for moment in (created, updated, completed)
        )
        if created and start_at <= created <= end_at:
            todo_created += 1
            mark(created, "todo")
        if completed and start_at <= completed <= end_at:
            todo_completed += 1
            mark(completed, "todo")
            if len(todo_recent_completed) < 5:
                todo_recent_completed.append(item.title)
        if (item.status or "") != "completed":
            todo_open += 1
            due = _as_datetime(item.due_at)
            if due and due < now:
                todo_overdue += 1
            if due and due.date() == today and len(todo_due_today) < 5:
                todo_due_today.append(item.title)
        if active_in_window:
            todo_focus_minutes += int(item.total_focus_minutes or 0)
            todo_pomodoro_rounds += int(item.pomodoro_rounds or 0)

    # ---- 日历 ----
    events = (
        db.query(CalendarEvent)
        .filter(CalendarEvent.user_id == user_id)
        .all()
    )
    event_in_window = 0
    event_today = 0
    event_upcoming = 0
    event_minutes = 0
    event_types: Counter[str] = Counter()
    for event in events:
        event_day = _as_date(event.date)
        if event_day is None:
            mark(event.created_at, "calendar")
            continue
        if start_day <= event_day <= today:
            event_in_window += 1
            event_minutes += _event_minutes(event)
            event_types[event.type or "event"] += 1
            mark(datetime.combine(event_day, time.min), "calendar")
        if event_day == today:
            event_today += 1
        elif today < event_day <= today + timedelta(days=7):
            event_upcoming += 1
        mark(event.created_at, "calendar")

    # ---- 私人笔记 ----
    notes = (
        db.query(Note)
        .filter(Note.user_id == user_id, Note.scope == "private")
        .all()
    )
    note_created = 0
    note_updated = 0
    note_chars = 0
    note_recent: list[dict[str, str]] = []
    for note in notes:
        note_chars += len(note.content or "")
        created = _as_datetime(note.created_at)
        updated = _as_datetime(note.updated_at) or created
        if created and start_at <= created <= end_at:
            note_created += 1
            mark(created, "notes")
        if updated and start_at <= updated <= end_at:
            note_updated += 1
            mark(updated, "notes")
            if len(note_recent) < 5:
                note_recent.append({
                    "title": note.title or "未命名笔记",
                    "updated_at": updated.strftime("%m-%d %H:%M"),
                })

    # ---- 面试练习 ----
    attempts = (
        db.query(InterviewAttempt)
        .filter(InterviewAttempt.user_id == user_id, InterviewAttempt.created_at >= start_at)
        .all()
    )
    attempt_count = 0
    attempt_scores: list[int] = []
    attempt_questions: set[str] = set()
    attempt_groups: Counter[str] = Counter()
    attempt_pass = 0
    for attempt in attempts:
        mark(attempt.created_at, "interview")
        attempt_count += 1
        attempt_questions.add(attempt.question_id)
        if attempt.group_key:
            attempt_groups[attempt.group_key] += 1
        if attempt.score is not None:
            attempt_scores.append(int(attempt.score))
        if (attempt.verdict or "") == "pass":
            attempt_pass += 1

    card_states = (
        db.query(InterviewCardState)
        .filter(InterviewCardState.user_id == user_id)
        .all()
    )
    mastered = sum(1 for state in card_states if state.mastered)
    starred = sum(1 for state in card_states if state.starred)
    practice_count = sum(int(state.practice_count or 0) for state in card_states)
    practiced_times = [
        value
        for state in card_states
        if (value := _as_datetime(state.last_practiced_at)) is not None
    ]
    last_practiced = max(practiced_times, default=None)
    if last_practiced:
        mark(last_practiced, "interview")

    # ---- 使用痕迹 ----
    user = db.get(User, user_id)
    if user and user.last_login_at:
        mark(user.last_login_at, "login")

    runs = (
        db.query(AgentRun)
        .filter(
            AgentRun.user_id == user_id,
            AgentRun.kind == "chat",
            AgentRun.created_at >= start_at,
        )
        .all()
    )
    for run in runs:
        mark(run.created_at, "chat")

    sessions = (
        db.query(ChatSession)
        .filter(ChatSession.user_id == user_id)
        .filter((ChatSession.created_at >= start_at) | (ChatSession.updated_at >= start_at))
        .all()
    )
    for session in sessions:
        mark(session.created_at, "chat")
        mark(session.updated_at, "chat")

    messages = (
        db.query(ChatMessage)
        .join(ChatSession, ChatSession.id == ChatMessage.session_id)
        .filter(
            ChatSession.user_id == user_id,
            ChatMessage.created_at >= start_at,
            ChatMessage.role == "user",
        )
        .all()
    )
    for message in messages:
        mark(message.created_at, "chat")

    actions = (
        db.query(AgentAction)
        .filter(AgentAction.user_id == user_id, AgentAction.created_at >= start_at)
        .all()
    )
    for action in actions:
        mark(action.created_at, action.action_type or "action")

    user_data = (
        db.query(UserData)
        .filter(UserData.user_id == user_id, UserData.updated_at >= start_at)
        .all()
    )
    for row in user_data:
        mark(row.updated_at, "settings")

    # ---- 连续天数 ----
    active_days = sorted(daily.keys())
    active_set = set(active_days)
    longest_streak = 0
    run_streak = 0
    cursor = start_day
    while cursor <= today:
        if cursor in active_set:
            run_streak += 1
            longest_streak = max(longest_streak, run_streak)
        else:
            run_streak = 0
        cursor += timedelta(days=1)

    current_streak = 0
    cursor = today
    if cursor not in active_set:
        cursor -= timedelta(days=1)
    while cursor >= start_day and cursor in active_set:
        current_streak += 1
        cursor -= timedelta(days=1)

    by_source: Counter[str] = Counter()
    for counts in daily.values():
        for source, count in counts.items():
            by_source[source] += count

    daily_rows = []
    for day in sorted(daily.keys()):
        counts = daily[day]
        daily_rows.append({
            "date": day.strftime("%m-%d"),
            "sources": sorted(counts.keys()),
            "events": sum(counts.values()),
        })

    avg_score = round(sum(attempt_scores) / len(attempt_scores), 1) if attempt_scores else None
    completion_rate = round(todo_completed / todo_created * 100, 1) if todo_created else None
    pass_rate = round(attempt_pass / attempt_count * 100, 1) if attempt_count else None

    return {
        "period_days": window,
        "range": {
            "start": start_day.isoformat(),
            "end": today.isoformat(),
        },
        "usage": {
            "active_days": len(active_days),
            "current_streak": current_streak,
            "longest_streak": longest_streak,
            "active_today": today in active_set,
            "by_source": dict(by_source),
            "daily": daily_rows,
            "last_active_at": last_active_at.strftime("%Y-%m-%d %H:%M") if last_active_at else None,
        },
        "todos": {
            "created": todo_created,
            "completed": todo_completed,
            "completion_rate": completion_rate,
            "open": todo_open,
            "overdue": todo_overdue,
            "focus_minutes": todo_focus_minutes,
            "pomodoro_rounds": todo_pomodoro_rounds,
            "recent_completed": todo_recent_completed,
            "due_today": todo_due_today,
        },
        "calendar": {
            "events": event_in_window,
            "today": event_today,
            "upcoming_7d": event_upcoming,
            "busy_minutes": event_minutes,
            "by_type": dict(event_types),
        },
        "notes": {
            "created": note_created,
            "updated": note_updated,
            "total_private": len(notes),
            "chars": note_chars,
            "recent": note_recent,
        },
        "interview": {
            "attempts": attempt_count,
            "questions": len(attempt_questions),
            "avg_score": avg_score,
            "pass_rate": pass_rate,
            "groups": dict(attempt_groups),
            "mastered": mastered,
            "starred": starred,
            "practice_count": practice_count,
        },
        "chat": {
            "sessions": len(sessions),
            "runs": len(runs),
            "messages": len(messages),
        },
    }


def _source_label(source: str) -> str:
    return {
        "todo": "Todo",
        "calendar": "日历",
        "notes": "笔记",
        "interview": "面试练习",
        "login": "登录",
        "chat": "聊天",
        "note": "笔记动作",
        "calendar_action": "日历动作",
        "todo_action": "Todo 动作",
        "settings": "设置",
    }.get(source, source)


def format_lite_activity(stats: dict[str, Any]) -> str:
    """把快照压成 LLM 能直接读的短文本，不替模型下评价。"""
    usage = stats["usage"]
    todos = stats["todos"]
    calendar = stats["calendar"]
    notes = stats["notes"]
    interview = stats["interview"]
    chat = stats["chat"]
    days = stats["period_days"]
    start, end = stats["range"]["start"], stats["range"]["end"]

    lines = [f"【Lite 学习状态｜最近 {days} 天（{start} ~ {end}）】"]
    lines.append(
        f"活跃：{usage['active_days']}/{days} 天；当前连续 {usage['current_streak']} 天"
        f"（今天{'有' if usage['active_today'] else '没有'}记录），最长连续 {usage['longest_streak']} 天。"
    )
    if usage["daily"]:
        daily_text = "；".join(
            f"{row['date']} {'/'.join(_source_label(s) for s in row['sources'])}"
            for row in usage["daily"][-7:]
        )
        lines.append(f"- 每日痕迹：{daily_text}")
    else:
        lines.append("- 每日痕迹：这段时间没有记录到任何站内活动。")

    completion = (
        f"{todos['completed']}/{todos['created']}（{todos['completion_rate']}%）"
        if todos["created"]
        else "0（没有新建）"
    )
    lines.append(
        f"- Todo：新建 {todos['created']}，完成 {completion}；"
        f"当前未完成 {todos['open']}，其中逾期 {todos['overdue']}；"
        f"专注 {todos['focus_minutes']} 分钟 / {todos['pomodoro_rounds']} 个番茄。"
    )
    if todos["due_today"]:
        lines.append(f"  今天到期：{'、'.join(todos['due_today'])}")
    if todos["recent_completed"]:
        lines.append(f"  最近完成：{'、'.join(todos['recent_completed'])}")

    type_text = "、".join(f"{key} {value}" for key, value in calendar["by_type"].items()) or "无"
    lines.append(
        f"- 日历：{calendar['events']} 个安排（今天 {calendar['today']}，未来 7 天 {calendar['upcoming_7d']}）；"
        f"类型：{type_text}；累计约 {calendar['busy_minutes']} 分钟。"
    )

    lines.append(
        f"- 笔记：新建 {notes['created']}，更新 {notes['updated']}；"
        f"私人笔记共 {notes['total_private']} 篇，约 {notes['chars']} 字。"
    )
    if notes["recent"]:
        lines.append(
            "  最近笔记：" + "、".join(f"《{item['title']}》（{item['updated_at']}）" for item in notes["recent"])
        )

    score = f"{interview['avg_score']} 分" if interview["avg_score"] is not None else "无评分"
    pass_rate = f"{interview['pass_rate']}%" if interview["pass_rate"] is not None else "无判定"
    groups = "、".join(f"{key} {value} 题" for key, value in interview["groups"].items()) or "无"
    lines.append(
        f"- 面试：作答 {interview['attempts']} 题，覆盖 {interview['questions']} 道题；"
        f"平均 {score}，通过率 {pass_rate}；分组：{groups}。"
        f"已掌握 {interview['mastered']} 题，收藏 {interview['starred']} 题。"
    )
    lines.append(
        f"- 使用：{chat['runs']} 轮对话 / {chat['sessions']} 个会话 / {chat['messages']} 条提问；"
        f"最近活跃 {usage['last_active_at'] or '无记录'}。"
    )
    lines.append(
        "说明：以上只统计 Lite 自己的 todo、日历、私人笔记、面试练习和站内使用痕迹；"
        "Lite 没有视频库、观看记录和学习路径，不能据此推断视频学习量。"
    )
    return "\n".join(lines)
