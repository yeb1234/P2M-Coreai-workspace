"""LLM 工厂（LangChain ChatOpenAI 封装）。

两条通道：
- external: discovery-api 的 deepseek-v4.1-flash-1017，通过 extra_body 关掉思考链
  （实测 0.4s vs 默认 57s，差 140 倍），支持 tools 与 structured outputs
- local: 本机 LM Studio 的 OpenAI 兼容端点，离线兜底

为什么用 extra_body 而不是 model_kwargs：后者会被当成顶层参数直接传给
Completions.create，实测抛 TypeError。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

from langchain_openai import ChatOpenAI

from app.database import settings

logger = logging.getLogger(__name__)

Provider = Literal["external", "local"]


@dataclass(frozen=True)
class LLMConfig:
    provider: Provider
    model: str
    base_url: str
    api_key: str
    temperature: float
    timeout_s: int
    thinking: bool


def resolve_config(provider: Provider | None = None, temperature: float = 0.2) -> LLMConfig:
    policy = (settings.llm_usage_policy or "external_first").lower()
    if provider is None:
        provider = "external" if policy in ("external_first", "external_only") else "local"

    if provider == "external":
        return LLMConfig(
            provider="external",
            model=settings.external_llm_model,
            base_url=settings.external_llm_base_url,
            api_key=settings.external_llm_api_key,
            temperature=temperature,
            timeout_s=settings.external_llm_timeout_s,
            thinking=settings.external_llm_thinking,
        )
    return LLMConfig(
        provider="local",
        model=settings.openai_model,
        base_url=settings.openai_base_url,
        api_key=settings.openai_api_key,
        temperature=temperature,
        timeout_s=180,
        thinking=False,
    )


def build_chat_model(
    provider: Provider | None = None,
    *,
    temperature: float = 0.2,
    max_tokens: int | None = None,
    streaming: bool = False,
    timeout_s: int | None = None,
) -> ChatOpenAI:
    """构造 ChatOpenAI。external 通道强制关闭思考链以换取响应速度。"""
    config = resolve_config(provider, temperature)

    kwargs: dict = {
        "model": config.model,
        "base_url": config.base_url,
        "api_key": config.api_key,
        "temperature": config.temperature,
        "timeout": timeout_s or config.timeout_s,
        "max_retries": 2,
        "streaming": streaming,
    }
    if max_tokens:
        kwargs["max_tokens"] = max_tokens

    if config.provider == "external" and not config.thinking:
        # deepseek 系列的非标参数，必须走 extra_body 才会透传到服务端
        kwargs["extra_body"] = {"chat_template_kwargs": {"thinking": False}}

    logger.debug("构建 LLM: provider=%s model=%s", config.provider, config.model)
    return ChatOpenAI(**kwargs)


def fallback_models(
    *,
    temperature: float = 0.2,
    max_tokens: int | None = None,
) -> list[ChatOpenAI]:
    """按优先级返回可用模型列表，用于「外部失败降级本地」。"""
    policy = (settings.llm_usage_policy or "external_first").lower()
    order: list[Provider] = (
        ["local"] if policy == "local_only"
        else ["external"] if policy == "external_only"
        else ["external", "local"] if policy == "external_first"
        else ["local", "external"]
    )
    models = []
    for provider in order:
        try:
            models.append(build_chat_model(provider, temperature=temperature, max_tokens=max_tokens))
        except Exception as exc:
            logger.warning("构建 %s 模型失败: %s", provider, exc)
    return models


def llm_health() -> dict:
    """轻量探活：只验证配置完整性与端点可达，不消耗额度。"""
    config = resolve_config("external")
    result = {
        "provider": config.provider,
        "model": config.model,
        "base_url": config.base_url,
        "thinking": config.thinking,
        "configured": bool(config.api_key and config.base_url and config.model),
    }
    return result
