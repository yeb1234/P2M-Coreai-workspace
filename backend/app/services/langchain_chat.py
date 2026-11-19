"""LangChain-based chat service with memory management.

Replaces the hand-written OpenAICompatibleClient / OllamaClient with
LangChain ChatOpenAI / ChatOllama, and adds conversation memory support.
"""

from __future__ import annotations

import logging
from typing import Literal

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from app.database import SessionLocal, settings
from app.models import ChatMessage, ChatSession
from app.services.admin_settings import load_assistant_runtime_settings
from app.services.prompts import ASSISTANT_SYSTEM_DEFAULT

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Memory management
# ---------------------------------------------------------------------------

MAX_HISTORY_TURNS = 10  # 最多保留最近 10 轮对话（减少 prompt 长度，加速 LLM 响应）


def load_session_history(session_id: str, max_turns: int = MAX_HISTORY_TURNS) -> list[BaseMessage]:
    """从数据库加载会话历史，返回 LangChain 消息列表。"""
    db = SessionLocal()
    try:
        messages = (
            db.query(ChatMessage)
            .filter(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.created_at.asc())
            .all()
        )
        # 只取最近 max_turns * 2 条（每轮 = user + assistant）
        recent = messages[-(max_turns * 2):]
        result: list[BaseMessage] = []
        for msg in recent:
            if msg.role == "user":
                result.append(HumanMessage(content=msg.content))
            elif msg.role == "assistant":
                result.append(AIMessage(content=msg.content))
        return result
    finally:
        db.close()


def store_message(session_id: str, role: str, content: str, references: list[dict] | None = None) -> None:
    """存储消息到数据库。"""
    import json
    from app.utils.files import unique_suffix

    db = SessionLocal()
    try:
        db.add(
            ChatMessage(
                id=unique_suffix(),
                session_id=session_id,
                role=role,
                content=content,
                references_json=json.dumps(references or [], ensure_ascii=False),
            )
        )
        db.commit()
    finally:
        db.close()


def ensure_session(session_id: str | None, video_id: int | None) -> ChatSession:
    """获取或创建会话。"""
    from app.utils.files import unique_suffix

    db = SessionLocal()
    try:
        if session_id:
            session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
            if session:
                return session

        session = ChatSession(
            id=unique_suffix(),
            title="Learning Assistant",
            scope="video" if video_id else "global",
            video_id=video_id,
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        return session
    finally:
        db.close()


# ---------------------------------------------------------------------------
# LLM provider resolution
# ---------------------------------------------------------------------------

Provider = Literal["openai", "ollama", "external"]


def _resolve_provider() -> tuple[Provider, dict]:
    """根据配置决定使用哪个 LLM provider，返回 (provider, config_dict)。

    优先使用数据库中的 llm_usage_policy（用户在 UI 设置的策略），
    而非环境变量 settings.assistant_llm_provider。
    """
    runtime = load_assistant_runtime_settings()
    policy = runtime.get("llm_usage_policy", "local_first")

    local_config = {
        "base_url": runtime.get("local_base_url", ""),
        "api_key": runtime.get("local_api_key", ""),
        "model": runtime.get("local_model", ""),
    }
    external_config = {
        "base_url": runtime.get("external_base_url", ""),
        "api_key": runtime.get("external_api_key", ""),
        "model": runtime.get("external_model", ""),
    }

    def _has_config(cfg: dict) -> bool:
        return bool(cfg.get("base_url") and cfg.get("model"))

    def _provider_for_config(cfg: dict, label: str) -> Provider:
        """根据配置内容推断 provider 类型（用于 create_llm 选择 ChatOpenAI vs ChatOllama）。"""
        base = (cfg.get("base_url") or "").lower()
        # 如果 base_url 包含 /v1 或 api_key 非空，认为是 OpenAI 兼容接口
        if "/v1" in base or cfg.get("api_key"):
            return "openai"
        return "ollama"

    # 根据策略选择配置
    if policy in ("external_first", "external_only"):
        if _has_config(external_config):
            return _provider_for_config(external_config, "external"), external_config
        if policy == "external_only" and _has_config(local_config):
            # external_only 但外部未配置，降级到 local
            return _provider_for_config(local_config, "local"), local_config
        if _has_config(local_config):
            return _provider_for_config(local_config, "local"), local_config

    elif policy == "local_only":
        if _has_config(local_config):
            return _provider_for_config(local_config, "local"), local_config

    else:  # local_first (default)
        if _has_config(local_config):
            return _provider_for_config(local_config, "local"), local_config
        if _has_config(external_config):
            return _provider_for_config(external_config, "external"), external_config

    # 最终兜底：返回 local config（即使为空，让上层报错）
    return "openai", local_config


def _normalize_base_url(base_url: str) -> str:
    """确保 base_url 以 /v1 结尾（LangChain OpenAI 需要）。"""
    normalized = base_url.rstrip("/")
    if not normalized.endswith("/v1") and "/v1/" not in normalized:
        normalized = normalized + "/v1"
    return normalized


def create_llm(provider: Provider, config: dict, temperature: float = 0.2, max_tokens: int = 1024):
    """创建 LangChain ChatModel 实例。"""
    if provider in ("openai", "external"):
        return ChatOpenAI(
            model=config["model"],
            base_url=_normalize_base_url(config["base_url"]),
            api_key=config.get("api_key") or "no-key",
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=60,
        )
    else:
        # Ollama 也走 OpenAI 兼容接口（LM Studio 风格）
        # 如果是纯 Ollama，用 ChatOllama
        from langchain_ollama import ChatOllama
        return ChatOllama(
            model=config["model"],
            base_url=config.get("base_url", "http://localhost:11434"),
            temperature=temperature,
            num_predict=max_tokens,
        )


# ---------------------------------------------------------------------------
# Core chat function with memory
# ---------------------------------------------------------------------------

def chat_with_memory(
    *,
    message: str,
    session_id: str,
    system_prompt: str = "",
    page_context: str = "",
    references: list[dict] | None = None,
    depth: str = "basic",
    max_history_turns: int = MAX_HISTORY_TURNS,
) -> tuple[str, str]:
    """带记忆的聊天。

    Returns:
        (answer, mode) — mode 是 "openai" / "ollama" / "external"
    """
    from app.services.prompts import build_assistant_learning_prompt, build_contextual_user_message

    # 1. 解析 provider
    provider, config = _resolve_provider()
    if not config.get("base_url") or not config.get("model"):
        raise RuntimeError("LLM 未配置")

    # 2. 加载历史消息
    history = load_session_history(session_id, max_turns=max_history_turns)

    # 3. 构建系统提示
    system_content = system_prompt.strip() or ASSISTANT_SYSTEM_DEFAULT

    # 4. 构建当前用户消息（包含页面上下文 + RAG 参考资料）
    rag_context = ""
    if references:
        lines = []
        for idx, ref in enumerate(references, start=1):
            lines.append(
                f"{idx}. 视频: {ref['video_title']}\n"
                f"   时间: {int(ref['start_sec'])}s - {int(ref['end_sec'])}s\n"
                f"   字幕: {ref['text']}"
            )
        rag_context = "\n".join(lines)

    user_content = build_assistant_learning_prompt(message, rag_context, depth=depth)
    if page_context:
        user_content = build_contextual_user_message(user_content, page_context)

    # 5. 组装完整消息列表
    messages: list[BaseMessage] = [SystemMessage(content=system_content)]
    messages.extend(history)
    messages.append(HumanMessage(content=user_content))

    # 6. 调用 LLM
    llm = create_llm(provider, config)
    response = llm.invoke(messages)
    answer = response.content.strip()

    # 7. 存储消息到数据库
    store_message(session_id, "user", message)
    store_message(session_id, "assistant", answer, references=references)

    mode = "openai" if provider in ("openai",) else provider
    return answer, mode
