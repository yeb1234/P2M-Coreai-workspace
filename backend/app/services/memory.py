"""记忆系统。

三层分工：
- ChatSession.summary     滑动窗口外的历史压缩（对话过程）
- ChatMessage             原始消息（短期、按需读回）
- MemoryItem              跨会话稳定事实（目标、偏好、约束）

原实现的缺陷是 chat_messages 只写不读，每次对话都是失忆状态。
这里的 load_conversation 会把 summary + 最近 N 条一起组装成上下文。
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.models import ChatMessage, ChatSession, MemoryItem
from app.utils.files import unique_suffix

logger = logging.getLogger(__name__)

COMPRESS_THRESHOLD = 24  # 超过这么多条就压缩
KEEP_RECENT = 10  # 压缩后保留的原文条数


@dataclass
class ConversationContext:
    session_id: str
    summary: str = ""
    messages: list[dict] = field(default_factory=list)
    total_messages: int = 0

def ensure_session(db: Session, session_id: str | None, *, video_id: int | None = None,
                   user_id: int | None = None, title: str = "学习对话") -> ChatSession:
    """拿到（或新建）一个会话。

    **必须校验归属**。session_id 由 unique_suffix() 生成，会出现在响应里，
    也可能被贴到 URL/日志里。原来只按 id 查、查到就返回，于是：

      A 把 session_id 填成 B 的 → 消息写进 B 的会话（污染历史）
      → run_chat 的 _build_history 会把 B 的最近消息和摘要塞进 prompt
      → A 问一句「把上面的对话总结一下」就能原样读走 B 的内容

    这是横向越权读，不是猜 id。所以归属不符时当作「不存在」，
    走新建分支 —— 不能让调用方拿到别人的会话。
    """
    if session_id:
        session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
        if session and user_id is not None and session.user_id == user_id:
            return session
        if session and session.user_id is None and user_id is None:
            # 匿名共享会话（老数据 / 单用户模式）：双方都没有归属时可沿用
            return session
        if session:
            # 归属不符或已过期：记一笔，便于发现有人在试别人的 id
            logger.warning(
                "会话归属校验失败，改为新建 session_id=%s owner=%s请求者=%s",
                session_id, session.user_id, user_id,
            )
    session = ChatSession(
        id=unique_suffix(),
        title=title,
        scope="video" if video_id else "global",
        video_id=video_id,
        user_id=user_id,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def append_message(
    db: Session,
    session_id: str,
    role: str,
    content: str,
    *,
    references: list[dict] | None = None,
    tool_calls: list[dict] | None = None,
    model: str | None = None,
    tokens_in: int | None = None,
    tokens_out: int | None = None,
    latency_ms: int | None = None,
) -> ChatMessage:
    message = ChatMessage(
        id=unique_suffix(),
        session_id=session_id,
        role=role,
        content=content,
        references_json=json.dumps(references or [], ensure_ascii=False) if references else None,
        tool_calls_json=json.dumps(tool_calls, ensure_ascii=False) if tool_calls else None,
        model=model,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        latency_ms=latency_ms,
    )
    db.add(message)
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if session:
        session.message_count = (session.message_count or 0) + 1
        session.updated_at = datetime.now()
    db.commit()
    db.refresh(message)
    return message


def load_conversation(db: Session, session_id: str, recent_limit: int = KEEP_RECENT) -> ConversationContext:
    """读回 summary + 最近 N 条消息。这是「有记忆」的关键一步。"""
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if session is None:
        return ConversationContext(session_id=session_id)

    total = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).count()
    recent = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(desc(ChatMessage.created_at))
        .limit(recent_limit)
        .all()
    )
    recent.reverse()

    messages = []
    for item in recent:
        entry: dict = {"role": item.role, "content": item.content}
        if item.tool_calls_json:
            try:
                entry["tool_calls"] = json.loads(item.tool_calls_json)
            except json.JSONDecodeError:
                pass
        messages.append(entry)

    return ConversationContext(
        session_id=session_id,
        summary=session.summary or "",
        messages=messages,
        total_messages=total,
    )


def maybe_compress(db: Session, session_id: str, *, force: bool = False) -> bool:
    """消息过多时把较早的部分压成摘要，避免上下文无限增长。

    压缩失败不影响对话——保留原文比丢历史更安全。
    """
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if session is None:
        return False

    total = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).count()
    if total <= COMPRESS_THRESHOLD and not force:
        return False

    # 取除最近 KEEP_RECENT 条以外的所有消息
    to_compress = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at)
        .limit(max(total - KEEP_RECENT, 0))
        .all()
    )
    if not to_compress:
        return False

    transcript = "\n".join(f"{m.role}: {m.content[:400]}" for m in to_compress)
    previous = session.summary or "(无)"

    try:
        from app.services.llm import build_chat_model

        model = build_chat_model("external", temperature=0.0, max_tokens=400, timeout_s=20)
        prompt = (
            "把下面的学习对话压缩成要点摘要，供后续对话保持连续性。\n"
            "保留：用户的目标、已确认的结论、待办与未解决的问题、明确表达的偏好。\n"
            "丢弃：寒暄、重复内容、模型自己的推理过程。\n"
            "用中文，不超过 300 字，分条列出。\n\n"
            f"已有摘要：\n{previous}\n\n新增对话：\n{transcript}\n\n输出更新后的完整摘要："
        )
        summary = model.invoke(prompt).content
    except Exception as exc:
        logger.warning("会话压缩失败，保留原文: %s", exc)
        return False

    if not isinstance(summary, str) or not summary.strip():
        return False

    session.summary = summary.strip()
    session.summary_upto_message_id = to_compress[-1].id
    db.commit()
    logger.info("会话 %s 已压缩 %s 条消息", session_id, len(to_compress))
    return True


# ==================== 长期记忆 ====================


def add_memory(
    db: Session,
    content: str,
    *,
    kind: str = "fact",
    source: str = "chat",
    importance: int = 3,
    user_id: int | None = None,
    ttl_days: int | None = None,
) -> MemoryItem:
    if kind not in ("preference", "constraint", "goal", "fact", "ability"):
        kind = "fact"
    item = MemoryItem(
        id=unique_suffix(),
        user_id=user_id,
        kind=kind,
        content=content.strip()[:1000],
        source=source,
        importance=max(1, min(int(importance), 5)),
        expires_at=(datetime.now() + timedelta(days=ttl_days)) if ttl_days else None,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def recall_memories(
    db: Session,
    *,
    user_id: int | None = None,
    kinds: list[str] | None = None,
    limit: int = 12,
) -> list[MemoryItem]:
    """按重要度 + 新鲜度召回长期记忆。过期和被替代的自动忽略。

    必须过滤 superseded_by：软删除和「被新记忆替代」的条目如果还能被召回，
    用户删掉的记忆就等于没删 —— 这是最伤信任的失败模式。
    """
    query = db.query(MemoryItem).filter(
        (MemoryItem.expires_at.is_(None)) | (MemoryItem.expires_at > datetime.now()),
        MemoryItem.superseded_by.is_(None),
    )
    if user_id is not None:
        query = query.filter(MemoryItem.user_id == user_id)
    if kinds:
        query = query.filter(MemoryItem.kind.in_(kinds))

    items = (
        query.order_by(
            # 用户置顶的排最前，其次是重要度，最后看新鲜度
            MemoryItem.pinned.desc(),
            MemoryItem.importance.desc(),
            MemoryItem.updated_at.desc(),
        )
        .limit(limit)
        .all()
    )
    for item in items:
        item.hit_count = (item.hit_count or 0) + 1
        item.last_hit_at = datetime.now()
    if items:
        db.commit()
    return items


def memory_text(db: Session, user_id: int | None = None, limit: int = 10) -> str:
    items = recall_memories(db, user_id=user_id, limit=limit)
    if not items:
        return ""
    labels = {
        "preference": "偏好",
        "constraint": "约束",
        "goal": "目标",
        "fact": "事实",
        "ability": "能力",
    }
    return "\n".join(f"- [{labels.get(i.kind, i.kind)}] {i.content}" for i in items)


# ---------------- 档案 / 助手设定 ----------------
# 存在 user_data 的 key-value 里，和番茄钟一样，不动表结构。
# 读取方有两处：chat_agent 拼 prompt、memory_admin 提供编辑接口。

PROFILE_STORE_KEY = "p2m-profile-v1"
PERSONA_STORE_KEY = "p2m-persona-v1"


def read_user_settings(db: Session, user_id: int | None) -> tuple[dict, dict]:
    """返回 (档案, 助手设定)。任何一侧取不到都返回空 dict，不影响对话。"""
    if user_id is None:
        return {}, {}
    try:
        from app.models import UserData
    except Exception:  # pragma: no cover
        return {}, {}

    rows = (
        db.query(UserData)
        .filter(
            UserData.user_id == user_id,
            UserData.store_key.in_([PROFILE_STORE_KEY, PERSONA_STORE_KEY]),
        )
        .all()
    )
    found: dict[str, dict] = {}
    for row in rows:
        try:
            data = json.loads(row.value or "{}")
            found[row.store_key] = data if isinstance(data, dict) else {}
        except (TypeError, ValueError):
            logger.warning("用户设定解析失败 key=%s user=%s", row.store_key, user_id)
    return found.get(PROFILE_STORE_KEY, {}), found.get(PERSONA_STORE_KEY, {})
