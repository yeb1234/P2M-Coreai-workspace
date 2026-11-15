"""助手 API：同步对话、SSE 流式对话、会话历史。

/chat        同步返回完整答案（旧前端兼容，走轻量单轮链路）
/chat/stream SSE 流式（Agent + 工具调用，前端推荐）
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import desc

from app.agents.chat_agent import AgentContext, stream_chat
from app.database import SessionLocal
from app.models import ChatMessage, ChatSession
from app.schemas import (
    AssistantChatCreate,
    AssistantChatOut,
    AssistantConnectionTestCreate,
    AssistantConnectionTestOut,
    AssistantModelListCreate,
    AssistantModelListOut,
)
from app.services.assistant import run_assistant_chat
from app.services.llm_client import OpenAICompatibleClient
from app.services.memory import append_message, ensure_session, maybe_compress

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


@router.post("/chat", response_model=AssistantChatOut)
def assistant_chat(payload: AssistantChatCreate):
    result = run_assistant_chat(
        message=payload.message,
        page_context=payload.page_context,
        system_prompt=payload.system_prompt,
        session_id=payload.session_id,
        video_id=payload.video_id,
        depth=payload.depth,
        use_rag=payload.use_rag,
        use_web_search=payload.use_web_search,
        use_deep_research=payload.use_deep_research,
        limit=payload.limit,
    )
    return AssistantChatOut(**result)


@router.post("/chat/stream")
async def assistant_chat_stream(payload: AssistantChatCreate):
    """SSE 流式对话。事件：token / tool_start / tool_end / done / error

    每个事件是一行 `data: {json}`，done 事件里带 run_id 与工具轨迹。
    """
    db = SessionLocal()
    try:
        session = ensure_session(db, payload.session_id, video_id=payload.video_id)
        session_id = session.id
        append_message(db, session_id, "user", payload.message)
    finally:
        db.close()

    ctx = AgentContext(
        session_id=session_id,
        video_id=payload.video_id,
        page_context=payload.page_context,
        system_prompt_extra=payload.system_prompt,
    )

    async def event_stream():
        collected: list[str] = []
        try:
            async for event in stream_chat(ctx, payload.message):
                if event.get("type") == "token":
                    collected.append(event.get("text", ""))
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        finally:
            answer = "".join(collected).strip()
            if answer:
                db2 = SessionLocal()
                try:
                    append_message(db2, session_id, "assistant", answer)
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
def list_sessions(limit: int = Query(20, ge=1, le=100)):
    db = SessionLocal()
    try:
        rows = db.query(ChatSession).order_by(desc(ChatSession.updated_at)).limit(limit).all()
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
def get_session_messages(session_id: str, limit: int = Query(50, ge=1, le=200)):
    db = SessionLocal()
    try:
        session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
        if not session:
            raise HTTPException(status_code=404, detail="会话不存在")

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
                    "references": json.loads(row.references_json) if row.references_json else [],
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
                for row in rows
            ],
        }
    finally:
        db.close()


def normalize_openai_base_url(value: str) -> str:
    trimmed = value.strip().rstrip("/")
    if trimmed.endswith("/v1/chat/completions"):
        return trimmed[: -len("/chat/completions")]
    if trimmed.endswith("/chat/completions"):
        return trimmed[: -len("/chat/completions")]
    return trimmed


@router.post("/models", response_model=AssistantModelListOut)
def assistant_models(payload: AssistantModelListCreate):
    client = OpenAICompatibleClient(
        base_url=normalize_openai_base_url(payload.base_url),
        api_key=payload.api_key,
        timeout_s=30,
    )
    return AssistantModelListOut(models=client.list_models())


@router.post("/connection-test", response_model=AssistantConnectionTestOut)
def assistant_connection_test(payload: AssistantConnectionTestCreate):
    client = OpenAICompatibleClient(
        base_url=normalize_openai_base_url(payload.base_url),
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
