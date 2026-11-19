"""Reranker service: 使用 bge-reranker 模型对检索结果重排序。

通过 LM Studio 的 OpenAI-compatible API 调用 reranker 模型。
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import requests

from app.database import settings
from app.services.admin_settings import load_assistant_runtime_settings

logger = logging.getLogger(__name__)

DEFAULT_RERANKER_MODEL = "bge-reranker-v2-m3"


def _get_reranker_config() -> dict:
    """获取 reranker 配置。

    优先读环境变量，便于在不重启代码的情况下切换本地/托管 reranker；
    未配置时回退到 embedding 的 base_url 和 LM Studio 默认模型。
    """
    from app.services.embedding import _get_embedding_base_url

    base_url = (os.getenv("RERANK_API_URL") or _get_embedding_base_url()).strip()
    model = (os.getenv("RERANK_MODEL") or DEFAULT_RERANKER_MODEL).strip()
    api_key = os.getenv("RERANK_API_KEY") or settings.openai_api_key or "lm-studio"
    return {
        "base_url": base_url,
        "api_key": api_key,
        "model": model,
    }


def rerank_documents(
    query: str,
    documents: list[dict],
    top_k: int = 6,
    model: str | None = None,
    base_url: str | None = None,
    api_key: str | None = None,
    timeout_s: int = 30,
) -> list[dict]:
    """使用 reranker 模型对文档重排序。

    Args:
        query: 用户查询
        documents: 待重排的文档列表，每个 dict 需有 "text" 字段
        top_k: 返回前 k 个结果
        model: reranker 模型名（默认 bge-reranker-v2-m3）
        base_url: API base URL
        api_key: API key
        timeout_s: 请求超时秒数

    Returns:
        重排序后的文档列表（前 top_k 个），带 rerank_score 字段
    """
    if not documents:
        return []

    if len(documents) == 1:
        docs = [documents[0].copy()]
        docs[0]["rerank_score"] = 1.0
        return docs

    config = _get_reranker_config()
    url = (base_url or config["base_url"]).rstrip("/")
    if not url.endswith("/rerank"):
        url += "/rerank"
    key = api_key or config["api_key"]
    mdl = model or config["model"]

    # 构建 reranker 请求体（Cohere rerank API 格式，LM Studio 支持）
    doc_texts = [doc.get("text", "") for doc in documents]

    try:
        response = requests.post(
            url,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {key}",
            },
            json={
                "model": mdl,
                "query": query,
                "documents": doc_texts,
                "top_n": top_k,
                "return_documents": False,
            },
            timeout=timeout_s,
        )

        if response.status_code == 200:
            try:
                data = response.json()
            except Exception as exc:
                logger.warning("Reranker returned non-JSON payload: %s", exc)
                return _fallback_rerank(query, documents, top_k)

            results = data.get("results")
            if not isinstance(results, list) or not results:
                # LM Studio 对未知端点会返回 HTTP 200 + {"error": "..."}，
                # 这不是有效重排结果；不能把它当成 0 条命中。
                logger.warning(
                    "Reranker response has no results, falling back: %s",
                    str(data)[:200],
                )
                return _fallback_rerank(query, documents, top_k)

            reranked = []
            for item in results:
                idx = item.get("index", 0)
                score = item.get("relevance_score", 0.0)
                if 0 <= idx < len(documents):
                    doc = documents[idx].copy()
                    doc["rerank_score"] = round(float(score), 4)
                    reranked.append(doc)
            if not reranked:
                logger.warning("Reranker results had no valid indexes, falling back")
                return _fallback_rerank(query, documents, top_k)
            return reranked[:top_k]

        # 如果 /rerank 端点不可用，降级到 chat completion 模拟
        logger.warning(
            "Reranker API returned %d, falling back to chat-based reranking",
            response.status_code,
        )
        return _rerank_via_chat(query, documents, top_k, mdl, config["base_url"], key, timeout_s)

    except requests.exceptions.ConnectionError:
        logger.warning("Reranker model not available, returning original order")
        return _fallback_rerank(query, documents, top_k)
    except Exception as exc:
        logger.warning("Reranker failed: %s, falling back to keyword rerank", exc)
        return _fallback_rerank(query, documents, top_k)


def _rerank_via_chat(
    query: str,
    documents: list[dict],
    top_k: int,
    model: str,
    base_url: str,
    api_key: str,
    timeout_s: int,
) -> list[dict]:
    """通过 chat completion 模拟 reranking（降级方案）。

    将 query + 所有文档拼成 prompt，让 LLM 输出排序后的索引。
    """
    # 构建文档列表文本
    doc_list = ""
    for i, doc in enumerate(documents):
        text = doc.get("text", "")[:200]  # 截断避免 token 过长
        doc_list += f"[{i}] {text}\n"

    prompt = f"""请根据与查询的相关性，对以下文档进行排序。
查询: {query}

文档列表:
{doc_list}

请返回 JSON 数组，包含排序后的文档索引（从最相关到最不相关），最多返回 {top_k} 个。
只返回 JSON 数组，不要其他内容。例如: [3, 0, 1, 2]"""

    try:
        url = base_url.rstrip("/") + "/chat/completions"
        response = requests.post(
            url,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.0,
                "max_tokens": 200,
            },
            timeout=timeout_s,
        )

        if response.status_code == 200:
            data = response.json()
            content = data["choices"][0]["message"]["content"].strip()
            # 提取 JSON 数组
            import re
            match = re.search(r'\[[\d\s,]+\]', content)
            if match:
                indices = json.loads(match.group())
                reranked = []
                for idx in indices:
                    if 0 <= idx < len(documents):
                        doc = documents[idx].copy()
                        doc["rerank_score"] = 1.0 - (len(reranked) * 0.1)
                        reranked.append(doc)
                return reranked[:top_k]
    except Exception as exc:
        logger.warning("Chat-based reranking failed: %s", exc)

    return _fallback_rerank(query, documents, top_k)


def _fallback_rerank(
    query: str,
    documents: list[dict],
    top_k: int,
) -> list[dict]:
    """降级方案：基于关键词覆盖率的轻量重排序。

    中文没有空格分词，不能直接 query.split()；这里对中文片段生成 2-4 字
    n-gram，避免“闭包是什么”整串去匹配字幕导致 coverage 恒为 0。
    """
    def query_terms(text: str) -> set[str]:
        lowered = text.lower()
        terms: set[str] = set(re.findall(r"[a-z0-9_]+", lowered))
        for segment in re.findall(r"[\u4e00-\u9fff]+", lowered):
            if len(segment) <= 6:
                terms.add(segment)
            for size in (2, 3, 4):
                for index in range(max(0, len(segment) - size + 1)):
                    terms.add(segment[index:index + size])
        return terms

    keywords = query_terms(query)
    scored = []
    for doc in documents:
        text_lower = doc.get("text", "").lower()
        coverage = (
            sum(1 for kw in keywords if kw in text_lower) / max(len(keywords), 1)
            if keywords else 0.0
        )
        original_score = doc.get("score_hint", 0.0)
        doc_copy = doc.copy()
        doc_copy["rerank_score"] = round(original_score * 0.6 + coverage * 0.4, 4)
        scored.append(doc_copy)

    scored.sort(key=lambda x: x["rerank_score"], reverse=True)
    return scored[:top_k]


def is_reranker_available() -> bool:
    """检测 reranker 模型是否可用。"""
    config = _get_reranker_config()
    try:
        url = config["base_url"].rstrip("/")
        if not url.endswith("/rerank"):
            url += "/rerank"
        response = requests.post(
            url,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {config['api_key']}",
            },
            json={
                "model": config["model"],
                "query": "test",
                "documents": ["test document"],
                "top_n": 1,
            },
            timeout=10,
        )
        return response.status_code == 200
    except Exception:
        return False
