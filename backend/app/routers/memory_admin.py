"""记忆管理 API：让用户能看见、能改、能锁。

为什么需要这层
-------------
原来 `MemoryItem` 只有写入（`add_memory`）和召回（`recall_memories`），
用户完全看不到系统记住了什么，更没法改。这是自动记忆系统最危险的地方 ——
一旦记错，用户没有任何手段纠正，只能反复在对话里解释。

这层给三件事：
1. 看得见（列表）
2. 改得动（PATCH / DELETE）
3. 锁得住（pin）—— 锁住的条目，自动提取不能碰

档案和助手设定走 user_data（key-value JSON），不动表结构。
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.database import SessionLocal
from app.models import MemoryItem, UserData
from app.auth import get_current_user
from app.models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/memory", tags=["memory"])

PROFILE_KEY = "p2m-profile-v1"
PERSONA_KEY = "p2m-persona-v1"

VALID_KINDS = {"fact", "preference", "goal", "constraint", "ability"}


# ---------------- schemas ----------------

class MemoryOut(BaseModel):
    id: str
    kind: str
    content: str
    source: str
    importance: int
    pinned: bool
    confidence: float
    hit_count: int
    created_at: datetime | None = None
    updated_at: datetime | None = None
    superseded: bool = False


class MemoryCreate(BaseModel):
    content: str = Field(min_length=1, max_length=500)
    kind: str = "fact"
    importance: int = Field(default=3, ge=1, le=5)


class MemoryUpdate(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=500)
    kind: str | None = None
    importance: int | None = Field(default=None, ge=1, le=5)
    pinned: bool | None = None


class ProfilePayload(BaseModel):
    """档案：结构化，用于逻辑判断（比如按职业调整建议强度）。"""
    nickname: str = ""
    occupation: str = ""
    goal: str = ""
    timezone: str = "Asia/Shanghai"
    weekly_hours: int = 0
    language: str = "中文"


class PersonaPayload(BaseModel):
    """助手设定：控制怎么说话。freeform 会原样拼进 prompt。"""
    tone: str = "简洁"          # 简洁 / 详细 / 严厉 / 温和
    proactivity: str = "答问"    # 答问 / 反问 / 主动推进
    cite_sources: bool = True
    freeform: str = ""


def _to_out(row: MemoryItem) -> MemoryOut:
    return MemoryOut(
        id=row.id,
        kind=row.kind,
        content=row.content,
        source=row.source,
        importance=row.importance,
        pinned=bool(row.pinned),
        confidence=float(row.confidence or 0.8),
        hit_count=row.hit_count or 0,
        created_at=row.created_at,
        updated_at=row.updated_at,
        superseded=bool(row.superseded_by),
    )


def _read_kv(db, user_id: int, key: str) -> dict:
    row = (
        db.query(UserData)
        .filter(UserData.user_id == user_id, UserData.store_key == key)
        .first()
    )
    if not row or not row.value:
        return {}
    try:
        data = json.loads(row.value)
        return data if isinstance(data, dict) else {}
    except (TypeError, ValueError):
        logger.warning("user_data 解析失败 key=%s user=%s", key, user_id)
        return {}


def _write_kv(db, user_id: int, key: str, payload: dict) -> None:
    row = (
        db.query(UserData)
        .filter(UserData.user_id == user_id, UserData.store_key == key)
        .first()
    )
    body = json.dumps(payload, ensure_ascii=False)
    if row:
        row.value = body
    else:
        db.add(UserData(user_id=user_id, store_key=key, value=body))
    db.commit()


# ---------------- endpoints ----------------

@router.get("/items", response_model=list[MemoryOut])
def list_items(
    kind: str | None = Query(None),
    include_superseded: bool = Query(False, description="是否包含已被替代/删除的条目"),
    user: User = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        q = db.query(MemoryItem).filter(MemoryItem.user_id == user.id)
        if kind:
            q = q.filter(MemoryItem.kind == kind)
        if not include_superseded:
            q = q.filter(MemoryItem.superseded_by.is_(None))
        # 置顶优先，然后重要度、最后更新时间
        rows = q.order_by(
            MemoryItem.pinned.desc(),
            MemoryItem.importance.desc(),
            MemoryItem.updated_at.desc(),
        ).limit(200).all()
        return [_to_out(r) for r in rows]
    finally:
        db.close()


@router.post("/items", response_model=MemoryOut)
def create_item(payload: MemoryCreate, user: User = Depends(get_current_user)):
    if payload.kind not in VALID_KINDS:
        raise HTTPException(status_code=400, detail=f"kind 必须是 {sorted(VALID_KINDS)} 之一")
    db = SessionLocal()
    try:
        row = MemoryItem(
            id=uuid.uuid4().hex,
            user_id=user.id,
            kind=payload.kind,
            content=payload.content.strip(),
            source="manual",       # 用户手填，不是自动提取
            importance=payload.importance,
            pinned=False,
            confidence=1.0,        # 用户自己写的，置信度最高
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return _to_out(row)
    finally:
        db.close()


@router.patch("/items/{item_id}", response_model=MemoryOut)
def update_item(item_id: str, payload: MemoryUpdate, user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        row = (
            db.query(MemoryItem)
            .filter(MemoryItem.id == item_id, MemoryItem.user_id == user.id)
            .first()
        )
        if not row:
            raise HTTPException(status_code=404, detail="记忆条目不存在")

        if payload.content is not None:
            row.content = payload.content.strip()
            # 用户手改过的，来源改成 manual 并拉满置信度 ——
            # 这样后续自动提取会把它当「用户说的话」对待，不会轻易覆盖
            row.source = "manual"
            row.confidence = 1.0
        if payload.kind is not None:
            if payload.kind not in VALID_KINDS:
                raise HTTPException(status_code=400, detail="kind 非法")
            row.kind = payload.kind
        if payload.importance is not None:
            row.importance = payload.importance
        if payload.pinned is not None:
            row.pinned = payload.pinned
        db.commit()
        db.refresh(row)
        return _to_out(row)
    finally:
        db.close()


@router.delete("/items/{item_id}")
def delete_item(item_id: str, user: User = Depends(get_current_user)):
    """软删除：标 superseded_by='__deleted__'，保留可追溯性。

    不物理删，是因为「用户删掉了什么」本身也是信息 —— 排查召回异常时有用。
    """
    db = SessionLocal()
    try:
        row = (
            db.query(MemoryItem)
            .filter(MemoryItem.id == item_id, MemoryItem.user_id == user.id)
            .first()
        )
        if not row:
            raise HTTPException(status_code=404, detail="记忆条目不存在")
        row.superseded_by = "__deleted__"
        db.commit()
        return {"ok": True, "id": item_id}
    finally:
        db.close()


@router.get("/profile")
def get_profile(user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        profile = ProfilePayload(**_read_kv(db, user.id, PROFILE_KEY)).model_dump()
        persona = PersonaPayload(**_read_kv(db, user.id, PERSONA_KEY)).model_dump()
        return {"profile": profile, "persona": persona}
    finally:
        db.close()


@router.put("/profile")
def put_profile(
    profile: ProfilePayload,
    persona: PersonaPayload,
    user: User = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        _write_kv(db, user.id, PROFILE_KEY, profile.model_dump())
        _write_kv(db, user.id, PERSONA_KEY, persona.model_dump())
        return {"ok": True}
    finally:
        db.close()
