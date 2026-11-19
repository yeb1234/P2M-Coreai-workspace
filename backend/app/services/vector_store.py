"""pgvector 近邻检索（语义块）。

历史沿革
--------
这里原本有两条路径：
  content_chunks      —— 语义块（约 565 字），当前唯一在用的检索单位
  segment_embeddings  —— 逐句字幕向量（约 9 字），碎片时代的实现

碎片路径已删除。原因不是「代码旧」：
  1. 碎片做检索单位，一条命中只有「那我们就来看一下」这种句子，没有信息量，
     必须先按时间窗扩成段落才能给模型用，多一层拼装和去重
  2. 两条路径的调参完全不同（块模式关掉 trgm 相似度、阈值压到 0.04；
     碎片模式保留相似度、阈值 0.12），线上行为取决于一个配置项的取值，
     排查时极难判断当前跑的是哪一套
  3. 碎片表 71 万向量，而块表 6 万向量覆盖的内容是同一批

现在只剩一条路径，`retrieval_source` 配置项也一并删掉了。

设计要点
--------
- 用 SQLAlchemy 连接池底层的 psycopg 连接：`SET LOCAL hnsw.*` 不支持参数占位符，
  且 qvec 走 psycopg 的 numpy 适配器（二进制），比字符串字面量快一个量级
- HNSW + 过滤条件同时存在时开启 iterative_scan，避免「先取 top-k 再过滤」导致召回枯竭
- 返回 score = 1 - cosine_distance，取值 [-1, 1]，越大越相关
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import psycopg
from pgvector.psycopg import register_vector

from app.database import engine, settings
from app.tables import CONTENT_CHUNKS

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


def search(
    query_vector: np.ndarray,
    *,
    top_k: int = 20,
    category_ids: list[int] | None = None,
    video_ids: list[int] | None = None,
    ef_search: int = 100,
) -> list[VectorHit]:
    """在语义块上做余弦近邻检索，带过滤条件时启用 iterative_scan 保证召回。

    返回字段叫 segment_id（值是 chunk id），是为了不改上层和前端 ——
    改名要动 hybrid_search / 前端跳转 / 历史日志，收益只有「名字更准」。
    """
    _require_postgres()

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

    sql = f"""
        SELECT c.id, c.video_id, 1 - (c.embedding <=> %(qvec)s) AS score
        FROM {CONTENT_CHUNKS.name} c
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
        conn.rollback()  # 只读，回滚释放 SET LOCAL
        raw.close()

    return [VectorHit(segment_id=r[0], video_id=r[1], score=float(r[2])) for r in rows]
