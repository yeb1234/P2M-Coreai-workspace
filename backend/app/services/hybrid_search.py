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
from sqlalchemy import select

from app.utils.textclean import looks_like_promo
from app.database import engine, settings
from app.models import Category, Video
from app.tables import CONTENT_CHUNKS
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
    # 磁盘原始路径，只在后端内部流转；展示用 display_folder_path()
    # 必须放在所有无默认值的字段之后，否则 dataclass 构造会报
    # "non-default argument follows default argument"
    filepath: str | None = None

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
    """批量补齐片段元信息，避免逐条查询造成 N+1。

    注意：必须取的是检索表（content_chunks），不是字幕表。
    chunk 的 id 和 subtitle_segments 的 id 空间是重叠的（都从 1 开始），
    用 chunk id 去查字幕表不会报错，只会静默返回**另一个东西的文本** ——
    表现为「检索结果莫名其妙」，极难定位。这个坑实际踩过一次。
    """
    if not segment_ids:
        return {}

    # 表对象而不是字符串：写错表名会直接报错，
    # 不会出现「查了另一张表却正常返回」
    seg = CONTENT_CHUNKS
    video = Video.__table__
    category = Category.__table__

    stmt = (
        select(
            seg.c.id,
            seg.c.video_id,
            seg.c.start_sec,
            seg.c.end_sec,
            seg.c.text,
            video.c.title.label("video_title"),
            video.c.filepath.label("filepath"),
            video.c.category_id,
            category.c.name.label("category_name"),
        )
        .select_from(seg)
        .join(video, video.c.id == seg.c.video_id)
        .outerjoin(category, category.c.id == video.c.category_id)
        .where(seg.c.id.in_(segment_ids))
        # 排除零长度/负长度块：库里 190 条这种（分块时字幕时间轴异常产生），
        # 展示出来是一段文字配一个 0 秒的跳转目标，点了什么也没发生。
        .where(seg.c.end_sec > seg.c.start_sec)
    )
    with engine.connect() as conn:
        rows = conn.execute(stmt).fetchall()
    return {
        row.id: {
            "video_id": row.video_id,
            "start_sec": row.start_sec,
            "end_sec": row.end_sec,
            "text": row.text,
            "video_title": row.video_title,
            # 磁盘原始路径只在后端内部流转，给前端的是清洗后的层级（见 chat_agent）
            "filepath": row.filepath,
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

        if len(ids) == 0:
            # 模型明确表示「候选都不相关」时，要尊重这个负判断。
            # 原实现把空数组也当成「没给出有效结果」，跟着 fallback 返回原序 ——
            # 等于把模型唯一能说「没有」的机会吞掉了。
            # 这是「红烧肉怎么做」会返回三条无关内容的直接原因。
            logger.info("重排判定全部不相关，返回空结果: %s", query[:40])
            return []

        reranked: list[Hit] = []
        seen: set[int] = set()
        for raw_index in ids:
            if not isinstance(raw_index, int) or not (0 <= raw_index < len(candidates)):
                continue
            hit = candidates[raw_index]
            if hit.segment_id in seen:
                continue
            seen.add(hit.segment_id)
            reranked.append(hit)
        if not reranked:
            return candidates[:keep]

        result = reranked[:keep]
        # rerank_score 统一成「0-1，越大越相关」，和交叉编码器分支同一语义。
        #
        # 原来是 float(len(reranked))，也就是 0/1/2/3… 这个下标 ——
        # 第 1 名得 0 分、第 3 名得 2 分，越小越相关，和另一边
        # （round(score, 4)，越大越相关）完全相反，却共用同一个字段名。
        # 前端/agent 拿到这个值没法判断方向，只能当黑盒。
        #
        # LLM listwise 重排只给顺序不给绝对分，所以按返回条数线性归一化：
        # 6 条 → 1.0 / 0.833 / 0.667 / 0.5 / 0.333 / 0.167。
        total = len(result)
        for rank, hit in enumerate(result):
            hit.rerank_score = round((total - rank) / total, 4)
        return result
    except Exception as exc:
        logger.warning("LLM 重排失败，保留 RRF 原序: %s", exc)
        return candidates[:keep]


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


def _api_rerank(query: str, hits: list[Hit], keep: int) -> list[Hit] | None:
    """专用 cross-encoder 重排。

    返回值的语义必须区分清楚，这是之前踩过的坑：
      None  -> 调用失败（无 key / 限流 / 超时），调用方应 fallback 到 LLM 重排
      []    -> 全部低于阈值，**模型明确认为都不相关**，要尊重，直接返回空结果
      [...] -> 正常排序结果

    把 None 和 [] 混为一谈，就会出现「模型说没有、代码却硬凑三条」的问题。
    """
    from app.services.rerank_client import rerank

    pool = hits[: settings.rerank_top_n]
    if not pool:
        return None

    ranked = rerank(query, [h.text for h in pool], top_n=len(pool))
    if ranked is None:
        return None

    out: list[Hit] = []
    for index, score in ranked:
        if index >= len(pool):
            continue
        hit = pool[index]
        if score < settings.rerank_min_score:
            continue
        hit.rerank_score = round(score, 4)
        out.append(hit)
        if len(out) >= keep:
            break
    return out


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
            filepath=row.get("filepath"),
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
            filepath=meta.get("filepath"),
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
        # 整块都是推广内容（微信/资源站/要资料）的直接不要。
        # 这类块在音乐类和搬运课程里很常见，命中后既讲不了内容，
        # 又占掉 top_k 名额。
        if looks_like_promo(hit.text):
            continue
        candidates.append(hit)

    # 去重放在 rerank 之前：候选更干净，重排更准也更快。
    # 保留 top_k 的 4 倍余量，避免去重后不够数
    candidates = dedupe_overlapping(candidates, max_per_video=2)
    if len(candidates) > top_k * 4:
        candidates = candidates[: top_k * 4]

    rerank_mode: str | None = None
    should_rerank = settings.rerank_enabled if use_rerank is None else use_rerank
    if should_rerank and candidates:
        started = time.perf_counter()
        api_result = _api_rerank(query, candidates, keep=top_k)
        if api_result is None:
            # 专用 reranker 不可用（没配 key / 被限流 / 超时），退回 LLM listwise。
            # 退回路径慢 10 倍且不稳，但比没有重排好。
            rerank_mode = "llm_fallback"
            final = _llm_rerank(query, candidates, keep=top_k)
        else:
            rerank_mode = "cross_encoder"
            final = api_result
        timings["rerank_ms"] = round((time.perf_counter() - started) * 1000, 1)
    else:
        final = candidates[:top_k]

    # 块本身就是 565 字的完整上下文，不需要再扩展。
    # 反过来，在块上做时间窗扩展会把相邻块拼进来，制造冗余。
    #
    # 碎片模式（在 subtitle_segments 上按时间窗拼段落）已随
    # segment_embeddings 一起删除 —— 它解决的是「9 个字一条」的问题，
    # 而检索单位已经不是碎片了。
    final = dedupe_overlapping(final, max_per_video=2, overlap_ratio=0.3)

    # rerank_mode 不能放进 timings —— 那里是 dict[str, float]，
    # 塞字符串会让 Pydantic 校验失败，整个检索 500。踩过。
    return {"hits": final, "timings": timings, "degraded": degraded, "rerank_mode": rerank_mode}
