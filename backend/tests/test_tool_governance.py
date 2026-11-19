"""工具/Skill 治理层回归测试。

不碰真实数据库：用 fake StructuredTool 验证预算、超时、错误归一化和截断；
真实工具只做注册表与策略映射的静态校验。
"""

from __future__ import annotations

import time

from langchain_core.tools import StructuredTool

from app.agents.skills import SKILLS, SkillSpec, resolve_skill, validate_skills
from app.agents.tool_context import (
    ToolCallToken,
    begin_search_trace,
    record_search_hits,
    reset_call_token,
    set_call_token,
    take_search_hits,
)
from app.agents.tool_metrics import BREAKER, METRICS
from app.agents.tool_registry import DEFAULT_REGISTRY, ToolRegistry, ToolSpec
from app.agents.tool_runtime import (
    ToolBudget,
    ToolBudgetExceeded,
    build_governed_toolset,
    execute_tool,
)
from app.agents.tools import ALL_TOOLS

_PERSONAL_ACTIONS = {
    "save_note",
    "summarize_and_save_note",
    "create_calendar_event",
    "create_todo",
}


def _assert_raises(exc_type, fn):
    try:
        fn()
    except exc_type:
        return
    raise AssertionError(f"expected {exc_type.__name__}")


def _fake_tool(name: str, fn):
    return StructuredTool.from_function(func=fn, name=name, description="test tool")


def test_registry_covers_all_langchain_tools():
    assert set(DEFAULT_REGISTRY.names()) == {tool.name for tool in ALL_TOOLS}
    assert len(DEFAULT_REGISTRY.specs()) == len(ALL_TOOLS)
    # 配置本身必须能通过校验（缺工具、重复意图都会在这里报错）
    validate_skills()


def test_question_answer_has_zero_tools():
    skill = resolve_skill("question-answer")
    assert skill.name == "general-answer"
    assert skill.tools == ()

    toolset = build_governed_toolset("question-answer")
    assert toolset.tools == []
    assert toolset.budget.max_total_calls == 0


def test_intent_policy_is_not_all_tools():
    course = build_governed_toolset("course-recommend", user_id=42)
    assert set(course.tool_names) == {
        "recommend_next_videos",
        "search_videos",
        "search_video_titles",
        "get_video_summary",
    } | _PERSONAL_ACTIONS
    assert "get_learning_profile" not in course.tool_names
    assert "search_notes" not in course.tool_names

    knowledge = build_governed_toolset("knowledge-qa")
    assert set(knowledge.tool_names) == {
        "search_videos",
        "search_video_titles",
        "get_video_summary",
    }

    review = build_governed_toolset("study-summary", user_id=42)
    assert "get_learning_profile" in review.tool_names
    assert "search_videos" not in review.tool_names
    assert set(review.tool_names) == {
        "get_learning_profile",
        "get_recent_activity",
        "get_my_learning_path",
        "get_learning_goal",
    } | _PERSONAL_ACTIONS

    interview = build_governed_toolset("interview-question")
    assert set(interview.tool_names) == {
        "get_interview_question",
        "search_interview_questions",
        "search_interview_knowledge",
        "search_videos",
        "get_video_summary",
    }


def test_unknown_intent_falls_back_to_conservative_search():
    toolset = build_governed_toolset(None)
    assert toolset.skill.name == "fallback"
    assert set(toolset.tool_names) == {
        "search_videos",
        "search_video_titles",
        "get_video_summary",
    }


def test_login_only_tools_are_filtered_for_anonymous_requests():
    anonymous = build_governed_toolset("study-summary", user_id=None)
    assert anonymous.tool_names == ()
    assert anonymous.budget.max_total_calls == 0

    logged_in = build_governed_toolset("study-summary", user_id=42)
    assert set(logged_in.tool_names) == {
        "get_learning_profile",
        "get_recent_activity",
        "get_my_learning_path",
        "get_learning_goal",
    } | _PERSONAL_ACTIONS


def test_personal_action_tools_only_attach_to_logged_in_users():
    anonymous = build_governed_toolset(None, user_id=None)
    assert not (_PERSONAL_ACTIONS & set(anonymous.tool_names))

    logged_in = build_governed_toolset(None, user_id=42)
    assert set(logged_in.tool_names) == {
        "search_videos",
        "search_video_titles",
        "get_video_summary",
    } | _PERSONAL_ACTIONS
    for name in _PERSONAL_ACTIONS:
        assert logged_in.budget.max_calls_per_tool[name] == 1
    assert logged_in.budget.max_write_calls == 1


def test_all_known_intents_are_bound_exactly_once():
    known = {
        "course-recommend",
        "knowledge-qa",
        "question-answer",
        "learning-path",
        "study-summary",
        "coding-helper",
        "task-planning",
        "note-save",
        "interview-question",
    }
    bound = [intent for skill in SKILLS for intent in skill.intents]
    assert set(bound) == known
    assert len(bound) == len(set(bound))


def test_governed_tool_keeps_schema_and_adds_metadata():
    raw = DEFAULT_REGISTRY.get("search_videos")
    toolset = build_governed_toolset("knowledge-qa")
    wrapped = next(tool for tool in toolset.tools if tool.name == "search_videos")

    assert wrapped.args_schema == raw.args_schema
    assert wrapped.metadata["governed"] is True
    assert wrapped.metadata["skill"] == "knowledge-lookup"
    assert wrapped.metadata["tool_version"] == "1.0.0"


def test_budget_enforces_per_tool_and_total_limits():
    budget = ToolBudget(max_total_calls=2, max_calls_per_tool={"search_videos": 1})
    budget.reserve("search_videos")
    _assert_raises(ToolBudgetExceeded, lambda: budget.reserve("search_videos"))
    assert budget.total_used == 1

    budget2 = ToolBudget(max_total_calls=1, max_calls_per_tool={"a": 1, "b": 1})
    budget2.reserve("a")
    _assert_raises(ToolBudgetExceeded, lambda: budget2.reserve("b"))


def test_only_one_write_action_per_turn():
    budget = ToolBudget(
        max_total_calls=5,
        max_calls_per_tool={"save_note": 1, "create_todo": 1},
        max_write_calls=1,
    )
    budget.reserve("save_note", is_write=True)
    assert budget.write_used == 1
    _assert_raises(
        ToolBudgetExceeded,
        lambda: budget.reserve("create_todo", is_write=True),
    )
    # 读工具不受写预算影响；写预算耗尽只拦写动作。
    budget.reserve("search_videos", is_write=False)
    assert budget.write_used == 1


def test_execute_tool_success_and_truncation():
    def fake() -> str:
        return "x" * 100

    tool = _fake_tool("fake_long", fake)
    spec = ToolSpec(
        name="fake_long",
        version="1.0.0",
        scopes=("test",),
        timeout_s=1.0,
        max_calls_per_turn=1,
        max_result_chars=20,
    )
    registry = ToolRegistry([tool], {"fake_long": spec})
    budget = ToolBudget(1, {"fake_long": 1})
    text = execute_tool(tool, spec, budget, "test-skill", {})

    assert text.startswith("x" * 20)
    assert "结果已截断" in text


def test_execute_tool_returns_normalized_timeout_error():
    def slow() -> str:
        time.sleep(0.15)
        return "too late"

    tool = _fake_tool("fake_slow", slow)
    spec = ToolSpec(
        name="fake_slow",
        version="1.0.0",
        scopes=("test",),
        timeout_s=0.03,
        max_calls_per_turn=1,
    )
    budget = ToolBudget(1, {"fake_slow": 1})
    text = execute_tool(tool, spec, budget, "test-skill", {})

    assert text.startswith("Error:")
    assert "超时" in text


def test_execute_tool_normalizes_and_redacts_exception():
    def boom() -> str:
        raise ValueError("bad key sk-secret-value")

    tool = _fake_tool("fake_boom", boom)
    spec = ToolSpec(
        name="fake_boom",
        version="1.0.0",
        scopes=("test",),
        timeout_s=1.0,
        max_calls_per_turn=1,
    )
    budget = ToolBudget(1, {"fake_boom": 1})
    text = execute_tool(tool, spec, budget, "test-skill", {})

    assert text.startswith("Error:")
    assert "sk-***" in text
    assert "secret-value" not in text


def test_execute_tool_returns_budget_error_without_running():
    calls = {"count": 0}

    def counted() -> str:
        calls["count"] += 1
        return "ran"

    tool = _fake_tool("fake_budget", counted)
    spec = ToolSpec(
        name="fake_budget",
        version="1.0.0",
        scopes=("test",),
        timeout_s=1.0,
        max_calls_per_turn=1,
    )
    budget = ToolBudget(0, {"fake_budget": 1})
    text = execute_tool(tool, spec, budget, "test-skill", {})

    assert text.startswith("Error:")
    assert "预算" in text
    assert calls["count"] == 0


def test_disabled_tool_stays_registered_but_is_not_bound():
    """ToolSpec.enabled=False 只影响挂载，不要求同时删 ALL_TOOLS/元数据。"""
    tool = _fake_tool("fake_disabled", lambda: "should not run")
    spec = ToolSpec(
        name="fake_disabled",
        version="1.0.0",
        scopes=("test",),
        timeout_s=1.0,
        max_calls_per_turn=1,
        enabled=False,
    )
    registry = ToolRegistry([tool], {"fake_disabled": spec})
    assert registry.names() == ("fake_disabled",)

    import app.agents.skills as skills_module

    old_skills = skills_module.SKILLS
    skills_module.SKILLS = (
        SkillSpec(
            name="test-disabled",
            version="1.0.0",
            description="test",
            intents=("test-disabled",),
            tools=("fake_disabled",),
        ),
    )
    try:
        toolset = build_governed_toolset("test-disabled", registry=registry)
        assert toolset.tool_names == ()
        assert toolset.tools == []
        assert toolset.budget.max_total_calls == 0
    finally:
        skills_module.SKILLS = old_skills


def test_metrics_capture_latency_and_outcomes():
    METRICS.reset()

    def ok() -> str:
        return "ok"

    tool = _fake_tool("fake_metric", ok)
    spec = ToolSpec(
        name="fake_metric",
        version="1.0.0",
        scopes=("test",),
        timeout_s=1.0,
        max_calls_per_turn=1,
    )
    budget = ToolBudget(1, {"fake_metric": 1})
    execute_tool(tool, spec, budget, "test-skill", {})

    snapshot = METRICS.snapshot("fake_metric")
    assert snapshot["requests"] == 1
    assert snapshot["calls"] == 1
    assert snapshot["successes"] == 1
    assert snapshot["failures"] == 0
    assert snapshot["latency_ms"]["p95"] is not None


def test_metrics_capture_timeout_and_failure():
    METRICS.reset()
    BREAKER.reset()

    def slow() -> str:
        time.sleep(0.15)
        return "too late"

    tool = _fake_tool("fake_metric_timeout", slow)
    spec = ToolSpec(
        name="fake_metric_timeout",
        version="1.0.0",
        scopes=("test",),
        timeout_s=0.03,
        max_calls_per_turn=1,
        max_retries=0,
    )
    budget = ToolBudget(1, {"fake_metric_timeout": 1})
    try:
        text = execute_tool(tool, spec, budget, "test-skill", {})
        assert "超时" in text
        snapshot = METRICS.snapshot("fake_metric_timeout")
        assert snapshot["requests"] == 1
        assert snapshot["calls"] == 1
        assert snapshot["failures"] == 1
        assert snapshot["timeouts"] == 1
    finally:
        BREAKER.reset()
        METRICS.reset()


def test_breaker_opens_and_short_circuits_after_threshold():
    BREAKER.reset()
    METRICS.reset()
    calls = {"count": 0}

    def boom() -> str:
        calls["count"] += 1
        raise RuntimeError("upstream down")

    tool = _fake_tool("fake_cb", boom)
    spec = ToolSpec(
        name="fake_cb",
        version="1.0.0",
        scopes=("test",),
        timeout_s=1.0,
        max_calls_per_turn=10,
        breaker_failures=2,
        breaker_cooldown_s=0.05,
    )
    budget = ToolBudget(10, {"fake_cb": 10})
    try:
        for _ in range(2):
            text = execute_tool(tool, spec, budget, "test-skill", {})
            assert text.startswith("Error:")
        assert calls["count"] == 2

        blocked = execute_tool(tool, spec, budget, "test-skill", {})
        assert "熔断" in blocked
        assert calls["count"] == 2
        assert METRICS.snapshot("fake_cb")["circuit_open_rejections"] == 1

        time.sleep(0.06)
        execute_tool(tool, spec, budget, "test-skill", {})
        assert calls["count"] == 3
    finally:
        BREAKER.reset()
        METRICS.reset()


def test_late_search_hits_are_dropped_after_timeout_token():
    class Hit:
        def __init__(self, segment_id: int):
            self.segment_id = segment_id
            self.video_id = 1
            self.start_sec = 0.0

    begin_search_trace()
    record_search_hits([Hit(1)])
    assert len(take_search_hits()) == 1

    token = ToolCallToken(active=False)
    ctx_token = set_call_token(token)
    try:
        record_search_hits([Hit(2)])
        assert len(take_search_hits()) == 1
    finally:
        reset_call_token(ctx_token)
