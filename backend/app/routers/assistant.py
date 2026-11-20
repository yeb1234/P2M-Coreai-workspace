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

错误约定
--------
这两个端点原来把 requests 的异常直接抛出去，被全局兜底处理器接成
500「服务内部错误，请附带 request_id 反馈」——用户在设置页只能看到这句话，
不知道是 key 错了、地址少了 /v1、还是模型服务没启动。
现在统一在端点内捕获，用 services/llm.py 的分类器翻成人话后以 **502** 返回。
注意不能用 401/403：前端 apiFetch 见到 401 会当成会话失效直接踢回登录页。
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import desc

from app.agents.chat_agent import AgentContext, BASE_PROMPT, stream_chat
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
from app.services.admin_settings import load_assistant_runtime_settings
from app.services.llm import (
    ERR_UNKNOWN,
    call_with_retry,
    classify_llm_error,
    describe_llm_error,
    llm_health,
)
from app.services.llm_client import OpenAICompatibleClient
from app.services.memory import (
    append_message,
    backfill_session_title,
    decode_references,
    ensure_session,
    maybe_compress,
)
from app.services.quota import chat_quota_for, quota_exceeded_detail
from app.services.rate_limit import chat_limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assistant", tags=["assistant"])

# 和 admin.py 里的掩码占位保持一致：GET 设置接口返回它代替真实密钥，
# 前端原样回传时表示「这一项没改」，这里也要认。
MASKED_SECRET = "__MASKED__"


@router.get("/capabilities")
def get_capabilities(_admin: User = Depends(require_admin)):
    """只读管理面：列出已注册工具与能力包，方便排查「模型到底能调什么」。"""
    from app.agents.skills import list_skills
    from app.agents.tool_registry import DEFAULT_REGISTRY
    from app.database import settings

    if settings.is_lite:
        from app.agents.chat_agent import LITE_BASE_PROMPT
        base_prompt = LITE_BASE_PROMPT
    else:
        base_prompt = BASE_PROMPT

    def describe_tool(name: str) -> str:
        handler = DEFAULT_REGISTRY.get(name)
        return ((handler.description if handler else "") or "").strip()[:400]

    skills = list_skills()
    tool_specs = DEFAULT_REGISTRY.specs()
    if settings.is_lite:
        # Lite 只展示真正会挂给模型的能力包工具，外加运行时始终可用的
        # 个人动作和 ask_user。否则页面会把视频/学习路径工具算进 Lite，
        # 用户点开能力清单看到的是一套并不存在的能力。
        from app.agents.tool_runtime import PERSONAL_ACTION_TOOLS

        lite_names = {name for skill in skills for name in skill.tools}
        lite_names.update(PERSONAL_ACTION_TOOLS)
        lite_names.add("ask_user")
        tool_specs = tuple(spec for spec in tool_specs if spec.name in lite_names)

    return {
        "base_prompt": base_prompt,
        "tools": [
            {
                "name": spec.name,
                "version": spec.version,
                "description": describe_tool(spec.name),
                "scopes": list(spec.scopes),
                "timeout_s": spec.timeout_s,
                "max_calls_per_turn": spec.max_calls_per_turn,
                "max_retries": spec.max_retries,
                "requires_login": spec.requires_login,
                "read_only": spec.read_only,
                "enabled": spec.enabled,
                "breaker_failures": spec.breaker_failures,
                "breaker_cooldown_s": spec.breaker_cooldown_s,
                "tags": list(spec.tags),
            }
            for spec in tool_specs
        ],
        "skills": [
            {
                "name": skill.name,
                "version": skill.version,
                "description": skill.description,
                "intents": list(skill.intents),
                "tools": list(skill.tools),
                "max_total_tool_calls": skill.max_total_tool_calls,
                "enabled": skill.enabled,
            }
            for skill in skills
        ],
    }


@router.get("/tool-metrics")
def get_tool_metrics(_admin: User = Depends(require_admin)):
    """只读指标面：延迟分位、超时率、重试成功率、预算/熔断拒绝。"""
    from app.agents.tool_metrics import BREAKER, METRICS
    from app.agents.tool_registry import DEFAULT_REGISTRY

    tools = []
    for spec in DEFAULT_REGISTRY.specs():
        tools.append(
            {
                "name": spec.name,
                "enabled": spec.enabled,
                "metrics": METRICS.snapshot(spec.name),
                "breaker": BREAKER.status(
                    spec.name,
                    spec.breaker_failures,
                    spec.breaker_cooldown_s,
                ),
            }
        )
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "tools": tools,
    }


def _load_session_for_user(db, session_id: str, user: User) -> ChatSession:
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    # 归属不符按不存在处理，避免通过状态码差异探测别人的会话 id。
    #
    # 注意 user_id 为 NULL 的情况：迁移前的历史会话没有归属，原来这里直接放行，
    # 等于**任何登录用户都能读 87 个老会话的 162 条消息**。
    # 现在收紧为「无主会话只有 admin 可读」；有主会话只允许本人读，
    # admin 是运维角色，不是内容绕过角色。
    is_admin = (user.role or "") == "admin"
    if session.user_id is None:
        if not is_admin:
            raise HTTPException(status_code=404, detail="会话不存在")
    elif session.user_id != user.id:
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
    except Exception:
        # 会话建立/用户消息落库失败时还没调用模型，退额度。
        quota.refund(user.id)
        raise
    finally:
        db.close()

    ctx = AgentContext(
        session_id=session_id,
        user_id=user.id,
        video_id=payload.video_id,
        page_context=payload.page_context,
        note_context=payload.page_note.model_dump() if payload.page_note else None,
        system_prompt_extra=payload.system_prompt,
        intent=payload.intent,
    )

    try:
        result = run_chat(ctx, payload.message)
    except Exception as exc:  # noqa: BLE001
        # run_chat 内部已按兜底方案试过两套模型，走到这里说明都没救。
        # 没生成回答就退当天额度，别让服务端错误算到用户头上。
        quota.refund(user.id)
        # 别让全局兜底处理器把它变成「服务内部错误，请附带 request_id 反馈」。
        if classify_llm_error(exc) == ERR_UNKNOWN:
            logger.exception("同步对话失败")
            raise HTTPException(status_code=502, detail="对话生成失败，请稍后重试") from exc
        raise HTTPException(
            status_code=502,
            detail=f"对话生成失败：{describe_llm_error(exc)}",
        ) from exc

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
    """SSE 流式对话。事件：token / tool_start / tool_end / interrupt / done / error

    每个事件是一行 `data: {json}`。普通请求结束后 done 带 run_id 与工具轨迹；
    命中 HITL 时先发 interrupt，前端用同一个 run_id 调 /chat/stream 的 resume 续跑。
    """
    is_resume = payload.resume is not None
    if not is_resume:
        allowed, remaining = chat_limiter.hit(str(user.id))
        if not allowed:
            raise HTTPException(status_code=429, detail="提问太频繁，缓一下再问")

        quota = chat_quota_for(user.role)
        ok, used, limit = quota.consume(user.id)
        if not ok:
            raise HTTPException(status_code=429, detail=quota_exceeded_detail(used, limit, "对话"))
    else:
        # resume 是同一轮请求的继续，不重复限流、不重复扣当天额度。
        quota = None

    db = SessionLocal()
    try:
        session = ensure_session(
            db, payload.session_id, video_id=payload.video_id, user_id=user.id
        )
        session_id = session.id
        if not is_resume:
            append_message(db, session_id, "user", payload.message)
    except Exception:
        # 还没开始流式生成就失败（会话无法建立/用户消息写不进去），退额度。
        if quota is not None:
            quota.refund(user.id)
        raise
    finally:
        db.close()

    ctx = AgentContext(
        session_id=session_id,
        user_id=user.id,
        video_id=payload.video_id,
        page_context=payload.page_context,
        note_context=payload.page_note.model_dump() if payload.page_note else None,
        system_prompt_extra=payload.system_prompt,
        intent=payload.intent,
    )

    async def event_stream():
        collected: list[str] = []
        # done 事件里带着 references / mentioned_videos，捕获下来一起持久化。
        # 不存的话，用户从历史列表打开旧会话只剩纯文字 —— 正文链接和
        # 相关推荐框全丢（它们原本只在前端组件 state 里）。
        rich: dict = {}
        quota_refunded = False
        interrupted = False
        interrupt_question = ""

        def refund_quota_once() -> None:
            nonlocal quota_refunded
            if quota is not None and not quota_refunded:
                quota.refund(user.id)
                quota_refunded = True

        try:
            resume = payload.resume.model_dump() if payload.resume else None
            async for event in stream_chat(
                ctx,
                payload.message,
                resume=resume,
                run_id=payload.resume.run_id if payload.resume else None,
                original_message=payload.resume.original_message if payload.resume else None,
            ):
                event_type = event.get("type")
                if event_type == "token":
                    collected.append(event.get("text", ""))
                elif event_type == "interrupt":
                    interrupted = True
                    interrupt_question = str(event.get("question") or payload.message)[:240]
                elif event_type == "done":
                    rich = {
                        "references": event.get("references") or [],
                        "mentioned_videos": event.get("mentioned_videos") or [],
                        "actions": event.get("actions") or [],
                    }
                elif event_type == "error":
                    # 模型/工具彻底失败：没有可用回答，退还当天额度。
                    refund_quota_once()
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception:
            refund_quota_once()
            raise
        finally:
            answer = "".join(collected).strip()
            if answer:
                db2 = SessionLocal()
                try:
                    append_message(
                        db2, session_id, "assistant", answer,
                        references=rich.get("references"),
                        mentioned_videos=rich.get("mentioned_videos"),
                        actions=rich.get("actions"),
                        intent=payload.intent,
                    )
                    maybe_compress(db2, session_id)
                except Exception:
                    logger.exception("保存助手消息失败")
                finally:
                    db2.close()
            elif interrupted:
                # 中断时把问题本身也存进历史：用户从历史打开会话时，
                # 至少能看到「上一轮停在哪个确认点」，而不是一条空回答。
                db2 = SessionLocal()
                try:
                    append_message(
                        db2, session_id, "assistant",
                        f"等待你的选择：{interrupt_question[:120]}",
                        intent=payload.intent,
                    )
                except Exception:
                    logger.exception("保存 HITL 中断消息失败")
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
            .filter(ChatSession.user_id == user.id, ChatSession.message_count > 0)
            .order_by(desc(ChatSession.updated_at))
            .limit(limit)
            .all()
        )
        return [
            {
                "id": row.id,
                "title": backfill_session_title(db, row),
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


def _which_provider(base_url: str) -> str:
    """按 base_url 判断用户点的是本地还是外部，只用于挑提示文案。"""
    normalized = normalize_openai_base_url(base_url)
    try:
        runtime = load_assistant_runtime_settings()
    except Exception:  # noqa: BLE001
        return ""
    for provider in ("local", "external"):
        stored = normalize_openai_base_url(str(runtime.get(f"{provider}_base_url") or ""))
        if stored and stored == normalized:
            return provider
    return ""


def _resolve_api_key(base_url: str, api_key: str) -> str:
    """决定这次出站用哪个 key。

    设置页 GET 拿到的 key 是掩码占位（库里存的是真值），如果原样当 Bearer 发出去，
    扫模型必然 401。所以：
    - 用户填了新 key → 用新的
    - 空 / 掩码 → 按 base_url 去库里找对应通道的真值
    """
    candidate = (api_key or "").strip()
    if candidate and candidate != MASKED_SECRET:
        return candidate

    normalized = normalize_openai_base_url(base_url)
    try:
        runtime = load_assistant_runtime_settings()
    except Exception:  # noqa: BLE001
        return "" if candidate == MASKED_SECRET else candidate

    for provider in ("local", "external"):
        stored_url = normalize_openai_base_url(str(runtime.get(f"{provider}_base_url") or ""))
        if stored_url and stored_url == normalized:
            return str(runtime.get(f"{provider}_api_key") or "")
    return "" if candidate == MASKED_SECRET else candidate


def _raise_llm_error(exc: Exception, *, base_url: str, action: str) -> None:
    """把上游异常翻成 502 + 人话。request_id 由全局处理器自动带上。"""
    message = describe_llm_error(exc, base_url=base_url)
    logger.warning(
        "%s失败",
        action,
        extra={
            "extra_fields": {
                "llm_action": action,
                "llm_base_url": base_url,
                "llm_error_kind": type(exc).__name__,
                "llm_error": " ".join(str(exc).split())[:300],
            }
        },
        exc_info=True,
    )
    # 500 会让用户看到「服务内部错误」；502 才是「上游模型服务出问题」的语义。
    raise HTTPException(status_code=502, detail=message) from exc


@router.get("/llm-health")
def assistant_llm_health(_admin: User = Depends(require_admin)):
    """当前**实际生效**的 LLM 配置（不含密钥）。

    设置页用它做保存后的自检：看到这里变了，才算真的生效。
    """
    runtime = load_assistant_runtime_settings()
    return {
        "policy": runtime.get("llm_usage_policy"),
        "external": llm_health(),
        "local": {
            "base_url": runtime.get("local_base_url") or "",
            "model": runtime.get("local_model") or "",
            "configured": bool(
                runtime.get("local_base_url") and runtime.get("local_model")
            ),
        },
    }


@router.post("/models", response_model=AssistantModelListOut)
def assistant_models(
    payload: AssistantModelListCreate,
    _admin: User = Depends(require_admin),
):
    base_url = _validate_outbound_url(payload.base_url)
    api_key = _resolve_api_key(base_url, payload.api_key)
    client = OpenAICompatibleClient(base_url=base_url, api_key=api_key, timeout_s=15)

    # 扫描是「一次 30 秒内的同步请求」，重试两次 + 25 秒预算，别把前端拖超时。
    try:
        models = call_with_retry(
            client.list_models,
            provider=_which_provider(base_url) or "external",
            max_attempts=2,
            base_delay_s=0.8,
            budget_s=25,
        )
    except Exception as exc:  # noqa: BLE001
        _raise_llm_error(exc, base_url=base_url, action="扫描模型")

    if not models:
        raise HTTPException(
            status_code=502,
            detail=(
                f"{base_url}/models 返回成功，但里面没有可用模型。"
                "本地服务一般是模型还没加载完，加载好再扫一次。"
            ),
        )
    return AssistantModelListOut(models=models)


@router.post("/connection-test", response_model=AssistantConnectionTestOut)
def assistant_connection_test(
    payload: AssistantConnectionTestCreate,
    _admin: User = Depends(require_admin),
):
    base_url = _validate_outbound_url(payload.base_url)
    if not (payload.model or "").strip():
        raise HTTPException(status_code=422, detail="请先选择模型名，或点「扫描模型」拉取列表")
    api_key = _resolve_api_key(base_url, payload.api_key)
    provider = _which_provider(base_url) or "external"
    client = OpenAICompatibleClient(base_url=base_url, api_key=api_key, timeout_s=120)

    def run() -> str:
        return client.chat_completion(
            model=payload.model,
            messages=[
                {"role": "system", "content": payload.system_prompt or "必须始终使用简体中文回答，禁止用英文回答。"},
                {"role": "user", "content": payload.message},
            ],
            temperature=payload.temperature,
        )

    # 连通性测试要的是「现在到底通不通」：429 值得再试一次，
    # 但一次已经跑了 120 秒就不再重试（预算卡住），免得用户干等。
    try:
        answer = call_with_retry(
            run,
            provider=provider,
            model=payload.model,
            max_attempts=2,
            base_delay_s=1.0,
            budget_s=100,
        )
    except Exception as exc:  # noqa: BLE001
        _raise_llm_error(exc, base_url=base_url, action="连通性测试")

    return AssistantConnectionTestOut(
        status="HTTP 200",
        answer=answer,
        received_text=bool(answer.strip()),
    )
