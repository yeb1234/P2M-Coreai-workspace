"""助手个人动作审计与撤回。

设计边界
--------
- 只审计会改用户数据的动作：笔记、日历、Todo；
- 每轮最多一个写动作由 ToolBudget 负责，这里再做一层「同一 run 不重复落动作」；
- 撤回是「反向操作目标对象」，不是回滚整个对话，避免误删同轮其他数据。
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import AgentAction, CalendarEvent, Note, ScheduleItem
from app.services.user_data_cleanup import delete_private_note_files

logger = logging.getLogger(__name__)

ACTION_TYPES = ("note", "calendar", "todo")
ACTION_LABELS = {"note": "笔记", "calendar": "日历", "todo": "Todo"}


def _clip(value: Any, limit: int = 500) -> str:
    text = str(value or "").strip()
    return text[:limit]


def _json_safe(value: Any) -> Any:
    """只保留短、可序列化的字段，避免把完整长正文塞进审计表。"""
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def record_action(
    db: Session,
    *,
    user_id: int,
    action_type: str,
    title: str,
    target_id: str | int | None,
    result: str = "",
    payload: dict[str, Any] | None = None,
    summary: str = "",
    run_id: str | None = None,
    session_id: str | None = None,
    status: str = "applied",
) -> AgentAction:
    """写入一条动作审计；调用方负责 commit。"""
    if action_type not in ACTION_TYPES:
        raise ValueError(f"未知动作类型：{action_type}")
    action = AgentAction(
        id=uuid4().hex,
        run_id=(run_id or "").strip() or None,
        session_id=(session_id or "").strip() or None,
        user_id=int(user_id),
        action_type=action_type,
        status=status,
        title=_clip(title, 240) or ACTION_LABELS.get(action_type, action_type),
        summary=_clip(summary, 800) or None,
        payload=_json_safe(payload or {}),
        target_id=str(target_id) if target_id is not None else None,
        result=_clip(result, 3000) or None,
    )
    db.add(action)
    db.flush()
    return action


def find_run_action(
    db: Session,
    *,
    user_id: int,
    run_id: str | None,
    action_type: str,
) -> AgentAction | None:
    """同一轮重复调用同一类动作时，返回已有记录，避免重复落库。"""
    if not run_id:
        return None
    return (
        db.query(AgentAction)
        .filter(
            AgentAction.user_id == user_id,
            AgentAction.run_id == run_id,
            AgentAction.action_type == action_type,
            AgentAction.status.in_(("applied", "failed")),
        )
        .order_by(AgentAction.created_at.desc())
        .first()
    )


def action_to_dict(action: AgentAction) -> dict[str, Any]:
    return {
        "id": action.id,
        "run_id": action.run_id,
        "session_id": action.session_id,
        "action_type": action.action_type,
        "status": action.status,
        "title": action.title,
        "summary": action.summary,
        "target_id": action.target_id,
        "created_at": action.created_at.isoformat(timespec="seconds") if action.created_at else None,
        "undone_at": action.undone_at.isoformat(timespec="seconds") if action.undone_at else None,
        "can_undo": action.status == "applied",
    }


def list_actions(
    db: Session,
    *,
    user_id: int,
    limit: int = 30,
    session_id: str | None = None,
) -> list[dict[str, Any]]:
    query = db.query(AgentAction).filter(AgentAction.user_id == user_id)
    if session_id:
        query = query.filter(AgentAction.session_id == session_id)
    rows = (
        query.order_by(AgentAction.created_at.desc())
        .limit(max(1, min(int(limit or 30), 100)))
        .all()
    )
    return [action_to_dict(row) for row in rows]


def actions_for_run(db: Session, *, user_id: int, run_id: str) -> list[dict[str, Any]]:
    if not run_id:
        return []
    rows = (
        db.query(AgentAction)
        .filter(AgentAction.user_id == user_id, AgentAction.run_id == run_id)
        .order_by(AgentAction.created_at.asc())
        .all()
    )
    return [action_to_dict(row) for row in rows]


def undo_action(db: Session, *, user_id: int, action_id: str) -> dict[str, Any]:
    action = (
        db.query(AgentAction)
        .filter(AgentAction.id == action_id, AgentAction.user_id == user_id)
        .first()
    )
    if not action:
        return {"ok": False, "error": "not_found", "message": "找不到这条执行记录"}
    if action.status == "undone":
        return {"ok": True, "already": True, "action": action_to_dict(action)}
    if action.status != "applied":
        return {"ok": False, "error": "not_applied", "message": "这条动作当前不可撤回"}

    note_id: int | None = None
    try:
        if action.action_type == "note":
            try:
                note_id = int(action.target_id or 0)
            except (TypeError, ValueError):
                note_id = None
            note = (
                db.query(Note)
                .filter(Note.id == note_id, Note.user_id == user_id, Note.scope == "private")
                .first()
                if note_id
                else None
            )
            if note is not None:
                db.delete(note)
                db.flush()
        elif action.action_type == "calendar":
            event = (
                db.query(CalendarEvent)
                .filter(CalendarEvent.id == str(action.target_id or ""), CalendarEvent.user_id == user_id)
                .first()
            )
            if event is not None:
                db.delete(event)
                db.flush()
        elif action.action_type == "todo":
            item = (
                db.query(ScheduleItem)
                .filter(ScheduleItem.id == str(action.target_id or ""), ScheduleItem.user_id == user_id)
                .first()
            )
            if item is not None:
                item.deleted_at = datetime.now().replace(second=0, microsecond=0)
                item.updated_at = datetime.now()
                db.flush()

        action.status = "undone"
        action.undone_at = datetime.now()
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("撤回动作失败 action_id=%s", action_id)
        raise

    # 笔记的文件清理放在 DB 提交之后：事务失败就不动文件，避免内容先丢。
    if note_id:
        try:
            delete_private_note_files(note_id, user_id)
        except Exception:
            logger.warning("撤回笔记后清理文件失败 note_id=%s", note_id, exc_info=True)

    refreshed = db.query(AgentAction).filter(AgentAction.id == action_id).first()
    return {"ok": True, "action": action_to_dict(refreshed) if refreshed else action_to_dict(action)}


def list_actions_for_user(user_id: int, *, limit: int = 30, session_id: str | None = None) -> list[dict[str, Any]]:
    with SessionLocal() as db:
        return list_actions(db, user_id=user_id, limit=limit, session_id=session_id)
