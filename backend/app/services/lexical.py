"""词法检索（PostgreSQL pg_trgm）。

取代对中文完全失效的 SQLite FTS5 默认分词：
- 用 `text % query` 走 GIN 三元组索引，配合动态降低的 similarity_threshold
- 技术术语（Depends / useEffect / useState）额外走 ILIKE，保证精确命中
"""

from __future__ import annotations

import logging
import math
import re

from sqlalchemy import text

from app.database import engine
from app.tables import CONTENT_CHUNKS

logger = logging.getLogger(__name__)

# ─── 元数据检索通道（路径/标题）的阈值 ───
#
# 这两个数字是「文档频率」闸门，作用是防止泛词把通道灌满。依据是实测 df
# （14,327 个视频，2026-11）：
#
#   黑马前端 6230  ← 太泛，等于「所有前端课」，必须丢
#   产品经理 2000+ ← 同上
#   算法      810  ← 泛，单靠它召回没有区分度
#   面试      758  ← 泛
#   第五章    524  ← 可用（课程内的章节名）
#   jQuery    117
#   组件通信   47
#   闭包       40
#   GC算法      1
#
# 规则：词的 df > META_MAX_DF 直接丢弃；剩下的词里至少要有一个
# df <= META_MIN_SPECIFIC_DF，否则说明整条查询都是泛词，不该由路径来决策。
META_MAX_DF = 2000
META_MIN_SPECIFIC_DF = 600

# 元数据得分下限（归一化到 0-1）。命中「查询里有没有这个视频」靠的是覆盖面：
#   路径同时命中 2 个词 ≈ 0.85 以上；只命中 1 个词 ≈ 0.5-0.6；
#   只在「什么是 X」这种泛句式上撞到 1 个词 ≈ 0.15。
# 0.15 那批必须丢掉：RRF 只看排名不看分数，第 2 名照样能压过向量的第 1 名。
META_MIN_SCORE = 0.30

# 文档频率缓存：term -> (df, 记录时间)。只在进程内，重启即清空。
# 生命周期取 10 分钟：新增视频会让 df 变大，但变化量对闸门判断没有影响。
_DF_CACHE: dict[str, tuple[int, float]] = {}
_DF_TTL_SECONDS = 600.0

# 英文字母/数字/下划线/点号组成的技术 token，长度 >= 2
CODE_TOKEN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_.]{1,}")
# 中文连续串
CJK_RE = re.compile(r"[\u4e00-\u9fff]{2,}")

STOPWORDS = {
    "the", "and", "for", "with", "this", "that", "from", "what", "how",
    "怎么", "什么", "如何", "为什么", "哪些", "这个", "那个", "可以", "是否",
}

# 子串命中的「同前缀不同词」黑名单：token -> 必须排除的更长词。
#
# 为什么需要：词法通道是 `ILIKE '%java%'`，而字幕是 ASR 产物，
# 说话人讲 JavaScript 时写 javascript，讲 Java 时也常常粘连成
# javaapi / javasdk / java版。实测（2026-11，14,327 视频）：
#   content_chunks 含 java 的块 534 个，其中 214 个只是 javascript
#   标题+路径 ILIKE '%java%' 命中 1,119 个视频，绝大多数是 JS 课
# 结果「学 Java」会被 JS/Vue/Node 课程灌满，真正的 Java 内容（SpringBoot
# 那 22 个视频、面试题的 4 个视频）反而被压到后面。
# 这里只做高置信度排除，不做词边界（\m java \M 在 ASR 文本里只剩 3 个视频，
# 会把 javaapi / java sdk 这类粘连写法一起误杀）。
_TOKEN_EXCLUDE: dict[str, tuple[str, ...]] = {
    "java": ("javascript", "java script", "javascrtipt"),
}


def _exclude_patterns(token: str) -> list[str] | None:
    """返回该 token 需要排除的 ILIKE 模式；没有黑名单则返回 None。"""
    longer = _TOKEN_EXCLUDE.get(token.lower())
    return [f"%{item}%" for item in longer] if longer else None


# 上位概念展开：用户说「学 Java」，库里那门课的标题写的是 SpringBoot。
#
# 实测：22 个 SpringBoot 单元测试视频（第5章 8 个 / 第6章 14 个）是真 Java
# 技术栈内容，但标题、分类名里都没有 "java" 三个字，按 token 字面永远召不回。
# 这里只做「同义扩展召回」——把展开词作为额外的 ILIKE 分支并进候选池，
# 排序仍交给向量 / rerank，不会把无关内容顶到前面。
_TOKEN_EXPAND: dict[str, tuple[str, ...]] = {
    "java": ("springboot", "spring boot", "junit", "jvm", "maven"),
}


# 拉丁 token 进入正文词法检索的最短长度。
#
# 为什么不是 2：query 改写会把「依赖注入」补成 dependency injection DI，
# DI 这种两字符 token 生成 ILIKE '%di%'，在 6 万块上命中 6,000+ 行，
# 执行计划会从 GIN 位图扫描退化成逐视频 nested loop。
# 实测同一 query 从 29ms 变成约 700ms。正文召回交给更长的 token 和 CJK 词，
# 元数据通道（标题/路径）仍保留 2 字符能力，见 retrieval_meta.meta_terms。
MIN_LATIN_TOKEN_LEN = 3


def extract_tokens(
    query: str,
    max_code_tokens: int = 6,
    *,
    min_latin_len: int = MIN_LATIN_TOKEN_LEN,
) -> list[str]:
    """抽技术术语，用于 ILIKE 精确匹配。"""
    tokens: list[str] = []
    for match in CODE_TOKEN_RE.findall(query):
        lowered = match.lower()
        if len(lowered) >= min_latin_len and lowered not in STOPWORDS:
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
    """在语义块上做词法命中，按相似度降序。异常一律降级为空列表，不阻塞语义检索。

    这里只有一个检索源（content_chunks）。原来的「碎片模式」走
    subtitle_segments，已随 segment_embeddings 一起删除 ——
    两条路径的调参完全不同（块模式关掉 trgm 相似度、阈值压到 0.04，
    碎片模式要保留相似度、阈值 0.12），留着分支只会让线上行为取决于
    一个配置项的取值，排查时非常费劲。
    """
    query = (query or "").strip()
    if not query:
        return []

    # 表名从 app.tables 取，不写字面量
    source_table = CONTENT_CHUNKS.name

    # 块至少 30 字，长度过滤对块没有意义（保留 SQL 谓词是为了不漏改执行计划）
    min_text_len = 0
    # 565 字的文本和短 query 做 trigram 相似度天然偏低，
    # 沿用碎片时代的 0.12 会把绝大部分块挡在外面
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
            params[key] = f"%{token}%"
            excluded = _exclude_patterns(token)
            if excluded:
                # java 不能被 javascript 顶替：先命中再排除更长的同类词
                ex_key = f"tokex{index}"
                params[ex_key] = excluded
                clauses.append(f"(s.text ILIKE :{key} AND NOT (s.text ILIKE ANY(:{ex_key})))")
            else:
                clauses.append(f"s.text ILIKE :{key}")
            # 同义扩展：学 Java 时把 SpringBoot / JUnit 那些块的召回一起打开
            for extra in _TOKEN_EXPAND.get(token, ()):
                exp_key = f"tokexp{index}_{len(clauses)}"
                params[exp_key] = f"%{extra}%"
                clauses.append(f"s.text ILIKE :{exp_key}")
        token_conditions = " OR (" + " OR ".join(clauses) + ")"

    # 块模式下永远不用相似度匹配。
    # 565 字的块 vs 短 query，trigram 相似度天然极低；为了召回只能把阈值压到 0.04，
    # 结果 GIN 索引返回几万行候选，单次 1.2 秒。改用关键词 ILIKE 后 8ms。
    # 块模式永远不用相似度匹配：565 字的块 vs 短 query，trigram 相似度天然极低；
    # 为了召回只能把阈值压到 0.04，结果 GIN 索引返回几万行候选，单次 1.2 秒。
    # 改用关键词 ILIKE 后 8ms。
    use_similarity = False
    for index, term in enumerate(extract_cjk_terms(query)):
        key = f"cjk{index}"
        params[key] = f"%{term.lower()}%"
        token_conditions = (token_conditions or "") + f" OR (s.text ILIKE :{key})"
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
            -- 相关片段要显示相对文件夹层级，词法路径也必须带 filepath。
            -- 之前只有向量那条 SELECT 带了，导致「有的片段有路径、有的没有」，
            -- 实际取决于这条命中来自哪个检索源。
            v.filepath      AS filepath,
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
            "filepath": row.filepath,
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


def _document_frequency(terms: list[str]) -> dict[str, int]:
    """一条 SQL 统计每个词在「标题 + 路径」里命中了多少个视频。

    为什么用 `count(*) FILTER (...)` 一次算完：每个词单独跑一条
    `filepath ILIKE '%x%'` 要走一次 14k 行的顺序扫描（实测约 35ms/词），
    4 个词就是 140ms，比整次检索还贵。合并成一条只扫一遍，约 40-70ms。

    带一层进程内缓存：热门词（vue / 闭包 / 面试）会在连续查询里反复出现，
    实测第二次同样三个词是 69ms，缓存后直接 0。items 有上限，不会涨。
    """
    if not terms:
        return {}

    import time

    now = time.monotonic()
    cached: dict[str, int] = {}
    missing: list[str] = []
    for term in terms:
        hit = _DF_CACHE.get(term)
        if hit and now - hit[1] < _DF_TTL_SECONDS:
            cached[term] = hit[0]
        else:
            missing.append(term)
    if not missing:
        return cached

    columns = []
    params: dict = {}
    for index, term in enumerate(missing):
        key = f"df{index}"
        params[key] = f"%{term}%"
        excluded = _exclude_patterns(term)
        if excluded:
            # df 必须和命中条件同口径：java 若按子串统计是 1,119（几乎全是
            # JavaScript 课），会被 META_MAX_DF 判成泛词直接丢掉整条通道。
            ex_key = f"dfx{index}"
            params[ex_key] = excluded
            cond = (
                f"(title ILIKE :{key} AND NOT (title ILIKE ANY(:{ex_key})))"
                f" OR (filepath ILIKE :{key} AND NOT (filepath ILIKE ANY(:{ex_key})))"
            )
        else:
            cond = f"title ILIKE :{key} OR filepath ILIKE :{key}"
        columns.append(f"count(*) FILTER (WHERE {cond}) AS {key}")

    sql = "SELECT " + ", ".join(columns) + " FROM videos"
    try:
        with engine.connect() as conn:
            row = conn.execute(text(sql), params).first()
    except Exception as exc:  # noqa: BLE001
        logger.warning("元数据文档频率统计失败，跳过元数据通道: %s", exc)
        return {}

    if row is None:
        return {}

    result = dict(cached)
    for index, term in enumerate(missing):
        value = int(row[index] or 0)
        result[term] = value
        if len(_DF_CACHE) < 512:
            _DF_CACHE[term] = (value, now)
    return result


def meta_search(
    query: str,
    *,
    limit: int = 30,
    category_ids: list[int] | None = None,
    video_ids: list[int] | None = None,
    max_df: int = META_MAX_DF,
    min_specific_df: int = META_MIN_SPECIFIC_DF,
) -> list[dict]:
    """元数据通道：用「课程名 / 章节名 / 课时名」召回，每个视频只出一条。

    ## 为什么必须单独一路，而不是把路径拼进每个块的向量

    路径是**视频级**信号。如果把它拼进每个 chunk 的向量，同一个视频的
    所有块会共享同一段前缀，向量互相靠拢 —— 视频越长（库里最多 422 块）
    字幕内容的区分度被稀释得越厉害。所以路径只作为「视频级先验」参与
    RRF 融合，一个视频最多贡献一条候选，不会挤占内容召回的名额。

    ## 每个视频取哪一块

    不用固定的 chunk_index = 0：课程的第 0 块经常是「课程介绍 / 环境准备」，
    拿它当命中点，用户点进去听到的不是想问的内容。这里取
    **「该视频内第一次提到查询词的块」，没有就用第 0 块** —— 既是路径命中，
    又落在真正讲到这个东西的位置。

    ## 闸门（防止泛词灌满通道）

    - df > max_df 的词直接丢（"黑马前端" 6230 个视频，等于没筛）
    - 剩下的词里至少要有一个 df <= min_specific_df，否则整条查询都是泛词，
      交回给内容通道处理。具体数值见文件头注释里的实测 df 表。

    异常一律返回空列表：这只是第三路召回，挂了不能拖垮主检索。
    """
    from app.services import retrieval_meta

    if not retrieval_meta.CHANNEL_ENABLED:
        return []

    query = (query or "").strip()
    if not query:
        return []

    terms = retrieval_meta.meta_terms(query)
    if not terms:
        return []

    # 同义扩展要一并进元数据通道：问「学 Java」时，标题写 SpringBoot 的
    # 那门课（22 个视频）只能靠这一步才被召回。
    for term in list(terms):
        terms.extend(_TOKEN_EXPAND.get(term.lower(), ()))
    terms = list(dict.fromkeys(terms))

    df = _document_frequency(terms)
    kept = [term for term in terms if 0 < df.get(term, 0) <= max_df]
    if not kept:
        return []
    if min(df[term] for term in kept) > min_specific_df:
        logger.debug("元数据通道跳过（全是泛词）: %s", kept)
        return []

    # 词权重：df 越小越有区分度。log 压缩一下，避免 1 个词的视频
    # （GC算法 df=1）把其它词完全压死。
    weights = {term: 1.0 / math.log2(2 + df[term]) for term in kept}
    top = max(weights.values())
    weights = {term: round(value / top, 3) for term, value in weights.items()}
    # 归一化分母：命中「几个词」比「命中哪个词」更重要。
    # 不归一化时，只命中 1 个词的视频（Python 课的《jQuery_动画(一)》）
    # 会和命中 2 个词的视频（《第五章 jQuery / 02-获取位置》）同分，
    # 多词共现的优势就消失了 —— 而共现恰恰是「路径能救回来」的原因。
    total_weight = sum(weights.values()) or 1.0

    params: dict = {"limit": limit}
    score_cases: list[str] = []
    like_conditions: list[str] = []
    text_conditions: list[str] = []
    for index, term in enumerate(kept):
        key = f"m{index}"
        params[key] = f"%{term}%"
        weight = weights[term]
        excluded = _exclude_patterns(term)
        ex_key = f"mx{index}"
        if excluded:
            params[ex_key] = excluded

            def _col_cond(column: str, _k: str = key, _x: str = ex_key) -> str:
                # 元数据通道同样要防 javascript 顶替 java：
                # 否则「学 Java」命中的全是 JS 课程的路径，RRF 里一路排前。
                return f"({column} ILIKE :{_k} AND NOT ({column} ILIKE ANY(:{_x})))"

        else:

            def _col_cond(column: str, _k: str = key) -> str:
                return f"{column} ILIKE :{_k}"

        # 命中位置的权重只做「同分时的先后」，不做主导：
        # 先比命中几个词（覆盖率），再看命中的是标题还是路径。
        # 早期版本给路径 0.5，结果「路径同时命中 jQuery + 第五章」的视频
        # （0.85 分）反而输给「只有标题里有 jQuery」的视频（1.0 分）——
        # 这正是要靠路径救回来的那类查询。
        score_cases.append(
            f"CASE WHEN {_col_cond('v.title')} THEN {weight}"
            f" WHEN {_col_cond('v.filename')} THEN {round(weight * 0.95, 3)}"
            f" WHEN {_col_cond('v.filepath')} THEN {round(weight * 0.85, 3)}"
            f" ELSE 0 END"
        )
        like_conditions.append(f"{_col_cond('v.title')} OR {_col_cond('v.filepath')}")
        text_conditions.append(_col_cond("s2.text"))

    filters: list[str] = []
    if category_ids:
        filters.append("v.category_id = ANY(:category_ids)")
        params["category_ids"] = list(category_ids)
    if video_ids:
        filters.append("v.id = ANY(:video_ids)")
        params["video_ids"] = list(video_ids)
    filter_sql = (" AND " + " AND ".join(filters)) if filters else ""

    score_sql = f"({' + '.join(score_cases)}) / {round(total_weight, 3)}"
    like_sql = " OR ".join(f"({c})" for c in like_conditions)
    text_sql = " OR ".join(f"({c})" for c in text_conditions)

    sql = f"""
        WITH cand AS (
            SELECT v.id, v.title, v.filepath, v.category_id,
                   ({score_sql}) AS meta_score
            FROM videos v
            WHERE ({like_sql}){filter_sql}
            -- 先把视频级候选截断，再回块表取具体片段。
            -- 不截断的话，泛词（vue df=1520）会让下面的相关子查询
            -- 对上千个视频各算一次，单次查询从 60ms 涨到 500ms+。
            ORDER BY meta_score DESC
            LIMIT :cand_limit
        )
        SELECT
            s.id            AS segment_id,
            s.video_id      AS video_id,
            s.start_sec     AS start_sec,
            s.end_sec       AS end_sec,
            s.text          AS text,
            c.title         AS video_title,
            c.filepath      AS filepath,
            c.category_id   AS category_id,
            c.meta_score    AS meta_score
        FROM cand c
        JOIN {CONTENT_CHUNKS.name} s ON s.video_id = c.id
        WHERE s.chunk_index = COALESCE(
                (SELECT min(s2.chunk_index)
                   FROM {CONTENT_CHUNKS.name} s2
                  WHERE s2.video_id = c.id AND ({text_sql})),
                0)
          AND s.end_sec > s.start_sec
        ORDER BY c.meta_score DESC, s.start_sec ASC
        LIMIT :limit
    """

    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text(sql), {**params, "cand_limit": limit * 2}
            ).fetchall()
    except Exception as exc:  # noqa: BLE001
        logger.warning("元数据检索失败，跳过该通道: %s", exc)
        return []

    out: list[dict] = []
    for row in rows:
        score = round(float(row.meta_score or 0.0), 4)
        if score < META_MIN_SCORE:
            continue
        meta = retrieval_meta.build_meta(row.filepath, row.video_title)
        out.append(
            {
                "segment_id": row.segment_id,
                "video_id": row.video_id,
                "start_sec": row.start_sec,
                "end_sec": row.end_sec,
                "text": row.text,
                "video_title": row.video_title,
                "filepath": row.filepath,
                "category_id": row.category_id,
                "meta_score": score,
                "meta_text": meta.meta_text,
            }
        )
        if len(out) >= limit:
            break
    return out
