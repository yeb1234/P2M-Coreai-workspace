"""词法检索（PostgreSQL pg_trgm）。

取代对中文完全失效的 SQLite FTS5 默认分词：
- 用 `text % query` 走 GIN 三元组索引，配合动态降低的 similarity_threshold
- 技术术语（Depends / useEffect / useState）额外走 ILIKE，保证精确命中
"""

from __future__ import annotations

import logging
import re

from sqlalchemy import text

from app.database import engine, settings

logger = logging.getLogger(__name__)

# 英文字母/数字/下划线/点号组成的技术 token，长度 >= 2
CODE_TOKEN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_.]{1,}")
# 中文连续串
CJK_RE = re.compile(r"[\u4e00-\u9fff]{2,}")

STOPWORDS = {
    "the", "and", "for", "with", "this", "that", "from", "what", "how",
    "怎么", "什么", "如何", "为什么", "哪些", "这个", "那个", "可以", "是否",
}


def extract_tokens(query: str, max_code_tokens: int = 6) -> list[str]:
    """抽技术术语，用于 ILIKE 精确匹配。"""
    tokens: list[str] = []
    for match in CODE_TOKEN_RE.findall(query):
        lowered = match.lower()
        if len(lowered) >= 2 and lowered not in STOPWORDS:
            tokens.append(lowered)
        if len(tokens) >= max_code_tokens:
            break
    return tokens


def lexical_search(
    query: str,
    *,
    limit: int = 30,
    category_ids: list[int] | None = None,
    video_ids: list[int] | None = None,
    similarity_threshold: float = 0.08,
) -> list[dict]:
    """返回词法命中，按相似度降序。任何异常都降级为空列表，不阻塞语义检索。"""
    query = (query or "").strip()
    if not query:
        return []

    filters: list[str] = []
    params: dict = {
        "q": query,
        "limit": limit,
        "threshold": similarity_threshold,
    }
    if category_ids:
        filters.append("v.category_id = ANY(:category_ids)")
        params["category_ids"] = list(category_ids)
    if video_ids:
        filters.append("s.video_id = ANY(:video_ids)")
        params["video_ids"] = list(video_ids)
    filter_sql = (" AND " + " AND ".join(filters)) if filters else ""

    # :like_pattern 与 :tokens 用于技术术语精确命中
    code_tokens = extract_tokens(query)
    token_conditions = ""
    if code_tokens:
        clauses = []
        for index, token in enumerate(code_tokens):
            key = f"tok{index}"
            clauses.append(f"lower(s.text) LIKE :{key}")
            params[key] = f"%{token}%"
        token_conditions = " OR (" + " OR ".join(clauses) + ")"

    sql = f"""
        SELECT
            s.id            AS segment_id,
            s.video_id      AS video_id,
            s.start_sec     AS start_sec,
            s.end_sec       AS end_sec,
            s.text          AS text,
            v.title         AS video_title,
            v.category_id   AS category_id,
            similarity(s.text, :q) AS sim
        FROM subtitle_segments s
        JOIN videos v ON v.id = s.video_id
        WHERE (s.text % :q{token_conditions}){filter_sql}
        ORDER BY sim DESC, length(s.text) ASC
        LIMIT :limit
    """

    try:
        with engine.connect() as conn:
            # 事务级降低阈值，避免污染连接池里其他查询
            with conn.begin():
                conn.execute(
                    text("SELECT set_config('pg_trgm.similarity_threshold', :t, true)"),
                    {"t": str(similarity_threshold)},
                )
                rows = conn.execute(text(sql), params).fetchall()
    except Exception as exc:
        logger.warning("词法检索失败，降级为纯语义检索: %s", exc)
        return []

    return [
        {
            "segment_id": row.segment_id,
            "video_id": row.video_id,
            "start_sec": row.start_sec,
            "end_sec": row.end_sec,
            "text": row.text,
            "video_title": row.video_title,
            "category_id": row.category_id,
            "lexical_score": float(row.sim or 0.0),
        }
        for row in rows
    ]


def title_search(query: str, *, limit: int = 10) -> list[dict]:
    """按视频标题模糊匹配，用于「有没有讲过 X 这门课」这类问题。"""
    query = (query or "").strip()
    if not query:
        return []
    sql = """
        SELECT id, title, category_id, duration,
               similarity(title, :q) AS sim
        FROM videos
        WHERE title % :q
        ORDER BY sim DESC
        LIMIT :limit
    """
    try:
        with engine.connect() as conn:
            with conn.begin():
                conn.execute(
                    text("SELECT set_config('pg_trgm.similarity_threshold', :t, true)"),
                    {"t": "0.05"},
                )
                rows = conn.execute(text(sql), {"q": query, "limit": limit}).fetchall()
    except Exception as exc:
        logger.warning("标题检索失败: %s", exc)
        return []

    return [
        {
            "video_id": row.id,
            "video_title": row.title,
            "category_id": row.category_id,
            "duration": row.duration,
            "title_score": float(row.sim or 0.0),
        }
        for row in rows
    ]
