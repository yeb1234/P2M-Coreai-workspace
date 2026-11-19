"""笔记 AI 的纯解析测试。不调用模型，也不碰数据库。"""

from __future__ import annotations

import pytest

from app.mcp.registry import MCP_TOOLS, list_tools
from app.services.note_ai import _parse_action_payload


def test_parse_action_payload_keeps_valid_items():
    raw = """```json
    {
      "todos": [
        {"title": "补 JSON 解析测试", "description": "今晚", "due_date": "2026-11-19", "priority": "medium"},
        "只写标题的字符串"
      ],
      "events": [
        {"title": "过 MCP 接口", "date": "2026-11-20", "start_time": "15:00", "end_time": "bad"}
      ]
    }
    ```"""
    parsed = _parse_action_payload(raw)
    assert [item["title"] for item in parsed["todos"]] == ["补 JSON 解析测试", "只写标题的字符串"]
    assert parsed["todos"][0]["priority"] == "medium"
    assert parsed["events"][0]["date"] == "2026-11-20"
    assert parsed["events"][0]["start_time"] == "15:00"
    assert parsed["events"][0]["end_time"] is None


def test_parse_action_payload_ignores_bad_dates_and_clamps():
    payload = '{"todos": [], "events": [' + ",".join(
        f'{{"title":"e{i}","date":"2026-13-40"}}' for i in range(8)
    ) + "]}"
    parsed = _parse_action_payload(payload)
    assert len(parsed["events"]) == 6
    assert all(item["date"] is None for item in parsed["events"])


def test_parse_action_payload_rejects_non_json():
    with pytest.raises(ValueError):
        _parse_action_payload("我建议你明天开会。")


def test_note_write_tools_refuse_without_confirmation():
    from app.agents.tools import (
        save_note,
        set_tool_note_context,
        set_tool_user,
        summarize_and_save_note,
    )

    set_tool_user(1)
    set_tool_note_context({"title": "测试笔记", "markdown": "# 正文"})
    assert "确认" in save_note.invoke(
        {"title": "测试笔记", "content": "", "summary": "", "confirm": False}
    )
    assert "确认" in summarize_and_save_note.invoke(
        {"title": "测试笔记", "content": "", "confirm": False}
    )
    set_tool_note_context(None)
    set_tool_user(None)


def test_mcp_manifest_has_note_tools_and_write_annotations():
    tools = {item["name"]: item for item in list_tools()}
    assert {"note_summarize", "note_polish", "note_detect_actions", "note_create", "todo_create", "calendar_create"} <= set(tools)
    assert tools["note_summarize"]["annotations"]["readOnlyHint"] is True
    assert tools["note_create"]["annotations"]["destructiveHint"] is True
    assert "confirm" in tools["note_create"]["inputSchema"]["properties"]
    assert tools["todo_create"]["annotations"]["destructiveHint"] is True
    assert {tool.name for tool in MCP_TOOLS} >= {"note_summarize", "todo_create"}
