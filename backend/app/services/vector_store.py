"""pgvector 向量存储与近邻检索。

设计要点：
- 用 SQLAlchemy 连接池底层的 psycopg 连接，走二进制 COPY，比字符串字面量快一个量级
- HNSW + 过滤条件同时存在时开启 iterative_scan，避免「先取 top-k 再过滤」导致召回枯竭
- 所有查询返回 score = 1 - cosine_distance，取值 [-1, 1]，越大越相关
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import psycopg
from pgvector.psycopg import register_vector
from sqlalchemy import text

from app.database import engine, settings
from app.tables import CONTENT_CHUNKS, SEGMENT_EMBEDDINGS

logger = logging.getLogger(__name__)


@dataclass
class VectorHit:
    segment_id: int
    video_id: int
    score: float


class VectorStoreError(RuntimeError):
    pass


def _require_postgres() -> None:
    if not settings.is_postgres:
        raise VectorStoreError("向量检索依赖 PostgreSQL + pgvector")


def _register(conn: psycopg.Connection) -> None:
    try:
        register_vector(conn)
    except Exception:  # 已注册会抛，忽略
        pass


def upsert_embeddings(
    rows: list[tuple[int, int, int | None, np.ndarray]],
    *,
    model: str | None = None,
    chunk_size: int = 500,
) -> int:
    """批量写入向量。rows = [(segment_id, video_id, category_id, vector), ...]

    先 COPY 到临时表再 INSERT ... ON CONFLICT，比逐条 UPSERT 快得多。
    """
    _require_postgres()
    if not rows:
        return 0

    model = model or settings.embedding_model
    dim = settings.embedding_dim
    total = 0

    raw = engine.raw_connection()
    conn = raw.driver_connection
    try:
        _register(conn)
        for start in range(0, len(rows), chunk_size):
            chunk = rows[start : start + chunk_size]
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TEMP TABLE IF NOT EXISTS tmp_seg_emb (
                        segment_id BIGINT,
                        video_id INTEGER,
                        category_id INTEGER,
                        embedding halfvec
                    ) ON COMMIT DROP
                    """
                )
                cur.execute("TRUNCATE tmp_seg_emb")
                with cur.copy(
                    "COPY tmp_seg_emb (segment_id, video_id, category_id, embedding) FROM STDIN"
                ) as copy:
                    for segment_id, video_id, category_id, vector in chunk:
                        copy.write_row((segment_id, video_id, category_id, vector))
                cur.execute(
                    f"""
                    INSERT INTO {SEGMENT_EMBEDDINGS.name}
                        (segment_id, video_id, category_id, model, dim, embedding)
                    SELECT
                        segment_id, video_id, category_id, %s, %s, embedding
                    FROM tmp_seg_emb
                    ON CONFLICT (segment_id) DO UPDATE SET
                        video_id = EXCLUDED.video_id,
                        category_id = EXCLUDED.category_id,
                        model = EXCLUDED.model,
                        dim = EXCLUDED.dim,
                        embedding = EXCLUDED.embedding
                    """,
                    (model, dim),
                )
                total += len(chunk)
            conn.commit()
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        raise VectorStoreError(f"写入向量失败: {exc}") from exc
    finally:
        raw.close()

    logger.info("写入向量 %s 条（model=%s）", total, model)
    return total


def _search_chunks(
    query_vector: np.ndarray,
    *,
    top_k: int,
    category_ids: list[int] | None,
    video_ids: list[int] | None,
    ef_search: int,
) -> list[VectorHit]:
    """在语义块上做近邻检索。

    返回字段仍叫 segment_id（值是 chunk id），这样上层和前端都不用改。
    块表本身没有 category_id（分类挂在 videos 上），所以要多一次 JOIN ——
    换来的是一次命中就是 565 字的完整上下文，而不是 9 个字的碎片。
    """
    where_parts: list[str] = []
    params: dict = {
        "qvec": query_vector,
        "top_k": top_k,
        "ef": max(ef_search, top_k * 4),
    }
    if category_ids:
        where_parts.append("v.category_id = ANY(%(category_ids)s)")
        params["category_ids"] = list(category_ids)
    if video_ids:
        where_parts.append("c.video_id = ANY(%(video_ids)s)")
        params["video_ids"] = list(video_ids)
    where_parts.append("c.embedding IS NOT NULL")
    where_sql = "WHERE " + " AND ".join(where_parts)

    # 表名从 Core 定义取，不写字面量 —— 这张表和字幕表的 id 空间重叠，
    # 拼错了只会静默命中另一批数据
    chunk_table = CONTENT_CHUNKS.name
    sql = f"""
        SELECT c.id, c.video_id, 1 - (c.embedding <=> %(qvec)s) AS score
        FROM {chunk_table} c
        JOIN videos v ON v.id = c.video_id
        {where_sql}
        ORDER BY c.embedding <=> %(qvec)s
        LIMIT %(top_k)s
    """

    raw = engine.raw_connection()
    conn = raw.driver_connection
    try:
        _register(conn)
        with conn.cursor() as cur:
            cur.execute(f"SET LOCAL hnsw.ef_search = {int(params['ef'])}")
            if where_sql != "WHERE c.embedding IS NOT NULL":
                # 带过滤时用 relaxed_order，否则「先取 top-k 再过滤」会让召回枯竭
                cur.execute("SET LOCAL hnsw.iterative_scan = relaxed_order")
                cur.execute("SET LOCAL hnsw.max_scan_tuples = 200000")
            cur.execute(sql, params)
            rows = cur.fetchall()
    finally:
        conn.rollback()
        raw.close()

    return [VectorHit(segment_id=r[0], video_id=r[1], score=float(r[2])) for r in rows]


def search(
    query_vector: np.ndarray,
    *,
    top_k: int = 20,
    category_ids: list[int] | None = None,
    video_ids: list[int] | None = None,
    ef_search: int = 100,
) -> list[VectorHit]:
    """余弦近邻检索。过滤条件下启用 iterative_scan 保证召回。

    retrieval_source=chunks 时查语义块表（默认），=segments 时走历史实现。
    两者返回结构一致，上层无感。
    """
    _require_postgres()

    if settings.retrieval_source == "chunks":
        return _search_chunks(
            query_vector,
            top_k=top_k,
            category_ids=category_ids,
            video_ids=video_ids,
            ef_search=ef_search,
        )

    where_parts: list[str] = []
    params: dict = {
        "qvec": query_vector,
        "top_k": top_k,
        "ef": max(ef_search, top_k * 4),
    }
    if category_ids:
        where_parts.append("category_id = ANY(%(category_ids)s)")
        params["category_ids"] = list(category_ids)
    if video_ids:
        where_parts.append("video_id = ANY(%(video_ids)s)")
        params["video_ids"] = list(video_ids)
    where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    emb_table = SEGMENT_EMBEDDINGS.name
    sql = f"""
        SELECT segment_id, video_id, 1 - (embedding <=> %(qvec)s) AS score
        FROM {emb_table}
        {where_sql}
        ORDER BY embedding <=> %(qvec)s
        LIMIT %(top_k)s
    """

    raw = engine.raw_connection()
    conn = raw.driver_connection
    try:
        _register(conn)
        with conn.cursor() as cur:
            # SET LOCAL 不支持参数占位符，这里拼接的是受控整数
            cur.execute(f"SET LOCAL hnsw.ef_search = {int(params['ef'])}")
            if where_sql:
                cur.execute("SET LOCAL hnsw.iterative_scan = relaxed_order")
                cur.execute("SET LOCAL hnsw.max_scan_tuples = 200000")
            cur.execute(sql, params)
            rows = cur.fetchall()
    finally:
        conn.rollback()  # 只读，回滚释放 SET LOCAL
        raw.close()

    return [VectorHit(segment_id=r[0], video_id=r[1], score=float(r[2])) for r in rows]


def delete_by_video(video_id: int) -> int:
    _require_postgres()
    with engine.begin() as conn:
        result = conn.execute(
            text(f"DELETE FROM {SEGMENT_EMBEDDINGS.name} WHERE video_id = :vid"), {"vid": video_id}
        )
        return result.rowcount or 0


def stats() -> dict:
    _require_postgres()
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT
                    count(*) AS embedded,
                    count(DISTINCT video_id) AS videos,
                    min(created_at) AS first_at,
                    max(created_at) AS last_at
                FROM {emb}
                """.format(emb=SEGMENT_EMBEDDINGS.name)
            )
        ).first()
        model_rows = conn.execute(
            text(
                """
                SELECT model, count(*) FROM {emb}
                GROUP BY model ORDER BY count(*) DESC LIMIT 5
                """.format(emb=SEGMENT_EMBEDDINGS.name)
            )
        ).fetchall()
        eligible = conn.execute(
            text(
                "SELECT count(*) FROM subtitle_segments WHERE length(text) >= :min_len"
            ),
            {"min_len": settings.embedding_min_text_len},
        ).scalar()

    embedded = int(row[0] or 0) if row else 0
    return {
        "embedded": embedded,
        "eligible": int(eligible or 0),
        "coverage": round(embedded / eligible, 4) if eligible else 0.0,
        "videos": int(row[1] or 0) if row else 0,
        "models": [{"model": m, "count": c} for m, c in model_rows],
        "first_at": row[2].isoformat() if row and row[2] else None,
        "last_at": row[3].isoformat() if row and row[3] else None,
    }
