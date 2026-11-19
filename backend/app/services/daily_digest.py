"""今日学习日报（AI 笔记）生成。

数据全部来自服务端真实行为，不让模型“回忆”：
- watch_events    当天净观看秒数、看过的视频与时长
- watch_history   当天看完的视频
- schedule_items  当天完成 / 未完成的待办与日程
- learning_paths  当前路径进度与接下来 3 步
- chat_messages   当天问过的问题（作为“卡点”线索）
- 前端传入的本地便签标题（便签存在浏览器，服务端看不到）

生成策略：先把事实压成一段紧凑文本，再让 LLM 写成 Markdown；
LLM 不可用就退回确定性模板 —— 按钮永远有结果，不会转圈到超时。
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, time, timedelta

from sqlalchemy import and_, func, or_

from app.database import SessionLocal
from app.models import (
    ChatMessage,
    ChatSession,
    LearningGoal,
    LearningPath,
    LearningPathStep,
    ScheduleItem,
    Video,
    WatchEvent,
    WatchHistory,
)
from app.services.llm import build_chat_model

logger = logging.getLogger(__name__)

NOTE_TITLE_PREFIX = "今日 AI 便签 - "

_LLM_SYSTEM = (
    "你是个人学习站的学习助理。根据给定的今日真实数据写一份中文学习日报，Markdown 格式。"
    "只写有数据支撑的内容，不编造视频标题、数字或没有发生的计划。"
    "结构固定为三个二级标题：## 今天做了什么、## 今天的卡点、## 明天怎么走。"
    "明天部分最多 3 条，每条给出可执行动作与预估分钟数，总时长不超过每日可投入分钟数。"
    "不要寒暄，不要讲学习方法论，全文 400 字以内。"
)


def _day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min)
    return start, start + timedelta(days=1)


def _minutes(seconds: float | None) -> int:
    return int(round((seconds or 0) / 60))


def _clean_markdown(text: str) -> str:
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n", "", text)
        text = re.sub(r"\n```$", "", text)
    return text.strip()


def _content_to_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                parts.append(str(item.get("text") or ""))
            else:
                parts.append(str(item))
        return "".join(parts)
    return str(content or "")


def _titles_for(db, video_ids: list[int]) -> dict[int, str]:
    if not video_ids:
        return {}
    rows = db.query(Video.id, Video.title).filter(Video.id.in_(video_ids)).all()
    return {row.id: row.title for row in rows}


def _collect(user_id: int, local_notes: list[str] | None, day: date) -> dict:
    start, end = _day_bounds(day)
    db = SessionLocal()
    try:
        watch_rows = (
            db.query(WatchEvent.video_id, func.sum(WatchEvent.delta_sec).label("sec"))
            .filter(
                WatchEvent.user_id == user_id,
                WatchEvent.occurred_at >= start,
                WatchEvent.occurred_at < end,
            )
            .group_by(WatchEvent.video_id)
            .order_by(func.sum(WatchEvent.delta_sec).desc())
            .limit(6)
            .all()
        )
        titles = _titles_for(db, [row.video_id for row in watch_rows])
        watched = [
            {
                "video_id": row.video_id,
                "title": titles.get(row.video_id, f"视频 {row.video_id}"),
                "minutes": _minutes(row.sec),
            }
            for row in watch_rows
            if (row.sec or 0) >= 30
        ]
        total_watch_min = _minutes(sum((row.sec or 0) for row in watch_rows))

        completed_rows = (
            db.query(WatchHistory)
            .filter(
                WatchHistory.user_id == user_id,
                WatchHistory.completed.is_(True),
                WatchHistory.watched_at >= start,
                WatchHistory.watched_at < end,
            )
            .all()
        )
        completed_titles = _titles_for(db, [row.video_id for row in completed_rows])

        items = (
            db.query(ScheduleItem)
            .filter(
                ScheduleItem.user_id == user_id,
                ScheduleItem.deleted_at.is_(None),
                or_(
                    and_(ScheduleItem.start_at >= start, ScheduleItem.start_at < end),
                    and_(ScheduleItem.due_at >= start, ScheduleItem.due_at < end),
                    and_(ScheduleItem.completed_at >= start, ScheduleItem.completed_at < end),
                ),
            )
            .all()
        )
        done_items = [item.title for item in items if item.completed_at and start <= item.completed_at < end]
        pending_items = [
            item.title
            for item in items
            if item.title not in done_items and item.status not in ("done", "canceled")
        ]

        path = (
            db.query(LearningPath)
            .filter(LearningPath.user_id == user_id, LearningPath.status == "active")
            .order_by(LearningPath.updated_at.desc())
            .first()
        )
        path_info = None
        if path:
            steps = (
                db.query(LearningPathStep)
                .filter(LearningPathStep.path_id == path.id)
                .order_by(LearningPathStep.order_index.asc())
                .all()
            )
            done_steps = sum(1 for step in steps if step.status == "done")
            next_steps = [
                {"title": step.title, "minutes": int(step.est_minutes or 0)}
                for step in steps
                if step.status in ("pending", "in_progress")
            ][:3]
            path_info = {
                "title": path.title,
                "done": done_steps,
                "total": len(steps),
                "next": next_steps,
            }

        chat_rows = (
            db.query(ChatMessage.content)
            .join(ChatSession, ChatMessage.session_id == ChatSession.id)
            .filter(
                ChatSession.user_id == user_id,
                ChatMessage.role == "user",
                ChatMessage.created_at >= start,
                ChatMessage.created_at < end,
            )
            .order_by(ChatMessage.created_at.desc())
            .limit(8)
            .all()
        )
        questions = [str(row[0] or "").strip().replace("\n", " ")[:40] for row in chat_rows if row[0]]

        goal = (
            db.query(LearningGoal)
            .filter(LearningGoal.user_id == user_id)
            .order_by(LearningGoal.created_at.desc())
            .first()
        )
        weekly_hours = float(goal.weekly_hours) if goal and goal.weekly_hours else 0.0
        daily_budget_min = max(30, int(round(weekly_hours / 7 * 60))) if weekly_hours else 60

        local_note_titles = [str(title).strip()[:60] for title in (local_notes or []) if str(title).strip()][:10]

        return {
            "day": day,
            "total_watch_min": total_watch_min,
            "watched": watched,
            "completed_titles": [completed_titles.get(row.video_id, f"视频 {row.video_id}") for row in completed_rows][:6],
            "done_items": done_items[:6],
            "pending_items": pending_items[:6],
            "path": path_info,
            "questions": questions[:5],
            "local_notes": local_note_titles,
            "weekly_hours": weekly_hours,
            "daily_budget_min": daily_budget_min,
        }
    finally:
        db.close()


def _facts_text(data: dict) -> str:
    lines = [f"日期：{data['day'].isoformat()}", f"净观看：{data['total_watch_min']} 分钟"]
    if data["watched"]:
        lines.append("看过的视频（按停留时长排序，最多 6 条）：")
        lines.extend(f"- 《{item['title']}》 {item['minutes']} 分钟" for item in data["watched"])
    else:
        lines.append("看过的视频：无")
    lines.append("当天看完的视频：" + ("、".join(f"《{t}》" for t in data["completed_titles"]) or "无"))
    lines.append("当天完成的待办：" + ("、".join(data["done_items"]) or "无"))
    lines.append("当天未完成的待办：" + ("、".join(data["pending_items"]) or "无"))
    if data["path"]:
        lines.append(
            f"当前学习路径：《{data['path']['title']}》，已完成 {data['path']['done']}/{data['path']['total']} 步"
        )
        if data["path"]["next"]:
            lines.append(
                "接下来待学："
                + "；".join(f"{step['title']}（约 {step['minutes']} 分钟）" for step in data["path"]["next"])
            )
    lines.append("今天问过的问题：" + ("；".join(data["questions"]) or "无"))
    lines.append("今天更新过的本地笔记：" + ("；".join(data["local_notes"]) or "无"))
    lines.append(f"每日可投入：约 {data['daily_budget_min']} 分钟（按每周 {data['weekly_hours'] or '未设置'} 小时折算）")
    return "\n".join(lines)


def _fallback_markdown(data: dict) -> str:
    lines = [f"# {NOTE_TITLE_PREFIX}{data['day'].isoformat()}", ""]
    lines.append("## 今天做了什么")
    did_anything = False
    if data["watched"]:
        did_anything = True
        top = "、".join(f"《{item['title']}》{item['minutes']} 分钟" for item in data["watched"][:3])
        lines.append(f"- 视频学习 {data['total_watch_min']} 分钟：{top}")
    if data["completed_titles"]:
        did_anything = True
        lines.append("- 看完：" + "、".join(f"《{t}》" for t in data["completed_titles"][:3]))
    if data["done_items"]:
        did_anything = True
        lines.append("- 完成待办：" + "、".join(data["done_items"][:4]))
    if not did_anything:
        lines.append("- 今天没有留下学习记录（看视频、完成待办都会自动统计）")

    lines.append("")
    lines.append("## 今天的卡点")
    blockers = []
    if data["pending_items"]:
        blockers.append("还没收掉的待办：" + "、".join(data["pending_items"][:4]))
    if data["questions"]:
        blockers.append("今天问过：" + "；".join(data["questions"][:2]))
    if data["path"] and data["path"]["done"] == 0 and data["path"]["total"]:
        blockers.append("路径还没启动第一步")
    if blockers:
        lines.extend(f"- {item}" for item in blockers)
    else:
        lines.append("- 没有明显卡点，保持节奏就行")

    lines.append("")
    lines.append("## 明天怎么走")
    plan = []
    budget = data["daily_budget_min"]
    if data["path"] and data["path"]["next"]:
        step = data["path"]["next"][0]
        plan.append(f"推进路径下一步「{step['title']}」（约 {min(step['minutes'] or 30, budget)} 分钟）")
    if data["pending_items"]:
        plan.append(f"收掉待办「{data['pending_items'][0]}」（约 20 分钟）")
    if data["watched"]:
        plan.append(f"继续看《{data['watched'][0]['title']}》没看完的部分（约 20 分钟）")
    if not plan:
        plan.append(f"从路径里挑一个小步骤开个头（约 {min(budget, 30)} 分钟）")
    lines.extend(f"{index + 1}. {text}" for index, text in enumerate(plan[:3]))
    return "\n".join(lines)


def generate_daily_note(user_id: int, local_notes: list[str] | None = None, day: date | None = None) -> dict:
    day = day or date.today()
    data = _collect(user_id, local_notes, day)
    facts = _facts_text(data)
    markdown = ""
    generated_by = "fallback"

    for provider in ("external", "local"):
        try:
            model = build_chat_model(provider, temperature=0.3, max_tokens=700, timeout_s=30)
            message = model.invoke(_LLM_SYSTEM + "\n\n【今日数据】\n" + facts)
            text = _clean_markdown(_content_to_text(getattr(message, "content", "")))
            if len(text) >= 80:
                markdown = text
                generated_by = provider
                break
        except Exception as exc:  # noqa: BLE001 - 上游任何失败都退回模板，不能让按钮卡死
            logger.warning("日报生成失败 provider=%s: %s", provider, exc)

    if not markdown:
        markdown = _fallback_markdown(data)

    stats = {
        "watch_minutes": data["total_watch_min"],
        "videos": len(data["watched"]),
        "completed_videos": len(data["completed_titles"]),
        "done_items": len(data["done_items"]),
        "pending_items": len(data["pending_items"]),
        "path_done": data["path"]["done"] if data["path"] else 0,
        "path_total": data["path"]["total"] if data["path"] else 0,
        "daily_budget_min": data["daily_budget_min"],
    }
    return {
        "title": f"{NOTE_TITLE_PREFIX}{day.isoformat()}",
        "content": markdown,
        "generated_by": generated_by,
        "stats": stats,
        "facts": facts,
    }
