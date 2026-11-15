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
from app.tables import retrieval_table_name

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


STOP_PHRASES = (
    "怎么实现", "怎么做", "怎么办", "是什么", "有什么", "为什么", "哪个更",
    "怎么样", "如何", "哪些", "可以", "能不能", "是不是",
)


def extract_cjk_terms(query: str, *, max_terms: int = 4, min_len: int = 2, max_len: int = 8) -> list[str]:
    """从中文查询里抽关键词。

    为什么需要：块模式下不能用 `text % query` 做相似度匹配 ——
    565 字的块和 6 字 query 的 trigram 相似度天然极低，
    为了召回只能把阈值压到 0.04，结果索引返回几万行，单次查询 1.2 秒。
    改成先抽词再 ILIKE，走 GIN 索引，实测 8ms。

    规则很朴素：按中文串切开，去掉疑问词尾巴，长度合适的留下。
    没必要上分词器 —— 检索场景下多召回几个无关词，比漏召回好。
    """
    terms: list[str] = []
    for chunk in CJK_RE.findall(query):
        cleaned = chunk
        for phrase in STOP_PHRASES:
            cleaned = cleaned.replace(phrase, " ")
        for piece in cleaned.split():
            if min_len <= len(piece) <= max_len and piece not in STOPWORDS:
                terms.append(piece)
                if len(terms) >= max_terms:
                    return terms
    return terms


def lexical_search(
    query: str,
    *,
    limit: int = 30,
    category_ids: list[int] | None = None,
    video_ids: list[int] | None = None,
    similarity_threshold: float = 0.12,
    min_text_len: int = 10,
) -> list[dict]:
    """返回词法命中，按相似度降序。任何异常都降级为空列表，不阻塞语义检索。

    min_text_len 过滤掉「有什么用」「Langgraph」这类 3-8 字碎片：
    trgm 相似度对短文本天然偏高，不过滤会让无信息量的片段挤掉真内容。
    """
    query = (query or "").strip()
    if not query:
        return []

    # 语义块模式下换表。两块表的列名一致（id/text/video_id/start_sec/end_sec），
    # 所以 SQL 结构可以完全复用。
    #
    # 表名从 app.tables 取，不在这里拼字面量：
    # 两张表的 id 空间重叠，拼错了不会报错，只会静默命中另一批文本。
    use_chunks = settings.retrieval_source == "chunks"
    source_table = retrieval_table_name()
    if use_chunks:
        # 块至少 30 字，长度过滤没有意义；短句过滤是给碎片模式用的补丁
        min_text_len = 0
        # 565 字的文本和短 query 做 trigram 相似度天然偏低，
        # 沿用木片时代的 0.12 会把绝大部分块挡在外面
        similarity_threshold = min(similarity_threshold, 0.04)

    filters: list[str] = []
    params: dict = {
        "q": query,
        "limit": limit,
        "threshold": similarity_threshold,
        "min_len": min_text_len,
        # 精确包含查询词的短片段要豁免长度限制，否则「依赖注入」这种
        # 本身就是短词的技术术语会被 min_len 误杀
        "q_like": f"%{query}%",
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
            clauses.append(f"s.text ILIKE :{key}")
            params[key] = f"%{token}%"
        token_conditions = " OR (" + " OR ".join(clauses) + ")"

    # 块模式下永远不用相似度匹配。
    # 565 字的块 vs 短 query，trigram 相似度天然极低；为了召回只能把阈值压到 0.04，
    # 结果 GIN 索引返回几万行候选，单次 1.2 秒。改用关键词 ILIKE 后 8ms。
    if use_chunks:
        use_similarity = False
        for index, term in enumerate(extract_cjk_terms(query)):
            key = f"cjk{index}"
            clauses_cjk = f"s.text ILIKE :{key}"
            params[key] = f"%{term.lower()}%"
            token_conditions = (token_conditions or "") + f" OR ({clauses_cjk})"
    else:
        # 长句里整句 trgm 相似度会被稀释（实测「Promise 链式调用怎么用」耗时
        # 1.2s 却对结果毫无贡献），此时只用技术术语 ILIKE，既快又准。
        # 阈值取 8：中文 8 字以上基本是一句话而非术语。
        use_similarity = len(query) <= 8 or not code_tokens
    if use_similarity:
        where_clause = f"(s.text % :q{token_conditions})"
    elif token_conditions:
        where_clause = f"(1=0{token_conditions})"
    else:
        return []

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
        FROM {source_table} s
        JOIN videos v ON v.id = s.video_id
        WHERE {where_clause}{filter_sql}
          AND (length(s.text) >= :min_len OR s.text ILIKE :q_like)
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
