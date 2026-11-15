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
    # 扩展上下文后：text 是合并出的段落，raw_text 保留命中的原始字幕
    raw_text: str | None = None
    segment_count: int = 1

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
            "raw_text": self.raw_text,
            "segment_count": self.segment_count,
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


def expand_hit_context(
    hits: list["Hit"],
    *,
    window_sec: float = 45.0,
    max_chars: int = 700,
) -> list["Hit"]:
    """把命中的碎片字幕扩展成连续段落。

    为什么必须做
    ------------
    字幕是逐句存的，实测 359 万条、平均 9 个字、中位数 8 个字。
    一条命中的原文可能是「那我们就来看一下」，单独拿出来没有任何信息量，
    模型既判断不了相关性，也没法据此回答。

    这里按时间窗把前后片段拼起来：命中点前后各 window_sec 秒，
    拼成一段完整的讲解再返回。时间戳同步扩展，前端跳转仍然准确。

    为什么不改索引：扩上下文只影响「返回什么」，不影响「怎么找」。
    能在不重建向量的前提下立刻改善输出质量。
    真正的根治是语义分块（见 scripts/build_content_chunks.py），
    但那要重跑一遍向量回填，适合放到独立批次做。
    """
    if not hits:
        return hits

    min_start = min(h.start_sec for h in hits) - window_sec
    max_end = max(h.end_sec for h in hits) + window_sec
    video_ids = list({h.video_id for h in hits})

    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    """
                    SELECT video_id, start_sec, end_sec, text
                    FROM subtitle_segments
                    WHERE video_id = ANY(:vids)
                      AND start_sec >= :lo
                      AND start_sec <= :hi
                    ORDER BY video_id, start_sec
                    """
                ),
                {"vids": video_ids, "lo": min_start, "hi": max_end},
            ).fetchall()
    except Exception as exc:
        logger.warning("上下文扩展失败，返回原始片段: %s", exc)
        return hits

    by_video: dict[int, list] = defaultdict(list)
    for row in rows:
        by_video[row.video_id].append(row)

    for hit in hits:
        timeline = by_video.get(hit.video_id) or []
        if not timeline:
            continue
        lo = hit.start_sec - window_sec
        hi = hit.end_sec + window_sec
        window = [r for r in timeline if lo <= r.start_sec <= hi]
        if not window:
            continue

        merged: list[str] = []
        total = 0
        for row in window:
            piece = (row.text or "").strip()
            if not piece:
                continue
            if total + len(piece) > max_chars:
                break
            merged.append(piece)
            total += len(piece)

        if not merged:
            continue

        hit.raw_text = hit.text
        hit.text = "".join(merged)
        hit.start_sec = window[0].start_sec
        hit.end_sec = window[-1].end_sec
        hit.segment_count = len(window)

    return hits


def dedupe_overlapping(
    hits: list["Hit"],
    *,
    max_per_video: int = 2,
    overlap_ratio: float = 0.5,
) -> list["Hit"]:
    """去掉同一视频里时间重叠的命中。

    为什么必须做
    ------------
    碎片检索的典型病症：top_k 里 3 条来自同一个视频的相邻 90 秒，
    时间戳几乎重合、内容互相复述。用户看到的是「三条一样的答案」，
    而真正有用的其它视频被挤掉了。

    实测「FastAPI 依赖注入」的前三条全部落在同一个视频的
    2218s–2318s 区间，就是这个问题。

    规则：同一视频内，与已保留项时间重叠超过 overlap_ratio 的丢弃；
    同一视频最多保留 max_per_video 条，保证结果多样性。
    """
    kept: list[Hit] = []
    per_video: dict[int, int] = defaultdict(int)

    for hit in hits:
        if per_video[hit.video_id] >= max_per_video:
            continue

        span = max(1e-6, hit.end_sec - hit.start_sec)
        duplicated = False
        for other in kept:
            if other.video_id != hit.video_id:
                continue
            lo = max(other.start_sec, hit.start_sec)
            hi = min(other.end_sec, hit.end_sec)
            if hi <= lo:
                continue
            shorter = min(span, max(1e-6, other.end_sec - other.start_sec))
            if (hi - lo) / shorter >= overlap_ratio:
                duplicated = True
                break

        if not duplicated:
            kept.append(hit)
            per_video[hit.video_id] += 1

    return kept


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

    # 去重放在 rerank 之前：候选更干净，重排更准也更快。
    # 保留 top_k 的 4 倍余量，避免去重后不够数
    candidates = dedupe_overlapping(candidates, max_per_video=2)
    if len(candidates) > top_k * 4:
        candidates = candidates[: top_k * 4]

    should_rerank = settings.rerank_enabled if use_rerank is None else use_rerank
    if should_rerank and candidates:
        started = time.perf_counter()
        final = _llm_rerank(query, candidates, keep=top_k)
        timings["rerank_ms"] = round((time.perf_counter() - started) * 1000, 1)
    else:
        final = candidates[:top_k]

    # 命中的是 9 个字的碎片，直接给模型没有意义。
    # 按时间窗拼成段落再返回，时间戳同步扩展（前端跳转仍准）。
    final = expand_hit_context(final)

    # 扩展之后必须再去一次重。
    # 去重放在扩展前是不够的：单条字幕只有 2 秒，时间上不重叠，
    # 但扩展成 90 秒的段落后，相邻命中会大面积重合 ——
    # 用户看到的就是「三条一样的答案」。
    final = dedupe_overlapping(final, max_per_video=2)

    return {"hits": final, "timings": timings, "degraded": degraded}
