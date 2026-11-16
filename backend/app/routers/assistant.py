"""助手 API：同步对话、SSE 流式对话、会话历史。

/chat        同步返回完整答案（旧前端兼容，走轻量单轮链路）
/chat/stream SSE 流式（Agent + 工具调用，前端推荐）

安全说明
--------
/models 和 /connection-test 接受用户传入的 base_url，服务端会真的去发请求。
早期版本这两个端点没有任何鉴权，等于把服务器当成任意请求的跳板（SSRF）：
攻击者可以让它去访问内网地址、云元数据接口，再把响应内容读走。

现在改成：仅管理员可用 + 只允许 http/https。
管理员本身就有配置模型地址的权限，允许内网是必要的（本地 LM Studio 就在内网）。
"""

from __future__ import annotations

import json
import logging
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import desc

from app.agents.chat_agent import AgentContext, stream_chat
from app.auth import get_current_user, require_admin
from app.database import SessionLocal
from app.models import ChatMessage, ChatSession, User
from app.schemas import (
    AssistantChatCreate,
    AssistantChatOut,
    AssistantConnectionTestCreate,
    AssistantConnectionTestOut,
    AssistantModelListCreate,
    AssistantModelListOut,
)
from app.agents.chat_agent import AgentContext, run_chat
from app.services.llm_client import OpenAICompatibleClient
from app.services.memory import append_message, decode_references, ensure_session, maybe_compress
from app.services.quota import chat_quota_for, quota_exceeded_detail
from app.services.rate_limit import chat_limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


def _load_session_for_user(db, session_id: str, user: User) -> ChatSession:
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    # 归属不符按不存在处理，避免通过状态码差异探测别人的会话 id。
    #
    # 注意 user_id 为 NULL 的情况：迁移前的历史会话没有归属，原来这里直接放行，
    # 等于**任何登录用户都能读 87 个老会话的 162 条消息**。
    # 现在收紧为「无主会话只有 admin 可读」，并且数据侧已经把老会话归给了最早的 admin。
    is_admin = (user.role or "") == "admin"
    if session.user_id is None:
        if not is_admin:
            raise HTTPException(status_code=404, detail="会话不存在")
    elif session.user_id != user.id and not is_admin:
        raise HTTPException(status_code=404, detail="会话不存在")
    return session


@router.post("/chat", response_model=AssistantChatOut)
def assistant_chat(payload: AssistantChatCreate, user: User = Depends(get_current_user)):
    allowed, _ = chat_limiter.hit(str(user.id))
    if not allowed:
        raise HTTPException(status_code=429, detail="提问太频繁，缓一下")

    # 限流管瞬时速率，配额管每天总量。两个都要：只限流不限额，慢速刷也能跑光额度
    quota = chat_quota_for(user.role)
    ok, used, limit = quota.consume(user.id)
    if not ok:
        raise HTTPException(status_code=429, detail=quota_exceeded_detail(used, limit, "对话"))

    # 走和流式完全相同的 Agent 路径。
    # 原来这里调的是 services/assistant.py 里的模板 RAG 流程，
    # 和流式接口是两套实现 —— 提示词只对一边生效，另一边会答非所问。
    db = SessionLocal()
    try:
        session = ensure_session(
            db, payload.session_id, video_id=payload.video_id, user_id=user.id
        )
        session_id = session.id
        append_message(db, session_id, "user", payload.message)
    finally:
        db.close()

    ctx = AgentContext(
        session_id=session_id,
        user_id=user.id,
        video_id=payload.video_id,
        page_context=payload.page_context,
        system_prompt_extra=payload.system_prompt,
        intent=payload.intent,
    )

    result = run_chat(ctx, payload.message)

    if result.answer:
        db2 = SessionLocal()
        try:
            append_message(db2, session_id, "assistant", result.answer, intent=payload.intent)
            maybe_compress(db2, session_id)
        except Exception:
            logger.exception("保存助手消息失败")
        finally:
            db2.close()

    return AssistantChatOut(
        session_id=session_id,
        answer=result.answer,
        mode="agent",
        depth=payload.depth,
        rag_enabled=True,
        references=[],
    )


@router.post("/chat/stream")
async def assistant_chat_stream(payload: AssistantChatCreate, user: User = Depends(get_current_user)):
    """SSE 流式对话。事件：token / tool_start / tool_end / done / error

    每个事件是一行 `data: {json}`，done 事件里带 run_id 与工具轨迹。
    """
    allowed, remaining = chat_limiter.hit(str(user.id))
    if not allowed:
        raise HTTPException(status_code=429, detail="提问太频繁，缓一下再问")

    quota = chat_quota_for(user.role)
    ok, used, limit = quota.consume(user.id)
    if not ok:
        raise HTTPException(status_code=429, detail=quota_exceeded_detail(used, limit, "对话"))

    db = SessionLocal()
    try:
        session = ensure_session(
            db, payload.session_id, video_id=payload.video_id, user_id=user.id
        )
        session_id = session.id
        append_message(db, session_id, "user", payload.message)
    finally:
        db.close()

    ctx = AgentContext(
        session_id=session_id,
        user_id=user.id,
        video_id=payload.video_id,
        page_context=payload.page_context,
        system_prompt_extra=payload.system_prompt,
        intent=payload.intent,
    )

    async def event_stream():
        collected: list[str] = []
        # done 事件里带着 references / mentioned_videos，捕获下来一起持久化。
        # 不存的话，用户从历史列表打开旧会话只剩纯文字 —— 正文链接和
        # 相关推荐框全丢（它们原本只在前端组件 state 里）。
        rich: dict = {}
        try:
            async for event in stream_chat(ctx, payload.message):
                if event.get("type") == "token":
                    collected.append(event.get("text", ""))
                elif event.get("type") == "done":
                    rich = {
                        "references": event.get("references") or [],
                        "mentioned_videos": event.get("mentioned_videos") or [],
                    }
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        finally:
            answer = "".join(collected).strip()
            if answer:
                db2 = SessionLocal()
                try:
                    append_message(
                        db2, session_id, "assistant", answer,
                        references=rich.get("references"),
                        mentioned_videos=rich.get("mentioned_videos"),
                        intent=payload.intent,
                    )
                    maybe_compress(db2, session_id)
                except Exception:
                    logger.exception("保存助手消息失败")
                finally:
                    db2.close()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            # nginx 必须关闭缓冲，否则流式会被攒成一整块
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/sessions")
def list_sessions(
    limit: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        rows = (
            db.query(ChatSession)
            .filter(ChatSession.user_id == user.id)
            .order_by(desc(ChatSession.updated_at))
            .limit(limit)
            .all()
        )
        return [
            {
                "id": row.id,
                "title": row.title,
                "scope": row.scope,
                "video_id": row.video_id,
                "message_count": row.message_count,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            }
            for row in rows
        ]
    finally:
        db.close()


@router.get("/sessions/{session_id}/messages")
def get_session_messages(
    session_id: str,
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        session = _load_session_for_user(db, session_id, user)

        rows = (
            db.query(ChatMessage)
            .filter(ChatMessage.session_id == session_id)
            .order_by(desc(ChatMessage.created_at))
            .limit(limit)
            .all()
        )
        rows.reverse()
        return {
            "session_id": session_id,
            "summary": session.summary,
            "messages": [
                {
                    "id": row.id,
                    "role": row.role,
                    "content": row.content,
                    **decode_references(row.references_json),
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
                for row in rows
            ],
        }
    finally:
        db.close()


def normalize_openai_base_url(value: str) -> str:
    trimmed = (value or "").strip().rstrip("/")
    if trimmed.endswith("/v1/chat/completions"):
        return trimmed[: -len("/chat/completions")]
    if trimmed.endswith("/chat/completions"):
        return trimmed[: -len("/chat/completions")]
    return trimmed


def _validate_outbound_url(value: str) -> str:
    """挡住 file:// gopher:// 之类的协议，只允许 http/https 出站。"""
    normalized = normalize_openai_base_url(value)
    parsed = urlparse(normalized)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=422, detail="模型地址只支持 http 或 https")
    if not parsed.hostname:
        raise HTTPException(status_code=422, detail="模型地址不合法")
    return normalized


@router.post("/models", response_model=AssistantModelListOut)
def assistant_models(
    payload: AssistantModelListCreate,
    _admin: User = Depends(require_admin),
):
    client = OpenAICompatibleClient(
        base_url=_validate_outbound_url(payload.base_url),
        api_key=payload.api_key,
        timeout_s=30,
    )
    return AssistantModelListOut(models=client.list_models())


@router.post("/connection-test", response_model=AssistantConnectionTestOut)
def assistant_connection_test(
    payload: AssistantConnectionTestCreate,
    _admin: User = Depends(require_admin),
):
    client = OpenAICompatibleClient(
        base_url=_validate_outbound_url(payload.base_url),
        api_key=payload.api_key,
        timeout_s=120,
    )
    answer = client.chat_completion(
        model=payload.model,
        messages=[
            {"role": "system", "content": payload.system_prompt or "必须始终使用简体中文回答，禁止用英文回答。"},
            {"role": "user", "content": payload.message},
        ],
        temperature=payload.temperature,
    )
    return AssistantConnectionTestOut(
        status="HTTP 200",
        answer=answer,
        received_text=bool(answer.strip()),
    )
