"""混合检索：词法（pg_trgm）+ 语义（pgvector HNSW）+ RRF 融合 + LLM 重排。

为什么需要混合：
- 纯词法：技术术语精确（Depends/useEffect 命中快），但自然语言长句会被
  长文本稀释——实测「FastAPI 依赖注入是怎么实现的」前四条全是
  "from fastapi" 这类碎片
- 纯语义：能跨表述召回（问「函数返回另一个函数」也能找到闭包），
  但对生僻 API 名、版本号这类字面量不敏感
两条路各取所长，用 RRF 按排名融合，再做一次 LLM 重排精排。
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np
from sqlalchemy import text

from app.database import engine, settings
from app.services.embeddings import EmbeddingError, get_embedding_client
from app.services.lexical import lexical_search
from app.services.llm import build_chat_model
from app.services.vector_store import VectorStoreError, search as vector_search

logger = logging.getLogger(__name__)

RRF_K = 60


@dataclass
class Hit:
    segment_id: int
    video_id: int
    video_title: str
    category_id: int | None
    start_sec: float
    end_sec: float
    text: str
    score: float = 0.0
    lexical_score: float | None = None
    vector_score: float | None = None
    lexical_rank: int | None = None
    vector_rank: int | None = None
    rerank_score: float | None = None
    sources: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "segment_id": self.segment_id,
            "video_id": self.video_id,
            "video_title": self.video_title,
            "category_id": self.category_id,
            "start_sec": self.start_sec,
            "end_sec": self.end_sec,
            "text": self.text,
            "score": round(self.score, 6),
            "lexical_score": self.lexical_score,
            "vector_score": self.vector_score,
            "lexical_rank": self.lexical_rank,
            "vector_rank": self.vector_rank,
            "rerank_score": self.rerank_score,
            "sources": self.sources,
        }


def fetch_segments(segment_ids: list[int]) -> dict[int, dict]:
    """批量补齐片段元信息，避免逐条查询造成 N+1。"""
    if not segment_ids:
        return {}
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT s.id, s.video_id, s.start_sec, s.end_sec, s.text,
                       v.title AS video_title, v.category_id,
                       c.name AS category_name
                FROM subtitle_segments s
                JOIN videos v ON v.id = s.video_id
                LEFT JOIN categories c ON c.id = v.category_id
                WHERE s.id = ANY(:ids)
                """
            ),
            {"ids": list(segment_ids)},
        ).fetchall()
    return {
        row.id: {
            "video_id": row.video_id,
            "start_sec": row.start_sec,
            "end_sec": row.end_sec,
            "text": row.text,
            "video_title": row.video_title,
            "category_id": row.category_id,
            "category_name": row.category_name,
        }
        for row in rows
    }


def rrf_fuse(
    rankings: dict[str, list[int]],
    weights: dict[str, float] | None = None,
    k: int = RRF_K,
) -> dict[int, float]:
    """Reciprocal Rank Fusion。rankings = {来源: 有序 segment_id 列表}

    加权版：语义检索在跨表述召回上更可靠（实测「函数返回另一个函数」能召回
    闭包内容），词法擅长精确术语但容易被短碎片干扰，因此默认给向量更高权重。
    """
    weights = weights or {}
    scores: dict[int, float] = defaultdict(float)
    for source, ids in rankings.items():
        weight = weights.get(source, 1.0)
        for rank, segment_id in enumerate(ids, start=1):
            scores[segment_id] += weight / (k + rank)
    return dict(scores)


class _RerankChoice(list):
    """with_structured_output 的返回容器，避免额外依赖 pydantic 模型定义。"""


def _llm_rerank(query: str, hits: list[Hit], keep: int) -> list[Hit]:
    """用外部 LLM 做 listwise 重排。

    失败或超时一律返回原序，绝不因为重排失败让整个检索挂掉。
    """
    if len(hits) <= 1:
        return hits[:keep]

    candidates = hits[: settings.rerank_top_n]
    lines = []
    for index, hit in enumerate(candidates):
        snippet = (hit.text or "").replace("\n", " ")[:180]
        lines.append(f"[{index}] {hit.video_title} @{int(hit.start_sec)}s :: {snippet}")

    prompt = (
        "你是学习资料检索的排序器。根据用户问题，从候选视频片段中选出最相关的若干条。\n"
        "只按内容相关性判断，不要因为标题相似就给高分。若都不相关则返回空数组。\n\n"
        f"用户问题：{query}\n\n候选片段：\n" + "\n".join(lines) + "\n\n"
        f'以 JSON 返回：{{"ids": [最相关的编号，最多 {keep} 个，按相关性降序]}}'
    )

    try:
        # 重排是锦上添花，超时（8s）就放弃，不能拖死整个检索
        model = build_chat_model("external", temperature=0.0, max_tokens=200, timeout_s=8)
        result = model.with_structured_output(
            {
                "title": "rerank",
                "type": "object",
                "properties": {"ids": {"type": "array", "items": {"type": "integer"}}},
                "required": ["ids"],
            }
        ).invoke(prompt)
        ids = result.get("ids") if isinstance(result, dict) else getattr(result, "ids", None)
        if not isinstance(ids, list):
            return candidates[:keep]

        reranked: list[Hit] = []
        seen: set[int] = set()
        for raw_index in ids:
            if not isinstance(raw_index, int) or not (0 <= raw_index < len(candidates)):
                continue
            hit = candidates[raw_index]
            if hit.segment_id in seen:
                continue
            seen.add(hit.segment_id)
            hit.rerank_score = float(len(reranked))
            reranked.append(hit)
        if not reranked:
            return candidates[:keep]
        return reranked[:keep]
    except Exception as exc:
        logger.warning("LLM 重排失败，保留 RRF 原序: %s", exc)
        return candidates[:keep]


def hybrid_search(
    query: str,
    *,
    top_k: int = 8,
    candidate_k: int = 30,
    category_ids: list[int] | None = None,
    video_ids: list[int] | None = None,
    use_rerank: bool | None = None,
    min_vector_score: float = 0.0,
) -> dict:
    """返回 {hits, timings, degraded}。任一通路失败都会降级而非报错。"""
    query = (query or "").strip()
    if not query:
        return {"hits": [], "timings": {}, "degraded": []}

    import time

    timings: dict[str, float] = {}
    degraded: list[str] = []

    started = time.perf_counter()
    lexical_rows = lexical_search(
        query, limit=candidate_k, category_ids=category_ids, video_ids=video_ids
    )
    timings["lexical_ms"] = round((time.perf_counter() - started) * 1000, 1)

    vector_rows: list = []
    started = time.perf_counter()
    try:
        client = get_embedding_client()
        query_vector = np.asarray(client.embed([query])[0], dtype=np.float32)
        timings["embed_ms"] = round((time.perf_counter() - started) * 1000, 1)
        started = time.perf_counter()
        vector_rows = vector_search(
            query_vector,
            top_k=candidate_k,
            category_ids=category_ids,
            video_ids=video_ids,
        )
        timings["vector_ms"] = round((time.perf_counter() - started) * 1000, 1)
    except (EmbeddingError, VectorStoreError) as exc:
        logger.warning("语义检索不可用，降级为纯词法: %s", exc)
        degraded.append("vector")
        timings["embed_ms"] = round((time.perf_counter() - started) * 1000, 1)

    # 组装候选池
    pool: dict[int, Hit] = {}
    for row in lexical_rows:
        pool[row["segment_id"]] = Hit(
            segment_id=row["segment_id"],
            video_id=row["video_id"],
            video_title=row["video_title"],
            category_id=row.get("category_id"),
            start_sec=row["start_sec"],
            end_sec=row["end_sec"],
            text=row["text"],
            lexical_score=round(float(row.get("lexical_score") or 0.0), 4),
            sources=["lexical"],
        )

    missing_ids = [row.segment_id for row in vector_rows if row.segment_id not in pool]
    details = fetch_segments(missing_ids)
    for row in vector_rows:
        if row.segment_id in pool:
            pool[row.segment_id].vector_score = round(row.score, 4)
            if "vector" not in pool[row.segment_id].sources:
                pool[row.segment_id].sources.append("vector")
            continue
        meta = details.get(row.segment_id)
        if not meta:
            continue
        pool[row.segment_id] = Hit(
            segment_id=row.segment_id,
            video_id=meta["video_id"],
            video_title=meta["video_title"],
            category_id=meta["category_id"],
            start_sec=meta["start_sec"],
            end_sec=meta["end_sec"],
            text=meta["text"],
            vector_score=round(row.score, 4),
            sources=["vector"],
        )

    # 过滤掉低相似度向量命中（未建索引时可能混入无关片段）
    if min_vector_score > 0:
        pool = {
            sid: hit
            for sid, hit in pool.items()
            if (hit.vector_score or 0) >= min_vector_score or "lexical" in hit.sources
        }

    if not pool:
        return {"hits": [], "timings": timings, "degraded": degraded + ["empty"]}

    rankings: dict[str, list[int]] = {
        "lexical": [row["segment_id"] for row in lexical_rows if row["segment_id"] in pool],
        "vector": [row.segment_id for row in vector_rows if row.segment_id in pool],
    }
    fused = rrf_fuse(rankings, weights={"lexical": 0.8, "vector": 1.2})

    for source, ids in rankings.items():
        for rank, segment_id in enumerate(ids, start=1):
            if segment_id in pool:
                if source == "lexical":
                    pool[segment_id].lexical_rank = rank
                else:
                    pool[segment_id].vector_rank = rank

    ordered = sorted(fused.items(), key=lambda item: item[1], reverse=True)
    candidates = []
    for segment_id, score in ordered:
        hit = pool[segment_id]
        hit.score = score
        candidates.append(hit)

    should_rerank = settings.rerank_enabled if use_rerank is None else use_rerank
    if should_rerank and candidates:
        started = time.perf_counter()
        final = _llm_rerank(query, candidates, keep=top_k)
        timings["rerank_ms"] = round((time.perf_counter() - started) * 1000, 1)
    else:
        final = candidates[:top_k]

    return {"hits": final, "timings": timings, "degraded": degraded}
