"""面试题库 / 知识库只读检索层。

题库和知识库的真源是 `src/data/interview/*.json`，构建时同步到
`backend/app/data/`，让 Agent 工具可以检索整套数据，而不是只看聊天请求里
带过来的当前题目。这里不做写入、不做向量索引；360 道题规模用轻量词法
打分足够，而且结果可解释、冷启动为零。

注意：这个模块只返回文本，工具层负责长度截断。
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
QUESTIONS_PATH = DATA_DIR / "interview_questions.json"
KNOWLEDGE_PATH = DATA_DIR / "interview_knowledge.json"

_CJK_RE = re.compile(r"[\u4e00-\u9fff]+")
_LATIN_RE = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_+#.\-]*")
_SPACE_RE = re.compile(r"\s+")

_CACHE_PREFIX = "interview:library:v1"
_CACHE_TTL_SECONDS = 600
_CACHE_CLIENT = None
_CACHE_LOCK = threading.Lock()

_TYPE_LABELS = {
    "concept": "概念",
    "code": "代码",
    "handwrite": "手写",
    "debug": "改错",
    "scenario": "场景",
    "compare": "对比",
    "troubleshoot": "排障",
    "system": "系统设计",
    "project": "项目深挖",
    "behavioral": "行为面试",
}


def _norm(value: Any) -> str:
    return _SPACE_RE.sub(" ", str(value or "")).strip().lower()


def _truncate(value: str, limit: int) -> str:
    text = (value or "").strip()
    if len(text) <= limit:
        return text
    return f"{text[:limit]}\n...[已截断 {len(text) - limit} 字]"


@lru_cache(maxsize=2)
def _load_json(path: str) -> dict:
    try:
        with Path(path).open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except Exception as exc:  # noqa: BLE001 - 数据缺失不应拖垮聊天
        logger.warning("读取面试资料失败 %s: %s", path, exc)
        return {}


@lru_cache(maxsize=1)
def bank() -> dict:
    return _load_json(str(QUESTIONS_PATH))


@lru_cache(maxsize=1)
def knowledge_base() -> dict:
    return _load_json(str(KNOWLEDGE_PATH))


@lru_cache(maxsize=1)
def questions() -> tuple[dict, ...]:
    raw = bank().get("questions") or []
    return tuple(item for item in raw if isinstance(item, dict))


@lru_cache(maxsize=1)
def knowledge_articles() -> tuple[dict, ...]:
    raw = knowledge_base().get("articles") or []
    return tuple(item for item in raw if isinstance(item, dict))


def question_count() -> int:
    return len(questions())


def knowledge_count() -> int:
    return len(knowledge_articles())


def _cache_client():
    """懒加载 Redis；连不上就返回 None，题库读取不能因缓存故障失败。"""
    global _CACHE_CLIENT
    if _CACHE_CLIENT is not None:
        return _CACHE_CLIENT
    with _CACHE_LOCK:
        if _CACHE_CLIENT is not None:
            return _CACHE_CLIENT
        try:
            import redis

            from app.database import settings

            _CACHE_CLIENT = redis.Redis.from_url(
                settings.redis_url,
                decode_responses=True,
                socket_connect_timeout=0.15,
                socket_timeout=0.2,
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("面试题库 Redis 不可用: %s", exc)
            return None
    return _CACHE_CLIENT


@lru_cache(maxsize=1)
def data_version() -> str:
    """用文件内容哈希做缓存命名空间；换题后旧 key 自然失效。"""
    digest = hashlib.sha1()
    for path in (QUESTIONS_PATH, KNOWLEDGE_PATH):
        try:
            digest.update(path.name.encode("utf-8"))
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
        except Exception as exc:  # noqa: BLE001
            logger.warning("面试资料版本计算失败 %s: %s", path, exc)
            digest.update(b"missing")
    return digest.hexdigest()[:16]


def _cache_key(kind: str, payload: Any = None) -> str:
    suffix = ""
    if payload is not None:
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
        suffix = ":" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
    return f"{_CACHE_PREFIX}:{data_version()}:{kind}{suffix}"


def _read_through(key: str, builder, ttl: int = _CACHE_TTL_SECONDS):
    """Redis read-through；命中返回反序列化对象，未命中写回。

    缓存的是给 API/工具直接消费的纯 dict/list，不缓存 ORM 或文件句柄。
    Redis 慢或挂掉时直接走 builder，不把缓存当业务前置条件。
    """
    client = _cache_client()
    if client is not None:
        try:
            cached = client.get(key)
            if cached is not None:
                return json.loads(cached)
        except Exception as exc:  # noqa: BLE001
            logger.debug("面试题库缓存读取失败 %s: %s", key, exc)
    data = builder()
    if client is not None and data is not None:
        try:
            client.setex(key, ttl, json.dumps(data, ensure_ascii=False, default=str))
        except Exception as exc:  # noqa: BLE001
            logger.debug("面试题库缓存写入失败 %s: %s", key, exc)
    return data


_QUESTION_SUMMARY_FIELDS = (
    "id",
    "group",
    "groupLabel",
    "resumeGroup",
    "resumeGroupLabel",
    "type",
    "difficulty",
    "source",
    "bookId",
    "bookPage",
    "chapter",
    "title",
    "question",
    "tags",
    "bookTitle",
)


def _question_summary(question: dict) -> dict:
    """列表/搜索只带轻字段；参考答案、rubric、追问留给详情接口。"""
    return {field: question.get(field) for field in _QUESTION_SUMMARY_FIELDS}


def question_summaries() -> tuple[dict, ...]:
    return tuple(_question_summary(question) for question in questions())


def knowledge_summaries() -> tuple[dict, ...]:
    return tuple(
        {
            "id": article.get("id"),
            "category": article.get("category"),
            "title": article.get("title"),
            "subtitle": article.get("subtitle"),
            "readingMinutes": article.get("readingMinutes"),
            "tags": article.get("tags"),
            "summary": article.get("summary"),
            "relatedQuestions": article.get("relatedQuestions"),
        }
        for article in knowledge_articles()
    )


def library_meta() -> dict:
    def build() -> dict:
        source_counts: dict[str, int] = {}
        type_counts: dict[str, int] = {}
        group_counts: dict[str, int] = {}
        for question in questions():
            source = str(question.get("source") or "")
            qtype = str(question.get("type") or "")
            group = str(question.get("group") or "")
            source_counts[source] = source_counts.get(source, 0) + 1
            type_counts[qtype] = type_counts.get(qtype, 0) + 1
            group_counts[group] = group_counts.get(group, 0) + 1
        return {
            "version": data_version(),
            "count": question_count(),
            "knowledgeCount": knowledge_count(),
            "groups": bank().get("groups") or {},
            "resumeGroups": bank().get("resumeGroups") or {},
            "sourceCounts": source_counts,
            "typeCounts": type_counts,
            "groupCounts": group_counts,
        }

    return _read_through(_cache_key("meta"), build, ttl=3600)


def _score_summary(question: dict, query: str, tokens: set[str]) -> int:
    title = _norm(question.get("title"))
    stem = _norm(question.get("question"))
    tags = _norm(" ".join(str(item) for item in (question.get("tags") or [])))
    chapter = _norm(question.get("chapter"))
    group_label = _norm(question.get("groupLabel"))
    resume_label = _norm(question.get("resumeGroupLabel"))
    haystack = " ".join((title, stem, tags, chapter, group_label, resume_label))
    normalized_query = _norm(query)

    score = 0
    if normalized_query and normalized_query in haystack:
        score += 24
    if normalized_query and normalized_query in title:
        score += 20
    for token in tokens:
        weight = max(1, min(6, len(token) - 1))
        if token in title:
            score += 6 * weight
        elif token in tags:
            score += 5 * weight
        elif token in stem:
            score += 3 * weight
        elif token in chapter or token in group_label or token in resume_label:
            score += 2 * weight
    return score


def list_question_summaries(
    query: str = "",
    group: str = "",
    qtype: str = "",
    source: str = "",
    offset: int = 0,
    limit: int = 60,
) -> dict:
    """分页题目列表；默认顺序稳定，带关键词时按相关度排序。"""
    safe_limit = max(1, min(int(limit or 60), 400))
    safe_offset = max(0, int(offset or 0))
    payload = {
        "query": _norm(query),
        "group": _norm(group),
        "qtype": _norm(qtype),
        "source": _norm(source),
        "offset": safe_offset,
        "limit": safe_limit,
    }

    def build() -> dict:
        normalized_query = payload["query"]
        tokens = _query_tokens(normalized_query) if normalized_query else set()
        candidates: list[tuple[int, dict]] = []
        for question in question_summaries():
            if payload["group"] and _norm(question.get("group")) != payload["group"]:
                continue
            if payload["qtype"] and _norm(question.get("type")) != payload["qtype"]:
                continue
            if payload["source"] and _norm(question.get("source")) != payload["source"]:
                continue
            score = _score_summary(question, normalized_query, tokens) if normalized_query else 0
            if normalized_query and score <= 0:
                continue
            candidates.append((score, question))
        if normalized_query:
            candidates.sort(key=lambda pair: (-pair[0], str(pair[1].get("id") or "")))
        sliced = candidates[safe_offset : safe_offset + safe_limit]
        return {
            "version": data_version(),
            "total": len(candidates),
            "offset": safe_offset,
            "limit": safe_limit,
            "items": [question for _, question in sliced],
        }

    return _read_through(_cache_key("questions", payload), build, ttl=_CACHE_TTL_SECONDS)


def question_detail(question_id: str) -> dict | None:
    normalized_id = _norm(question_id)
    if not normalized_id:
        return None

    def build() -> dict | None:
        return get_question(question_id=normalized_id)

    return _read_through(_cache_key("question", normalized_id), build, ttl=1800)


def random_question() -> dict | None:
    """随机开考直接返回整题；不做缓存，避免每次抽到同一道。"""
    import random

    rows = questions()
    return random.choice(rows) if rows else None


def list_knowledge_summaries() -> dict:
    def build() -> dict:
        return {
            "version": data_version(),
            "count": knowledge_count(),
            "items": list(knowledge_summaries()),
        }

    return _read_through(_cache_key("knowledge-list"), build, ttl=_CACHE_TTL_SECONDS)


def knowledge_detail(article_id: str) -> dict | None:
    normalized_id = _norm(article_id)
    if not normalized_id:
        return None

    def build() -> dict | None:
        return next(
            (article for article in knowledge_articles() if _norm(article.get("id")) == normalized_id),
            None,
        )

    return _read_through(_cache_key("knowledge", normalized_id), build, ttl=1800)


def search_library(query: str, limit: int = 8) -> dict:
    """页面级搜索：题目 + 知识库一次返回，前端不需要本地整包。"""
    safe_limit = max(1, min(int(limit or 8), 20))
    payload = {"query": _norm(query), "limit": safe_limit}

    def build() -> dict:
        normalized_query = payload["query"]
        tokens = _query_tokens(normalized_query) if normalized_query else set()
        scored = [
            (_score_summary(question, normalized_query, tokens), question)
            for question in question_summaries()
        ]
        scored = [(score, question) for score, question in scored if score > 0]
        scored.sort(key=lambda pair: (-pair[0], str(pair[1].get("id") or "")))

        article_scored = [
            (_score_article(article, normalized_query, tokens), article)
            for article in knowledge_articles()
        ]
        article_scored = [(score, article) for score, article in article_scored if score > 0]
        article_scored.sort(key=lambda pair: (-pair[0], str(pair[1].get("id") or "")))

        return {
            "version": data_version(),
            "query": normalized_query,
            "questions": [_question_summary(question) for _, question in scored[:safe_limit]],
            "knowledge": [
                next(
                    (
                        summary
                        for summary in knowledge_summaries()
                        if summary.get("id") == article.get("id")
                    ),
                    {},
                )
                for _, article in article_scored[:safe_limit]
            ],
        }

    return _read_through(_cache_key("search", payload), build, ttl=_CACHE_TTL_SECONDS)


def _query_tokens(query: str) -> set[str]:
    """中英混合的轻量分词。

    中文按 2/3/4-gram 切，英文按单词切；不引第三方分词器。
    对「RAG 权限」「DeepSeek V4.1」这类面试关键词足够用。
    """
    text = _norm(query)
    tokens: set[str] = set()
    for run in _CJK_RE.findall(text):
        if len(run) <= 4:
            tokens.add(run)
        for size in (2, 3, 4):
            if len(run) < size:
                continue
            for index in range(len(run) - size + 1):
                tokens.add(run[index : index + size])
    for token in _LATIN_RE.findall(text):
        if len(token) >= 2:
            tokens.add(token.lower())
    return set(sorted(tokens, key=lambda item: (len(item), item), reverse=True)[:48])


def _score_question(question: dict, query: str, tokens: set[str]) -> int:
    title = _norm(question.get("title"))
    stem = _norm(question.get("question"))
    answer = _norm(question.get("answer"))
    tags = _norm(" ".join(str(item) for item in (question.get("tags") or [])))
    chapter = _norm(question.get("chapter"))
    group_label = _norm(question.get("groupLabel"))
    haystack = " ".join((title, stem, tags, chapter, group_label))
    normalized_query = _norm(query)

    score = 0
    if normalized_query and normalized_query in haystack:
        score += 24
    if normalized_query and normalized_query in title:
        score += 20
    for token in tokens:
        weight = max(1, min(6, len(token) - 1))
        if token in title:
            score += 6 * weight
        elif token in tags:
            score += 5 * weight
        elif token in stem:
            score += 3 * weight
        elif token in chapter or token in group_label:
            score += 2 * weight
        elif token in answer:
            score += 1 * weight
    return score


def _score_article(article: dict, query: str, tokens: set[str]) -> int:
    title = _norm(article.get("title"))
    subtitle = _norm(article.get("subtitle"))
    summary = _norm(article.get("summary"))
    body = _norm(article.get("body"))
    tags = _norm(" ".join(str(item) for item in (article.get("tags") or [])))
    category = _norm(article.get("category"))
    haystack = " ".join((title, subtitle, summary, tags, category))
    normalized_query = _norm(query)

    score = 0
    if normalized_query and normalized_query in haystack:
        score += 20
    if normalized_query and normalized_query in body:
        score += 12
    for token in tokens:
        weight = max(1, min(6, len(token) - 1))
        if token in title:
            score += 5 * weight
        elif token in tags:
            score += 4 * weight
        elif token in summary:
            score += 3 * weight
        elif token in category:
            score += 2 * weight
        elif token in body:
            score += 1 * weight
    return score


def search_questions(
    query: str,
    limit: int = 5,
    group: str = "",
    qtype: str = "",
) -> list[dict]:
    """按关键词检索题目；返回原 dict，方便上层继续格式化。"""
    normalized_query = _norm(query)
    wanted_group = _norm(group)
    wanted_type = _norm(qtype)
    safe_limit = max(1, min(int(limit or 5), 10))

    candidates = []
    if normalized_query:
        tokens = _query_tokens(normalized_query)
        for question in questions():
            if wanted_group and _norm(question.get("group")) != wanted_group:
                continue
            if wanted_type and _norm(question.get("type")) != wanted_type:
                continue
            score = _score_question(question, normalized_query, tokens)
            if score > 0:
                candidates.append((score, question))
    else:
        candidates = [(0, question) for question in questions()]
        if wanted_group:
            candidates = [(s, q) for s, q in candidates if _norm(q.get("group")) == wanted_group]
        if wanted_type:
            candidates = [(s, q) for s, q in candidates if _norm(q.get("type")) == wanted_type]

    candidates.sort(
        key=lambda pair: (
            -pair[0],
            str(pair[1].get("id") or ""),
        )
    )
    return [item for _, item in candidates[:safe_limit]]


def get_question(question_id: str = "", title: str = "") -> dict | None:
    """按题号优先、标题其次取单题。"""
    normalized_id = _norm(question_id)
    normalized_title = _norm(title)
    if normalized_id:
        for question in questions():
            if _norm(question.get("id")) == normalized_id:
                return question
    if normalized_title:
        exact = next(
            (q for q in questions() if _norm(q.get("title")) == normalized_title),
            None,
        )
        if exact:
            return exact
        contains = next(
            (q for q in questions() if normalized_title in _norm(q.get("title"))),
            None,
        )
        if contains:
            return contains
    return None


def format_question(question: dict, include_answer: bool = True, answer_limit: int = 5200) -> str:
    qid = str(question.get("id") or "")
    title = str(question.get("title") or "")
    qtype = _TYPE_LABELS.get(str(question.get("type") or ""), str(question.get("type") or ""))
    lines = [
        f"题号：{qid}",
        f"标题：{title}",
        f"分组：{question.get('groupLabel') or question.get('group') or ''}",
        f"类型：{qtype}｜难度：{question.get('difficulty') or ''}｜来源：{question.get('source') or ''}",
    ]
    if question.get("chapter"):
        lines.append(f"章节：{question.get('chapter')}")
    if question.get("bookId") and question.get("bookPage"):
        lines.append(f"原书：书{question.get('bookId')} p.{question.get('bookPage')}")
    lines.append("")
    lines.append("题干：")
    lines.append(str(question.get("question") or ""))
    rubric = question.get("rubric") or []
    if rubric:
        lines.append("")
        lines.append("评分点：")
        lines.extend(f"- {item}" for item in rubric)
    follow_ups = question.get("followUps") or []
    if follow_ups:
        lines.append("")
        lines.append("常见追问：")
        lines.extend(f"- {item}" for item in follow_ups)
    if include_answer:
        lines.append("")
        lines.append("参考答案（题库原文）：")
        lines.append(_truncate(str(question.get("answer") or ""), max(200, int(answer_limit))))
    tags = question.get("tags") or []
    if tags:
        lines.append("")
        lines.append("标签：" + " / ".join(str(item) for item in tags))
    return "\n".join(lines).strip()


def format_question_brief(question: dict, stem_limit: int = 180) -> str:
    qid = str(question.get("id") or "")
    qtype = _TYPE_LABELS.get(str(question.get("type") or ""), str(question.get("type") or ""))
    title = str(question.get("title") or "")
    stem = _truncate(str(question.get("question") or ""), stem_limit).replace("\n", " ")
    tags = " / ".join(str(item) for item in (question.get("tags") or [])[:3])
    return (
        f"- {qid}｜{title}｜{qtype}｜{question.get('difficulty') or ''}"
        f"｜题干：{stem}"
        + (f"｜标签：{tags}" if tags else "")
    )


def search_knowledge(query: str, limit: int = 3) -> list[dict]:
    normalized_query = _norm(query)
    safe_limit = max(1, min(int(limit or 3), 6))
    if not normalized_query:
        return list(knowledge_articles()[:safe_limit])
    tokens = _query_tokens(normalized_query)
    scored = [
        (_score_article(article, normalized_query, tokens), article)
        for article in knowledge_articles()
    ]
    scored = [(score, article) for score, article in scored if score > 0]
    scored.sort(key=lambda pair: (-pair[0], str(pair[1].get("id") or "")))
    return [article for _, article in scored[:safe_limit]]


def format_knowledge(article: dict, body_limit: int = 2400) -> str:
    lines = [
        f"《{article.get('title') or ''}》",
        f"分类：{article.get('category') or ''}｜阅读约 {article.get('readingMinutes') or 0} 分钟",
    ]
    if article.get("summary"):
        lines.append("摘要：" + str(article.get("summary")))
    tags = article.get("tags") or []
    if tags:
        lines.append("标签：" + " / ".join(str(item) for item in tags))
    if article.get("body"):
        lines.append("")
        lines.append("正文节选：")
        lines.append(_truncate(str(article.get("body")), max(400, int(body_limit))))
    sources = article.get("sources") or []
    if sources:
        lines.append("")
        lines.append("来源：")
        for source in sources[:4]:
            lines.append(f"- {source.get('title') or ''} {source.get('url') or ''}".strip())
    return "\n".join(lines).strip()
