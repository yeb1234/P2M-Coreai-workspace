"""LangChain-based structured intent recognition for the AI assistant."""

from pydantic import BaseModel, Field

from app.services.admin_settings import (
    load_assistant_runtime_settings,
    load_transcription_settings,
)

VALID_POLICIES = {"local_first", "external_first", "local_only", "external_only"}


class IntentRecognitionResult(BaseModel):
    intent: str = Field(...,
        description="用户意图类型: search(搜索), summary(总结), question(问答), general(普通对话)")
    confidence: float = Field(..., ge=0, le=1,
        description="置信度 0-1, 1 表示非常确定")
    cleaned_query: str = Field(...,
        description="去除意图词后的纯净查询,用于数据库搜索。例如'搜Python'->'Python'")
    keywords: list[str] = Field(default_factory=list,
        description="提取的关键词列表")
    reasoning: str = Field(..., description="判断理由(简短中文)")


INTENT_SYSTEM_PROMPT = """你是意图识别专家。分析用户输入,判断真实意图并返回结构化结果。

可能的意图类型:
- search: 用户想要精确搜索字幕片段，找到特定内容的位置
  例子: "搜Python", "找Vue教程", "有没有关于AI的视频", "帮我找webpack配置资料"
- summary: 用户想要总结、概括一个视频或课程的内容
  例子: "总结一下", "给个大纲", "提炼重点", "复盘这节课", "整理要点", "这节课讲了什么"
- question: 用户想要提问或获得解释
  例子: "什么是闭包", "怎么配置webpack", "为什么报这个错", "讲讲hooks"
- general: 普通对话,无法归入以上类别
  例子: "你好", "谢谢", "今天天气如何", "推荐个学习计划"

提取规则:
- search: cleaned_query 去除"搜/找/查/检索/看看有没有/给我找"等意图词,保留实际搜索内容
- summary: cleaned_query 保留需要总结的主题(如"Vue3重点")
- question: cleaned_query 保留问题核心(如"闭包是什么")
- general: cleaned_query 保持原样

注意:
- 如果用户输入很短(少于5个字)且没有明显意图词,结合页面上下文判断
- 不要过度推断, confidence < 0.6 时归为 general
- keywords 用中文列出 1-3 个核心关键词
- 如果提供了 intent_hint,这是前端快速判断的建议,请参考但不必完全遵从"""


def _get_llm_config() -> dict:
    runtime = load_assistant_runtime_settings()
    # 与 assistant.py 的 llm_usage_policy() 保持一致：先查 assistant_runtime_settings，再查 transcription_settings
    raw_policy = runtime.get("llm_usage_policy") or load_transcription_settings().get("llm_usage_policy", "local_first")
    policy = raw_policy if raw_policy in VALID_POLICIES else "local_first"

    # 根据策略选择 endpoint
    if policy in ("external_first", "external_only"):
        if runtime.get("external_base_url") and runtime.get("external_model"):
            return {
                "base_url": runtime["external_base_url"],
                "model": runtime["external_model"],
                "api_key": runtime.get("external_api_key", ""),
            }
        # external_only 但外部未配置：仍降级到 local（与 assistant.py 行为一致）

    return {
        "base_url": runtime.get("local_base_url", ""),
        "model": runtime.get("local_model", ""),
        "api_key": runtime.get("local_api_key", ""),
    }


def detect_intent_langchain(
    message: str,
    page_context: str = "",
    intent_hint: str = "",
) -> IntentRecognitionResult:
    """Use LangChain structured output to detect user intent.

    Args:
        message: 用户输入
        page_context: 页面上下文
        intent_hint: 前端 regex 的意图判断（可选），高置信度时可直接采纳
    """
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_openai import ChatOpenAI

    config = _get_llm_config()
    base_url = config["base_url"]
    model = config["model"]
    api_key = config["api_key"]

    if not base_url or not model:
        # Fallback: return general with empty cleaned_query
        return IntentRecognitionResult(
            intent="general",
            confidence=0.0,
            cleaned_query=message,
            keywords=[],
            reasoning="LLM 未配置,无法识别意图",
        )

    # Normalize base_url for LangChain OpenAI client
    # LangChain expects the base_url to end with /v1
    normalized_base = base_url.rstrip("/")
    if not normalized_base.endswith("/v1") and "/v1/" not in normalized_base:
        normalized_base = normalized_base + "/v1"

    llm = ChatOpenAI(
        model=model,
        base_url=normalized_base,
        api_key=api_key or "no-key",
        temperature=0.1,
        max_tokens=256,
        timeout=30,
    )

    # 构建用户消息，包含 intent_hint（如果有）
    user_msg_parts = []
    if intent_hint:
        user_msg_parts.append(f"前端快速判断建议意图: {intent_hint}（仅供参考，请结合上下文独立判断）")
    user_msg_parts.append(f"页面上下文: {page_context or '无特定页面上下文'}")
    user_msg_parts.append(f"用户输入: {message}")
    user_message = "\n\n".join(user_msg_parts)

    prompt = ChatPromptTemplate.from_messages([
        ("system", INTENT_SYSTEM_PROMPT),
        ("human", user_message),
    ])

    structured_llm = llm.with_structured_output(IntentRecognitionResult)
    chain = prompt | structured_llm

    try:
        result = chain.invoke({
            "message": message,
            "page_context": page_context or "无特定页面上下文",
        })
        return result
    except Exception:
        # Fallback on any LangChain error
        return IntentRecognitionResult(
            intent="general",
            confidence=0.0,
            cleaned_query=message,
            keywords=[],
            reasoning="意图识别服务异常,降级为普通对话",
        )
