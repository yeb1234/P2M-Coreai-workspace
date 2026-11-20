from app.agents.write_guard import (
    clear_write_grants,
    consume_write_grant,
    grant_write,
)


def test_write_grant_is_one_shot_and_bound_to_run():
    clear_write_grants()
    grant_write("create_todo", "run-a")

    assert consume_write_grant("create_todo", "run-a") is True
    assert consume_write_grant("create_todo", "run-a") is False
    assert consume_write_grant("create_todo", "run-b") is False


def test_write_grant_requires_run_id():
    clear_write_grants()
    grant_write("create_todo", None)
    assert consume_write_grant("create_todo", None) is False


def test_create_todo_refuses_confirm_flag_without_runtime_grant():
    from app.agents.tools import create_todo, set_tool_user

    clear_write_grants()
    set_tool_user(1)
    try:
        result = create_todo.invoke(
            {
                "title": "未确认测试",
                "content": "",
                "due_date": "2026-11-21",
                "priority": "medium",
                "pomodoro_rounds": 2,
                "confirm": True,
            }
        )
    finally:
        set_tool_user(None)

    assert "确认" in result
    assert "已创建" not in result


def test_sync_toolset_excludes_write_tools():
    from app.agents.tool_runtime import build_governed_toolset

    toolset = build_governed_toolset("task-planning", user_id=1, allow_writes=False)
    assert "create_todo" not in toolset.tool_names
    assert "save_note" not in toolset.tool_names
    assert "create_calendar_event" not in toolset.tool_names


def test_write_confirmation_approval_rejects_negated_custom_text():
    from app.agents.chat_agent import _is_write_approved

    assert _is_write_approved("A", "确认执行", "") is True
    assert _is_write_approved("", "", "确认执行") is True
    assert _is_write_approved("B", "取消，不写入", "") is False
    assert _is_write_approved("", "", "不确认") is False
    assert _is_write_approved("", "", "取消确认，先别写") is False
