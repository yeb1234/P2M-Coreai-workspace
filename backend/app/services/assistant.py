import re

from app.database import settings
from app.services.admin_settings import load_assistant_runtime_settings, load_transcription_settings
from app.services.langchain_chat import ensure_session
from app.services.llm_client import OllamaClient, OpenAICompatibleClient
from app.services.prompts import (
    ASSISTANT_SYSTEM_DEFAULT,
    build_assistant_learning_prompt,
)


def llm_usage_policy() -> str:
    try:
        value = load_assistant_runtime_settings().get("llm_usage_policy") or load_transcription_settings().get("llm_usage_policy")
    except Exception:
        value = settings.llm_usage_policy
    return value if value in {"local_first", "external_first", "local_only", "external_only"} else "local_first"


def assistant_runtime_settings() -> dict:
    try:
        return load_assistant_runtime_settings()
    except Exception:
        return {
            "local_base_url": settings.openai_base_url,
            "local_api_key": settings.openai_api_key,
            "local_model": settings.openai_model,
            "external_base_url": settings.external_llm_base_url,
            "external_api_key": settings.external_llm_api_key,
            "external_model": settings.external_llm_model,
            "llm_usage_policy": settings.llm_usage_policy,
        }


# ─── 搜索查询清洗 ───

def _clean_search_query(query: str) -> str:
    """去除搜索意图词，提取核心搜索内容。'搜Python教程' → 'Python教程'"""
    cleaned = re.sub(
        r'^(搜[索找]?|找[到出]?|查[询找]?|检索|帮我[搜查找]|查找|搜索|关于|有没有|看看?有没有|给我?[找搜])\s*',
        '',
        query.strip(),
        flags=re.IGNORECASE,
    )
    return cleaned.strip() or query.strip()


# ─── 四种模式的系统提示词 ───

CHAT_SYSTEM_PROMPT = (
    "你是灵境小助手，一个智能 AI 助手。\n"
    "必须始终使用简体中文回答，禁止用英文回答；引用英文资料时也要翻译成中文表达。\n"
    "回答要简洁、有用、直接。"
)

VIDEO_CONTEXT_SYSTEM_PROMPT = (
    "你是面向个人视频库的中文学习助手。\n"
    "必须始终使用简体中文回答，禁止用英文回答；引用英文资料时也要翻译成中文表达。\n"
    "用户正在看一个视频，下面是当前视频的上下文。基于视频内容回答用户的学习问题。\n"
    "推荐具体知识点时，写出时间点。如果视频上下文不足以回答，说明缺少什么。"
)

SEARCH_SYSTEM_PROMPT = (
    "你是面向个人视频库的中文学习助手。\n"
    "必须始终使用简体中文回答，禁止用英文回答；引用英文资料时也要翻译成中文表达。\n"
    "根据参考字幕片段回答学习问题，推荐课程时写出视频标题和时间点（秒）。\n"
    "如果参考片段不足以回答，说明缺少什么，建议先生成或补全字幕。"
)

SUMMARY_SYSTEM_PROMPT = (
    "你是面向个人视频库的中文学习助手。\n"
    "必须始终使用简体中文回答，禁止用英文回答；引用英文资料时也要翻译成中文表达。\n"
    "根据参考字幕片段，对视频内容进行总结和概括。\n"
    "要求：\n"
    "- 提炼核心知识点和要点\n"
    "- 给出结构化的大纲（分点列出）\n"
    "- 标注关键内容对应的时间点（秒）\n"
    "- 如果参考片段不足以完整总结，说明缺少什么部分"
)

LEARNING_PLAN_SYSTEM_PROMPT = (
    "你是学习路线规划助手。\n"
    "必须始终使用简体中文回答，禁止用英文回答。\n"
    "根据用户想学习的方向，给出结构化的学习路线规划。要求：\n"
    "- 分阶段（入门→进阶→深入），每个阶段列出核心知识点\n"
    "- 每个知识点建议 1-2 个学习资源或实践方式\n"
    "- 标注预计学习时长\n"
    "- 给出可执行的下一步行动\n"
    "回答要具体、可执行，不要泛泛而谈。"
)


def run_assistant_chat(
    *,
    message: str,
    page_context: str = "",
    system_prompt: str = "",
    session_id: str | None = None,
    video_id: int | None = None,
    depth: str = "basic",
    use_rag: bool = False,
    use_web_search: bool = False,
    use_deep_research: bool = False,
    limit: int = 6,
    cleaned_query: str = "",
    intent: str = "",
    intent_hint: str = "",
) -> dict:
    """运行 AI 助手聊天（五模式路由）。

    模式：
    - chat           → 通用对话，不搜索，不注入视频上下文
    - video_context  → 基于当前视频上下文学习，不搜索其他视频
    - search         → 精确检索字幕片段 + LLM 生成
    - summary        → 覆盖式检索 + LLM 总结概括
    - learning_plan  → 学习路线规划（当前用 LLM 知识，后续接 RAG）
    """
    from app.services.langchain_chat import chat_with_memory
    from app.services.rag_chain import create_rag_chain

    # 1. 获取或创建会话
    session = ensure_session(session_id, video_id)
    safe_depth = "deepen" if depth == "deepen" else "basic"

    # 2. 五模式路由
    if intent == "search":
        # ── 精确检索模式：搜索全库字幕片段 ──
        prompt = system_prompt.strip() or SEARCH_SYSTEM_PROMPT
        search_text = _clean_search_query(cleaned_query or message)
        rag_chain = create_rag_chain()
        answer, references, mode = rag_chain.qa(
            query=search_text,
            video_id=video_id,
            limit=limit,
            system_prompt=prompt,
            page_context=page_context,
            depth=safe_depth,
            session_id=session.id,
            intent="search",
        )

    elif intent == "summary":
        # ── 总结检索模式：覆盖式检索 + LLM 总结 ──
        prompt = system_prompt.strip() or SUMMARY_SYSTEM_PROMPT
        search_text = _clean_search_query(cleaned_query or message)
        rag_chain = create_rag_chain()
        # 总结模式用更大的 limit 以覆盖更多内容
        summary_limit = max(limit, 15)
        answer, references, mode = rag_chain.qa(
            query=search_text,
            video_id=video_id,
            limit=summary_limit,
            system_prompt=prompt,
            page_context=page_context,
            depth=safe_depth,
            session_id=session.id,
            intent="summary",
        )

    elif intent == "video_context":
        # ── 视频上下文模式：基于当前视频学习 ──
        prompt = system_prompt.strip() or VIDEO_CONTEXT_SYSTEM_PROMPT
        answer, mode = chat_with_memory(
            message=message,
            session_id=session.id,
            system_prompt=prompt,
            page_context=page_context,  # 注入当前视频上下文
            depth=safe_depth,
        )
        references = []

    elif intent == "learning_plan":
        # ── 学习路线规划模式 ──
        # 当前：用 LLM 自身知识生成学习路线
        # 后续：接入 RAG，检索自定义路线图数据
        prompt = system_prompt.strip() or LEARNING_PLAN_SYSTEM_PROMPT
        answer, mode = chat_with_memory(
            message=message,
            session_id=session.id,
            system_prompt=prompt,
            page_context="",  # 不注入页面上下文
            depth="deepen",   # 学习路线默认深入模式
        )
        references = []

    else:
        # ── 聊天模式（默认）：通用对话 ──
        prompt = system_prompt.strip() or CHAT_SYSTEM_PROMPT
        answer, mode = chat_with_memory(
            message=message,
            session_id=session.id,
            system_prompt=prompt,
            page_context="",  # 不注入页面上下文
            depth=safe_depth,
        )
        references = []

    return {
        "session_id": session.id,
        "answer": answer,
        "mode": mode,
        "depth": safe_depth,
        "rag_enabled": intent in ("search", "summary"),
        "web_search_enabled": use_web_search,
        "deep_research_enabled": use_deep_research,
        "references": references,
    }
