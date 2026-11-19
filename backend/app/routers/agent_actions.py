"""个人动作执行记录与撤回。

只暴露当前用户自己的记录；撤回接口按 action_id + user_id 双条件取数，
不能通过猜 id 撤销别人的笔记或日程。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import User
from app.services.agent_actions import list_actions, undo_action

router = APIRouter(prefix="/api/agent-actions", tags=["agent-actions"])


@router.get("")
def get_actions(
    limit: int = Query(default=30, ge=1, le=100),
    session_id: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    items = list_actions(db, user_id=user.id, limit=limit, session_id=session_id)
    return {"items": items, "count": len(items)}


@router.post("/{action_id}/undo")
def undo(
    action_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    result = undo_action(db, user_id=user.id, action_id=action_id)
    if not result.get("ok"):
        code = result.get("error") or "failed"
        status = 404 if code == "not_found" else 409
        raise HTTPException(status_code=status, detail=result.get("message") or "撤回失败")
    return result
