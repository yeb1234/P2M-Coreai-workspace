"""P2 Lite profile 的后端边界测试。

不连库、不起 worker：只验证 profile 切换后能力包与 Redis 命名空间
不会退回完整版的视频/检索口径。
"""

from __future__ import annotations

import pytest

from app.agents.skills import (
    LITE_FALLBACK_SKILL,
    LITE_SKILLS,
    list_skills,
    resolve_skill,
    validate_skills,
)
from app.agents.tool_runtime import PERSONAL_ACTION_TOOLS
from app.database import settings
from app.mcp import registry as mcp_registry
from app.routers.assistant import get_capabilities
from app.services.admin_health import backend_health
from app.services.redis_keys import p2_key


@pytest.fixture()
def lite_profile(monkeypatch):
    monkeypatch.setattr(settings, "app_profile", "lite")
    yield
    monkeypatch.setattr(settings, "app_profile", "full")


def test_lite_profile_switch(lite_profile):
    assert settings.is_lite is True
    assert settings.normalized_app_profile == "lite"


def test_lite_skills_replace_video_skills(lite_profile):
    assert list_skills() == LITE_SKILLS
    assert resolve_skill("question-answer").name == "lite-general-answer"
    assert resolve_skill("study-summary").name == "lite-study-review"
    assert resolve_skill("interview-question").name == "lite-interview-coach"
    assert resolve_skill(None) == LITE_FALLBACK_SKILL


def test_lite_skill_packages_validate():
    # 两套 Skill 都必须在同一个工具注册表里可用
    validate_skills()


def test_lite_capabilities_only_expose_runtime_tools(lite_profile):
    capabilities = get_capabilities(None)
    names = {tool["name"] for tool in capabilities["tools"]}
    skills = {skill["name"] for skill in capabilities["skills"]}

    assert "search_videos" not in names
    assert "get_learning_profile" not in names
    assert "get_lite_learning_status" in names
    assert "create_todo" in names
    assert "create_calendar_event" in names
    assert "ask_user" in names
    # 个人动作工具在任何登录用户的能力包里都可用
    assert set(PERSONAL_ACTION_TOOLS) <= names
    assert skills == {skill.name for skill in LITE_SKILLS}
    assert "Lite" in capabilities["base_prompt"]


def test_full_capabilities_keep_video_tools(monkeypatch):
    monkeypatch.setattr(settings, "app_profile", "full")
    capabilities = get_capabilities(None)
    names = {tool["name"] for tool in capabilities["tools"]}
    assert "search_videos" in names
    assert "get_learning_profile" in names


def test_lite_mcp_hides_full_only_tools(lite_profile):
    names = {tool["name"] for tool in mcp_registry.list_tools()}
    assert "search_videos" not in names
    assert "get_learning_profile" not in names
    assert "note_create" in names
    assert "todo_create" in names
    assert "calendar_create" in names
    assert "get_lite_learning_status" in names
    assert "search_notes" in names

    with pytest.raises(KeyError, match="Lite profile"):
        mcp_registry.call_tool("search_videos", {}, user_id=1)


def test_full_mcp_keeps_video_tools(monkeypatch):
    monkeypatch.setattr(settings, "app_profile", "full")
    names = {tool["name"] for tool in mcp_registry.list_tools()}
    assert "search_videos" in names
    assert "get_learning_profile" in names


def test_lite_health_uses_lite_boundary(lite_profile):
    result = backend_health()
    names = {check["name"] for check in result["checks"]}
    assert "数据库" in names
    assert "LLM 配置" in names
    assert "站内数据" in names
    assert "Lite 能力边界" in names
    assert "CUDA / GPU" not in names
    assert "whisper.cpp 模型" not in names
    assert "视频库" not in names


def test_redis_key_prefix_default(lite_profile, monkeypatch):
    monkeypatch.setattr(settings, "redis_key_prefix", "p2:")
    assert p2_key("queue:ai_jobs") == "p2:queue:ai_jobs"
    assert p2_key(":queue:background") == "p2:queue:background"
