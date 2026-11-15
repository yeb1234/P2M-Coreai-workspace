"""专用 reranker 客户端（cross-encoder，走硅基流动 API）。

为什么换掉原来的 LLM listwise
----------------------------
原来是把 20 个候选拼进 prompt 让 LLM 排序，两个硬伤：
- 慢：实测 5 秒，因为它要先生成几百字再排序
- 不稳：概率性输出，同一条查询两次结果可能不同。实测「今天天气怎么样」
  偶尔还是会返回 3 条无关内容

cross-encoder 直接算 query-doc 的匹配分，不生成文本：
- 快：20 个候选约 100-300ms
- 确定性：同一输入同一输出
- **分数可以当绝对阈值用**：实测相关 0.99、无关 0.000016，差 6 万倍。
  这一点尤其重要 —— 向量检索的余弦分挤在 0.4-0.6，从来没法定阈值。

为什么用硅基流动而不是本地 LM Studio
----------------------------------
LM Studio 的 /v1/rerank 接口支持不好（模型能加载，但接口不暴露或不一致）。
硅基流动提供标准 /v1/rerank，模型是 BAAI/bge-reranker-v2-m3 ——
和库里 embedding 用的 bge-m3 同一家族，语义空间一致。

限流
----
免费版有 RPM 限制。这里的调用量很小（每次检索 1 次），
但批量评估脚本要自己控速。失败一律返回 None，由调用方 fallback 到 LLM 重排。
"""

from __future__ import annotations

import logging

import httpx

from app.database import settings

logger = logging.getLogger(__name__)


class RerankError(RuntimeError):
    pass


def rerank_available() -> bool:
    return bool(settings.rerank_api_key and settings.rerank_api_url and settings.rerank_model)


def rerank(
    query: str,
    documents: list[str],
    *,
    top_n: int | None = None,
    timeout_s: float = 12.0,
) -> list[tuple[int, float]] | None:
    """返回 [(原始下标, 相关性分数)]，按分数降序。

    失败返回 None —— 调用方应当 fallback 到 LLM 重排，而不是让检索挂掉。
    """
    if not rerank_available():
        return None
    if not documents:
        return []
    query = (query or "").strip()
    if not query:
        return None

    # 文档太长会浪费 token，cross-encoder 有效区间通常在 512 token 内
    payload_docs = [(d or "")[:1200] for d in documents]
    body = {
        "model": settings.rerank_model,
        "query": query,
        "documents": payload_docs,
        "top_n": min(top_n or len(payload_docs), len(payload_docs)),
        "return_documents": False,
    }

    try:
        with httpx.Client(timeout=timeout_s) as client:
            resp = client.post(
                settings.rerank_api_url,
                json=body,
                headers={
                    "Authorization": f"Bearer {settings.rerank_api_key}",
                    "Content-Type": "application/json",
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        # 429 是限流，401 是 key 失效，都值得单独说清楚
        status = exc.response.status_code if exc.response is not None else "?"
        logger.warning("rerank HTTP %s，回退到 LLM 重排", status)
        return None
    except Exception as exc:
        logger.warning("rerank 调用失败 (%s)，回退到 LLM 重排", type(exc).__name__)
        return None

    results = data.get("results")
    if not isinstance(results, list) or not results:
        logger.warning("rerank 返回结构异常: %s", str(data)[:120])
        return None

    parsed: list[tuple[int, float]] = []
    for item in results:
        try:
            index = int(item["index"])
            score = float(item["relevance_score"])
        except (KeyError, TypeError, ValueError):
            continue
        if 0 <= index < len(documents):
            parsed.append((index, score))

    if not parsed:
        return None
    parsed.sort(key=lambda pair: pair[1], reverse=True)
    return parsed
