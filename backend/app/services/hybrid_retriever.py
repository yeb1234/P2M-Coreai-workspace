"""Hybrid retriever combining FTS5 keyword search and sqlite-vec vector search.

Implements LangChain BaseRetriever interface for seamless integration with LCEL chains.
Supports query expansion, reranking, and intent-aware retrieval.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any

from langchain_core.callbacks import CallbackManagerForRetrieverRun
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from pydantic import ConfigDict
from sqlalchemy import and_, desc, or_, text

from app.database import SessionLocal
from app.models import SubtitleSegment, Video
from app.services.embedding import generate_embedding
from app.services.query_enhancer import SYNONYM_MAP, expand_query, extract_keywords
from app.services.reranker import rerank_documents
from app.services.vector_store import count_embeddings, search_similar, _load_vec

logger = logging.getLogger(__name__)


def strip_search_intent(query: str) -> str:
    """去除常见搜索意图词，如'搜Python' -> 'Python'。"""
    import re
    cleaned = re.sub(
        r'^(搜[索找]?|找[到出]?|查[询找]?|检索|帮我[搜查找]|查找|搜索|关于|有没有|看看?有没有|给我?[找找]?)\s*',
        '',
        query.strip(),
        flags=re.IGNORECASE,
    )
    return cleaned.strip() or query.strip()


def _build_reference(segment: SubtitleSegment, video: Video, score_hint: float) -> dict:
    """构建标准的参考结果字典，并补前后相邻字幕作为上下文。

    2.94 的字幕段是按 ASR 行切的，命中“依赖注入”时可能只有这一行四个字；
    只把这几个字交给 LLM，答案必然空。这里取同一视频前后各五条字幕，
    让引用片段至少包含一段完整讲解。
    """
    text = segment.text
    start_sec = segment.start_sec
    end_sec = segment.end_sec
    try:
        db = SessionLocal()
        try:
            previous = (
                db.query(SubtitleSegment)
                .filter(
                    SubtitleSegment.video_id == segment.video_id,
                    SubtitleSegment.segment_index < segment.segment_index,
                )
                .order_by(SubtitleSegment.segment_index.desc())
                .limit(5)
                .all()
            )
            following = (
                db.query(SubtitleSegment)
                .filter(
                    SubtitleSegment.video_id == segment.video_id,
                    SubtitleSegment.segment_index > segment.segment_index,
                )
                .order_by(SubtitleSegment.segment_index.asc())
                .limit(5)
                .all()
            )
            neighbors = list(reversed(previous)) + [segment] + following
            joined = " ".join(
                item.text.strip()
                for item in neighbors
                if item.text and item.text.strip()
            )
            if joined:
                text = joined
                start_sec = neighbors[0].start_sec
                end_sec = neighbors[-1].end_sec
        finally:
            db.close()
    except Exception:
        pass
    return {
        "video_id": video.id,
        "video_title": video.title,
        "start_sec": start_sec,
        "end_sec": end_sec,
        "text": text,
        "score_hint": score_hint,
        "segment_id": segment.id,
    }


class FTSRetriever:
    """FTS5 关键字检索器。"""

    def search(
        self,
        query: str,
        video_id: int | None = None,
        limit: int = 10,
        keywords: list[str] | None = None,
    ) -> list[dict]:
        """执行 FTS5 搜索。"""
        if keywords is None:
            cleaned = strip_search_intent(query)
            keywords = [item.strip().lower() for item in cleaned.split() if item.strip()]
            if not keywords:
                keywords = [cleaned.strip().lower()]

        db = SessionLocal()
        try:
            # Tier 1: FTS5 MATCH
            try:
                # 用分词后的关键词做 OR 查询，避免把“依赖注入怎么实现”
                # 整段中文当成一个 FTS token。
                match_terms = [kw for kw in (keywords or []) if kw]
                fts_query = " OR ".join(f'"{term}"' for term in match_terms) or query.strip()
                fts_sql = """
                    SELECT s.id, s.video_id, s.segment_index, s.start_sec, s.end_sec, s.text,
                           v.id AS v_id, v.title AS v_title
                    FROM subtitle_segments_fts f
                    JOIN subtitle_segments s ON s.id = f.rowid
                    JOIN videos v ON v.id = s.video_id
                    WHERE subtitle_segments_fts MATCH :query_text
                """
                params: dict[str, Any] = {"query_text": fts_query, "limit": limit * 8}
                if video_id:
                    fts_sql += " AND s.video_id = :video_id"
                    params["video_id"] = video_id
                fts_sql += " ORDER BY bm25(subtitle_segments_fts) LIMIT :limit"
                fts_rows = db.execute(text(fts_sql), params).fetchall()
            except Exception as exc:
                logger.debug("FTS query failed, using LIKE fallback: %s", exc)
                fts_rows = []

            fts_candidates: list[dict] = []
            if fts_rows:
                grouped_best: dict[tuple[int, float], float] = defaultdict(float)
                for row in fts_rows:
                    text_lower = (row.text or "").lower()
                    score_hint = sum(1 for kw in keywords if kw in text_lower) or 0.5
                    if score_hint <= grouped_best[(row.video_id, row.start_sec)]:
                        continue
                    grouped_best[(row.video_id, row.start_sec)] = score_hint
                    segment_obj = (
                        db.query(SubtitleSegment)
                        .filter(SubtitleSegment.id == row.id)
                        .first()
                    )
                    video_obj = (
                        db.query(Video)
                        .filter(Video.id == row.video_id)
                        .first()
                    )
                    if segment_obj and video_obj:
                        fts_candidates.append(
                            _build_reference(segment_obj, video_obj, float(score_hint))
                        )
                    else:
                        fts_candidates.append({
                            "video_id": row.video_id,
                            "video_title": row.v_title,
                            "start_sec": row.start_sec,
                            "end_sec": row.end_sec,
                            "text": row.text,
                            "score_hint": float(score_hint),
                            "segment_id": row.id,
                        })
                fts_candidates.sort(key=lambda item: item["score_hint"], reverse=True)

            # FTS 命中但只是命中了 Python/JavaScript 这种高频词时，继续走
            # LIKE 精确匹配。3.59M 段全表 LIKE 不便宜，所以只在覆盖率不足
            # 或最高命中数 < 2 时触发。
            if (
                len(fts_candidates) >= limit
                and fts_candidates
                and fts_candidates[0]["score_hint"] >= 2.0
            ):
                return fts_candidates[:limit]

            filters = [SubtitleSegment.text.contains(kw) for kw in keywords if kw]
            query_stmt = db.query(SubtitleSegment, Video).join(Video, Video.id == SubtitleSegment.video_id)
            if video_id:
                query_stmt = query_stmt.filter(SubtitleSegment.video_id == video_id)
            # 先 AND（多词同段，精度高），没有命中再 OR。
            rows = (
                query_stmt.filter(and_(*filters)).limit(max(limit * 8, 120)).all()
                if filters
                else []
            )
            if not rows and filters:
                rows = query_stmt.filter(or_(*filters)).limit(max(limit * 100, 600)).all()

            like_candidates: list[dict] = []
            grouped_best = defaultdict(float)
            for segment, video in rows:
                text_lower = (segment.text or "").lower()
                score_hint = sum(1 for kw in keywords if kw in text_lower)
                if score_hint <= grouped_best[(video.id, segment.start_sec)]:
                    continue
                grouped_best[(video.id, segment.start_sec)] = score_hint
                like_candidates.append(
                    _build_reference(segment, video, float(score_hint or 0.1))
                )

            # 合并 FTS 与 LIKE，同一片段取更高分。
            combined: dict[tuple[int, float], dict] = {}
            for item in fts_candidates + like_candidates:
                key = (item["video_id"], item["start_sec"])
                if key not in combined or item["score_hint"] > combined[key]["score_hint"]:
                    combined[key] = item

            if combined:
                results = sorted(
                    combined.values(),
                    key=lambda item: item["score_hint"],
                    reverse=True,
                )
                return results[:limit]

            # Tier 3: Return recent/favorite videos
            fallback = db.query(Video)
            if video_id:
                fallback = fallback.filter(Video.id == video_id)
            videos = fallback.order_by(
                desc(Video.is_favorite), desc(Video.favorited_at), desc(Video.updated_at)
            ).limit(limit).all()
            return [
                {
                    "video_id": v.id,
                    "video_title": v.title,
                    "start_sec": 0,
                    "end_sec": min(v.duration or 0, 90),
                    "text": (v.summary or v.transcription or "")[:220],
                    "score_hint": 0.1,
                    "segment_id": 0,
                }
                for v in videos
            ]
        finally:
            db.close()


class VectorRetriever:
    """sqlite-vec 向量检索器。"""

    def search(
        self,
        query: str,
        video_id: int | None = None,
        limit: int = 10,
    ) -> list[dict]:
        """执行向量相似度搜索。"""
        try:
            # 2.94 的 SQLite 库里可能还没有 embedding 表。没有向量时
            # 直接跳过，避免每个查询变体都调用一次 embedding API 再报错。
            try:
                if count_embeddings() == 0:
                    return []
            except Exception:
                return []
            _load_vec()
            query_emb = generate_embedding(query)
            vec_results = search_similar(query_emb, video_id=video_id, top_k=limit * 2)
            if not vec_results:
                return []

            db = SessionLocal()
            try:
                segment_ids = [r["segment_id"] for r in vec_results]
                rows = (
                    db.query(SubtitleSegment, Video)
                    .join(Video, Video.id == SubtitleSegment.video_id)
                    .filter(SubtitleSegment.id.in_(segment_ids))
                    .all()
                )
                segment_map = {seg.id: (seg, vid) for seg, vid in rows}

                results = []
                for vr in vec_results:
                    item = segment_map.get(vr["segment_id"])
                    if not item:
                        continue
                    segment, video = item
                    distance = vr["distance"]
                    score = max(0.0, 1.0 - distance / 2.0)
                    results.append(_build_reference(segment, video, round(score, 3)))
                return results
            finally:
                db.close()
        except Exception as e:
            logger.warning(f"Vector search failed: {e}")
            return []


class HybridRetriever(BaseRetriever):
    """混合检索器：FTS5 关键字 + sqlite-vec 向量搜索。

    支持：
    - 查询扩展（多变体检索）
    - RRF 融合
    - Reranker 模型重排序
    - 意图感知（search vs summary）
    """

    fts_weight: float = 0.3
    vec_weight: float = 0.7
    default_limit: int = 6
    enable_query_expansion: bool = True
    enable_reranker: bool = True

    model_config = ConfigDict(arbitrary_types_allowed=True)

    def _title_search(
        self,
        keywords: list[str],
        video_id: int | None = None,
        limit: int = 6,
    ) -> list[dict]:
        """标题匹配通道。

        2.94 没有 3.0 的 retrieval_meta 通道，FTS5 只搜字幕正文，课程名/
        章节名这类查询会被高频词（Python/FastAPI）淹没。这里补一层轻量
        标题召回：先按关键词命中的数量排序视频，再取该视频里包含关键词
        的字幕片段。它只查 1.4 万条 videos，成本很低，不替代正文 FTS。
        """
        if not keywords:
            return []
        db = SessionLocal()
        try:
            filters = [Video.title.contains(kw) for kw in keywords if kw]
            if not filters:
                return []
            query_stmt = db.query(Video).filter(or_(*filters)).filter(Video.subtitle_segments.any())
            if video_id:
                query_stmt = query_stmt.filter(Video.id == video_id)
            videos = query_stmt.limit(max(5000, limit * 20)).all()

            # 关键词在标题里的稀有度：闭包/迭代器这类主题词应压过
            # JavaScript/Python 这类课程前缀高频词。
            df = {
                kw: max(1, db.query(Video).filter(Video.title.contains(kw)).count())
                for kw in keywords
                if kw
            }

            def title_score(video: Video) -> tuple[float, int]:
                title_lower = (video.title or "").lower()
                matched = [kw for kw in keywords if kw and kw in title_lower]
                # 稀有词权重更高；命中词数作为次要项；短标题优先。
                return (
                    sum(1.0 / (1.0 + df.get(kw, 1)) for kw in matched) * 10.0
                    + len(matched) * 0.2,
                    -len(video.title or ""),
                )

            ranked = sorted(videos, key=title_score, reverse=True)[: max(limit, 1)]
            results: list[dict] = []
            for video in ranked:
                segment_filters = [
                    SubtitleSegment.text.contains(kw) for kw in keywords if kw
                ]
                segments = (
                    db.query(SubtitleSegment)
                    .filter(SubtitleSegment.video_id == video.id)
                    .filter(or_(*segment_filters))
                    .order_by(SubtitleSegment.segment_index.asc())
                    .limit(1)
                    .all()
                )
                if not segments:
                    segments = (
                        db.query(SubtitleSegment)
                        .filter(SubtitleSegment.video_id == video.id)
                        .order_by(SubtitleSegment.segment_index.asc())
                        .limit(1)
                        .all()
                    )
                score, _ = title_score(video)
                for segment in segments:
                    if not (segment.text or "").strip():
                        continue
                    results.append(_build_reference(segment, video, float(score)))
            return results
        except Exception as exc:
            logger.warning("Title search failed: %s", exc)
            return []
        finally:
            db.close()

    def _get_relevant_documents(
        self,
        query: str,
        *,
        run_manager: CallbackManagerForRetrieverRun | None = None,
        video_id: int | None = None,
        limit: int | None = None,
        intent: str = "search",
    ) -> list[Document]:
        """执行混合检索，返回 LangChain Document 列表。

        Args:
            query: 用户查询
            video_id: 可选，限定视频范围
            limit: 返回结果数
            intent: 检索意图（search=精确检索, summary=覆盖式检索）
        """
        effective_limit = limit or self.default_limit

        # 1. 清理查询 + 提取关键词
        cleaned_query = strip_search_intent(query)
        keywords = extract_keywords(cleaned_query, intent)
        title_keywords: list[str] = list(keywords)
        for kw in keywords:
            for synonym in SYNONYM_MAP.get(kw.lower(), []):
                title_keywords.append(synonym.lower())
        title_keywords = list(dict.fromkeys(kw for kw in title_keywords if kw))

        # 2. 查询扩展（多变体检索）
        if self.enable_query_expansion:
            query_variants = expand_query(cleaned_query, intent)
        else:
            query_variants = [cleaned_query]

        # 3. 多变体检索 + 合并
        fts_retriever = FTSRetriever()
        vec_retriever = VectorRetriever()

        all_fts_results: list[dict] = self._title_search(
            title_keywords,
            video_id=video_id,
            limit=effective_limit,
        )
        all_vec_results: list[dict] = []

        for variant in query_variants:
            fts_results = fts_retriever.search(
                variant, video_id=video_id, limit=effective_limit * 2, keywords=keywords,
            )
            vec_results = vec_retriever.search(
                variant, video_id=video_id, limit=effective_limit * 2,
            )
            all_fts_results.extend(fts_results)
            all_vec_results.extend(vec_results)

        # 4. 去重 + RRF 融合（用更大的 limit 给 reranker 留空间）
        rerank_pool_size = effective_limit * 3
        merged = self._merge_results(all_fts_results, all_vec_results, rerank_pool_size)

        # 5. Reranker 模型重排序
        if self.enable_reranker and len(merged) > effective_limit:
            try:
                merged = rerank_documents(
                    query=cleaned_query,
                    documents=merged,
                    top_k=effective_limit,
                )
            except Exception as exc:
                logger.warning("Reranker failed, using original order: %s", exc)
                merged = merged[:effective_limit]
        else:
            merged = merged[:effective_limit]

        # 6. 转换为 LangChain Document
        documents = []
        for item in merged:
            doc = Document(
                page_content=item["text"],
                metadata={
                    "video_id": item["video_id"],
                    "video_title": item["video_title"],
                    "start_sec": item["start_sec"],
                    "end_sec": item["end_sec"],
                    "score_hint": item.get("score_hint", 0),
                    "rerank_score": item.get("rerank_score", 0),
                    "segment_id": item.get("segment_id", 0),
                    "source": "hybrid_search",
                },
            )
            documents.append(doc)

        return documents

    def _merge_results(
        self,
        fts_results: list[dict],
        vec_results: list[dict],
        limit: int,
    ) -> list[dict]:
        """使用 RRF 融合两个检索通道的结果。"""
        if not vec_results:
            return fts_results[:limit]
        if not fts_results:
            return vec_results[:limit]

        # 归一化分数到 0..1
        def normalize_scores(items: list[dict]) -> list[dict]:
            if not items:
                return []
            max_s = max(it["score_hint"] for it in items)
            if max_s <= 0:
                return [{**it, "_norm_score": 0.0} for it in items]
            return [{**it, "_norm_score": it["score_hint"] / max_s} for it in items]

        norm_fts = normalize_scores(fts_results)
        norm_vec = normalize_scores(vec_results)

        # 使用 (video_id, start_sec) 作为复合键合并
        combined: dict[tuple[int, float], dict] = {}
        for it in norm_fts:
            key = (it["video_id"], it["start_sec"])
            combined[key] = {**it, "_hybrid_score": it["_norm_score"] * self.fts_weight}

        for it in norm_vec:
            key = (it["video_id"], it["start_sec"])
            if key in combined:
                combined[key]["_hybrid_score"] += it["_norm_score"] * self.vec_weight
            else:
                combined[key] = {**it, "_hybrid_score": it["_norm_score"] * self.vec_weight}

        # 排序并清理内部字段
        merged = sorted(combined.values(), key=lambda x: x["_hybrid_score"], reverse=True)
        for it in merged:
            it.pop("_norm_score", None)
            it["score_hint"] = round(it.pop("_hybrid_score", 0.0), 3)

        return merged[:limit]


def create_hybrid_retriever(
    fts_weight: float = 0.5,
    vec_weight: float = 0.5,
    default_limit: int = 6,
    enable_query_expansion: bool = True,
    enable_reranker: bool = True,
) -> HybridRetriever:
    """创建混合检索器实例。"""
    return HybridRetriever(
        fts_weight=fts_weight,
        vec_weight=vec_weight,
        default_limit=default_limit,
        enable_query_expansion=enable_query_expansion,
        enable_reranker=enable_reranker,
    )
