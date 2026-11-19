"""RAG Chain: Retrieval-Augmented Generation pipeline using LCEL.

Combines the hybrid retriever with LangChain's LCEL for a complete RAG workflow.
Includes query rewriting, reranking, filtering, and compression.
"""

from __future__ import annotations

import logging
import os

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage

from app.services.hybrid_retriever import HybridRetriever, create_hybrid_retriever
from app.services.langchain_chat import _resolve_provider, create_llm, load_session_history, store_message
from app.services.prompts import ASSISTANT_SYSTEM_DEFAULT
from app.services.retrieval_postprocessor import ContextCompressor, RelevanceFilter

logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off", ""}


class RAGChain:
    """RAG Chain：检索增强生成流水线。

    完整流程：
    1. 查询改写（QueryEnhancer，集成在 HybridRetriever 中）
    2. 混合检索（FTS5 + sqlite-vec，多变体检索 + RRF 融合）
    3. Reranking（bge-reranker 模型重排序）
    4. Filter（相关性阈值过滤）
    5. Compressor（相邻片段合并 + 总量控制）
    6. LLM 生成回答

    支持两种模式：
    - search: 精确检索字幕片段 + LLM 生成
    - summary: 覆盖式检索 + LLM 总结概括
    """

    def __init__(
        self,
        retriever: HybridRetriever | None = None,
        fts_weight: float = 0.5,
        vec_weight: float = 0.5,
        default_limit: int = 6,
        enable_query_expansion: bool = True,
        enable_reranker: bool | None = None,
        min_score: float | None = None,
        max_chars: int = 6000,
    ):
        if enable_reranker is None:
            enable_reranker = _env_bool("RERANK_ENABLED", True)
        if min_score is None:
            min_score = float(os.getenv("RERANK_MIN_SCORE") or "0.15")
        self.retriever = retriever or create_hybrid_retriever(
            fts_weight=fts_weight,
            vec_weight=vec_weight,
            default_limit=default_limit,
            enable_query_expansion=enable_query_expansion,
            enable_reranker=enable_reranker,
        )
        self.relevance_filter = RelevanceFilter(min_score=min_score)
        self.compressor = ContextCompressor(max_chars=max_chars)

    def search(
        self,
        query: str,
        video_id: int | None = None,
        limit: int = 6,
        intent: str = "search",
    ) -> list[dict]:
        """执行检索，返回格式化的参考结果。

        Args:
            query: 用户查询
            video_id: 可选，限定视频范围
            limit: 返回结果数
            intent: 检索意图（search=精确, summary=覆盖）
        """
        # 1. 混合检索（含查询改写 + reranking）
        docs = self.retriever.invoke(
            query,
            video_id=video_id,
            limit=limit,
            intent=intent,
        )

        # 2. 转换为 dict
        results = []
        for doc in docs:
            meta = doc.metadata
            results.append({
                "video_id": meta.get("video_id", 0),
                "video_title": meta.get("video_title", ""),
                "start_sec": meta.get("start_sec", 0),
                "end_sec": meta.get("end_sec", 0),
                "text": doc.page_content,
                "score_hint": meta.get("score_hint", 0),
                "rerank_score": meta.get("rerank_score", 0),
                "segment_id": meta.get("segment_id", 0),
            })

        # 3. Filter：过滤低相关性结果
        results = self.relevance_filter.filter(results)

        # 4. Compressor：合并相邻片段
        results = self.compressor.merge_adjacent(results)

        return results

    def qa(
        self,
        query: str,
        video_id: int | None = None,
        limit: int = 6,
        system_prompt: str = "",
        page_context: str = "",
        depth: str = "basic",
        session_id: str | None = None,
        intent: str = "search",
    ) -> tuple[str, list[dict], str]:
        """执行完整的 RAG 流程：检索 + 生成回答。

        Args:
            query: 用户查询
            video_id: 可选，限定视频范围
            limit: 返回结果数
            system_prompt: 自定义系统提示词
            page_context: 页面上下文
            depth: 深度（basic/deepen）
            session_id: 会话 ID
            intent: 检索意图（search/summary）

        Returns:
            (answer, references, mode)
        """
        # 1. 检索（含 filter + compressor）
        references = self.search(query, video_id=video_id, limit=limit, intent=intent)

        # 2. 构建上下文（控制总长度）
        context = format_references(references, max_chars=self.compressor.max_chars)

        # 3. 构建提示
        if system_prompt:
            system_content = system_prompt.strip()
        else:
            system_content = ASSISTANT_SYSTEM_DEFAULT

        # 根据 intent 构建不同的 RAG 提示
        if intent == "summary":
            rag_prompt = f"""根据下面提供的参考字幕片段，对视频内容进行总结概括。
要求：
- 提炼核心知识点和要点，给出结构化大纲
- 标注关键内容对应的时间点（秒）
- 如果参考片段不足以完整总结，说明缺少什么部分

参考字幕片段：
{context}
"""
        else:
            rag_prompt = f"""根据下面提供的参考字幕片段回答用户的学习问题。
要求：
- 只根据参考片段回答，不要编造没有依据的视频内容
- 推荐课程或片段时，要写出视频标题和时间点（秒）
- 如果参考片段不足以回答，要说明缺少什么
- 回答要简洁、具体、可执行

参考字幕片段：
{context}
"""

        if page_context:
            rag_prompt += f"""
当前页面上下文：
{page_context[:4000]}
"""

        # 4. 构建消息列表
        messages: list[BaseMessage] = [SystemMessage(content=system_content)]

        # 加载历史消息（如果有 session_id）
        if session_id:
            history = load_session_history(session_id, max_turns=10)
            messages.extend(history)

        messages.append(HumanMessage(content=f"{rag_prompt}\n\n用户问题：{query}"))

        # 5. 调用 LLM
        provider, config = _resolve_provider()
        if not config.get("base_url") or not config.get("model"):
            raise RuntimeError(
                "LLM 未配置：请在设置中配置 Base URL 和模型名称。"
                f"(provider={provider}, base_url='{config.get('base_url', '')}', model='{config.get('model', '')}')"
            )

        try:
            llm = create_llm(provider, config)
        except Exception as exc:
            raise RuntimeError(f"创建 LLM 实例失败（provider={provider}）: {exc}") from exc

        try:
            response = llm.invoke(messages)
            answer = response.content.strip()
        except Exception as exc:
            error_str = str(exc)
            raise RuntimeError(
                f"LLM 调用失败 (provider={provider}, base_url={config.get('base_url', '')}): {error_str[:500]}"
            ) from exc

        # 6. 存储消息（如果有 session_id）
        if session_id:
            store_message(session_id, "user", query, references=references)
            store_message(session_id, "assistant", answer, references=references)

        mode = "openai" if provider in ("openai",) else provider
        return answer, references, mode


def format_references(references: list[dict], max_chars: int = 6000) -> str:
    """将参考结果格式化为上下文字符串。

    Args:
        references: 参考结果列表
        max_chars: 最大字符数限制
    """
    if not references:
        return "（未找到相关字幕片段）"

    lines = []
    total = 0
    for idx, ref in enumerate(references, start=1):
        entry = (
            f"{idx}. 视频: {ref.get('video_title', '未知')}\n"
            f"   时间: {int(ref.get('start_sec', 0))}s - {int(ref.get('end_sec', 0))}s\n"
            f"   字幕: {ref.get('text', '')}"
        )
        if total + len(entry) > max_chars:
            lines.append(f"...（还有 {len(references) - idx + 1} 条结果因长度限制省略）")
            break
        lines.append(entry)
        total += len(entry)
    return "\n".join(lines)


def create_rag_chain(
    fts_weight: float = 0.5,
    vec_weight: float = 0.5,
    default_limit: int = 6,
    enable_query_expansion: bool = True,
    enable_reranker: bool | None = None,
    min_score: float | None = None,
    max_chars: int = 6000,
) -> RAGChain:
    """创建 RAG Chain 实例。"""
    return RAGChain(
        fts_weight=fts_weight,
        vec_weight=vec_weight,
        default_limit=default_limit,
        enable_query_expansion=enable_query_expansion,
        enable_reranker=enable_reranker,
        min_score=min_score,
        max_chars=max_chars,
    )
