"""面试题库/知识库只读检索回归测试。"""

from __future__ import annotations

from app.services.interview_library import (
    format_knowledge,
    format_question,
    get_question,
    knowledge_count,
    knowledge_detail,
    library_meta,
    list_knowledge_summaries,
    list_question_summaries,
    question_count,
    question_detail,
    search_knowledge,
    search_library,
    search_questions,
)


def test_bank_and_knowledge_are_complete():
    assert question_count() == 361
    assert knowledge_count() == 12


def test_get_question_by_id_and_title():
    by_id = get_question("B-1-1")
    assert by_id is not None
    assert by_id["title"] == "手写 ReAct 循环"
    assert "while" in by_id["answer"]

    by_title = get_question(title="手写 ReAct 循环")
    assert by_title is not None
    assert by_title["id"] == "B-1-1"

    assert get_question("不存在-的-题号") is None


def test_search_rag_permission_question():
    ids = [item["id"] for item in search_questions("RAG 权限", limit=8)]
    assert "X-RAG-ACL-01" in ids


def test_search_questions_filters_group_and_type():
    rows = search_questions("", limit=10, group="agent")
    assert rows
    assert all(item["group"] == "agent" for item in rows)

    debug_rows = search_questions("", limit=10, qtype="debug")
    assert debug_rows
    assert all(item["type"] == "debug" for item in debug_rows)


def test_search_knowledge_deepseek():
    ids = [item["id"] for item in search_knowledge("DeepSeek V4.1", limit=6)]
    assert "kb-deepseek-evolution" in ids


def test_formats_keep_rubric_and_sources():
    question = get_question("B-1-1")
    text = format_question(question, include_answer=False)
    assert "题号：B-1-1" in text
    assert "评分点" in text
    assert "while" in text
    assert "参考答案（题库原文）" not in text

    article = search_knowledge("DeepSeek V4.1", limit=1)[0]
    article_text = format_knowledge(article)
    assert article["title"] in article_text
    assert "来源" in article_text


def test_library_meta_and_paginated_summaries():
    meta = library_meta()
    assert meta["count"] == 361
    assert meta["knowledgeCount"] == 12
    assert meta["sourceCounts"]["书B"] > 0
    assert meta["version"]

    page = list_question_summaries(limit=60)
    assert page["total"] == 361
    assert len(page["items"]) == 60
    # 列表只带轻字段，答案/评分点不能回到首屏 payload。
    assert "answer" not in page["items"][0]
    assert "rubric" not in page["items"][0]
    assert page["items"][0]["title"]


def test_question_and_knowledge_detail_are_full():
    question = question_detail("B-1-1")
    assert question is not None
    assert question["title"] == "手写 ReAct 循环"
    assert question["answer"]

    knowledge = knowledge_detail("kb-deepseek-evolution")
    assert knowledge is not None
    assert knowledge["title"].startswith("DeepSeek V3")
    assert knowledge["body"]


def test_library_search_returns_both_groups():
    payload = search_library("RAG 权限", limit=6)
    assert payload["query"]
    assert any(item["id"] == "X-RAG-ACL-01" for item in payload["questions"])
    assert any(item["id"] == "kb-deepseek-evolution" for item in search_library("DeepSeek V4.1", limit=6)["knowledge"])


def test_knowledge_list_is_summaries_only():
    payload = list_knowledge_summaries()
    assert payload["count"] == 12
    assert len(payload["items"]) == 12
    assert "body" not in payload["items"][0]
