"""能力包（Skill）注册表：把「意图 -> 可用工具组合」变成显式配置。

这里的 Skill 不是外部的 SKILL.md，也不是插件市场；它是一个轻量能力包：
- 绑定一组意图；
- 绑定一组已注册工具；
- 声明本包单轮最多能调几次工具；
- 有版本与启用开关。

当前项目真正的能力路由来自前端 `detectIntent()` 的 7 种意图 + null。
后端不再「除问题解答外全量挂 9 个工具」，而是按包取工具。
"""

from __future__ import annotations

from dataclasses import dataclass

from app.agents.tool_registry import DEFAULT_REGISTRY, ToolRegistry


class SkillRegistryError(RuntimeError):
    pass


@dataclass(frozen=True)
class SkillSpec:
    """一个能力包的管理元数据。"""

    name: str
    version: str
    description: str
    intents: tuple[str, ...]
    tools: tuple[str, ...]
    max_total_tool_calls: int = 4
    enabled: bool = True


SKILLS: tuple[SkillSpec, ...] = (
    SkillSpec(
        name="general-answer",
        version="1.0.0",
        description="纯知识/代码讲解，正文不依赖本地视频库，不挂检索工具。",
        intents=("question-answer",),
        tools=(),
        max_total_tool_calls=0,
    ),
    SkillSpec(
        name="knowledge-lookup",
        version="1.0.0",
        description="在本地视频库里找某节课、某个片段或某个视频的摘要。",
        intents=("knowledge-qa",),
        tools=(
            "search_videos",
            "search_video_titles",
            "get_video_summary",
        ),
        max_total_tool_calls=4,
    ),
    SkillSpec(
        name="course-discovery",
        version="1.0.0",
        description="用户明确要课程/视频推荐时，先看学习目标，再检索候选。",
        intents=("course-recommend",),
        tools=(
            "recommend_next_videos",
            "search_videos",
            "search_video_titles",
            "get_video_summary",
        ),
        max_total_tool_calls=4,
    ),
    SkillSpec(
        name="learning-review",
        version="1.0.0",
        description="复盘学习情况：画像、最近活动、当前路径与目标。",
        intents=("study-summary",),
        tools=(
            "get_learning_profile",
            "get_recent_activity",
            "get_my_learning_path",
            "get_learning_goal",
        ),
        max_total_tool_calls=4,
    ),
    SkillSpec(
        name="learning-planning",
        version="1.0.0",
        description="制定或调整学习路径，基于已有目标和路径做增量规划。",
        intents=("learning-path",),
        tools=(
            "get_learning_goal",
            "get_my_learning_path",
            "recommend_next_videos",
            "search_videos",
        ),
        max_total_tool_calls=4,
    ),
    SkillSpec(
        name="coding-helper",
        version="1.0.0",
        description="具体代码问题：优先本地视频讲解，其次历史笔记。",
        intents=("coding-helper",),
        tools=(
            "search_videos",
            "search_video_titles",
            "search_notes",
        ),
        max_total_tool_calls=4,
    ),
    SkillSpec(
        name="task-planning",
        version="1.0.0",
        description="把学习任务拆成可执行步骤，读取目标与路径，必要时参考笔记。",
        intents=("task-planning",),
        tools=(
            "get_learning_goal",
            "get_my_learning_path",
            "search_notes",
        ),
        max_total_tool_calls=3,
    ),
    SkillSpec(
        name="interview-coach",
        version="1.0.0",
        description="站在面试题库页上讲解当前题目、检索同类题与知识库，并按需推荐站内视频。",
        intents=("interview-question",),
        tools=(
            "get_interview_question",
            "search_interview_questions",
            "search_interview_knowledge",
            "search_videos",
            "get_video_summary",
        ),
        max_total_tool_calls=5,
    ),
    SkillSpec(
        name="note-library",
        version="1.0.0",
        description="用户明确要求保存当前笔记，或总结后另存为私人笔记。",
        intents=("note-save",),
        tools=("save_note", "summarize_and_save_note"),
        max_total_tool_calls=2,
    ),
    SkillSpec(
        name="fallback",
        version="1.0.0",
        description="意图为空或无法识别时的保守能力包：只允许只读检索。",
        intents=(),
        tools=(
            "search_videos",
            "search_video_titles",
            "get_video_summary",
        ),
        max_total_tool_calls=3,
    ),
)


FALLBACK_SKILL = SKILLS[-1]


def resolve_skill(intent: str | None) -> SkillSpec:
    """按意图解析能力包；未知意图走保守兜底。"""
    normalized = (intent or "").strip()
    for skill in SKILLS:
        if skill.enabled and normalized in skill.intents:
            return skill
    return FALLBACK_SKILL


def list_skills() -> tuple[SkillSpec, ...]:
    return tuple(skill for skill in SKILLS if skill.enabled)


def validate_skills(registry: ToolRegistry = DEFAULT_REGISTRY) -> None:
    """启动/测试时校验配置，避免意图绑定到不存在的工具。"""
    names = {skill.name for skill in SKILLS}
    if len(names) != len(SKILLS):
        raise SkillRegistryError("Skill 名称重复")

    intent_owner: dict[str, str] = {}
    for skill in SKILLS:
        if not skill.enabled:
            continue
        for intent in skill.intents:
            if intent in intent_owner:
                raise SkillRegistryError(
                    f"意图 {intent} 同时绑定到 {intent_owner[intent]} 和 {skill.name}"
                )
            intent_owner[intent] = skill.name

        for tool_name in skill.tools:
            if tool_name not in registry.names():
                raise SkillRegistryError(
                    f"Skill {skill.name} 绑定了未注册工具 {tool_name}"
                )
            # 已禁用工具仍允许留在 Skill 声明里：build_governed_toolset
            # 会在运行时按 ToolSpec.enabled 过滤，便于临时启停而不改绑定。

    if resolve_skill("question-answer").tools:
        raise SkillRegistryError("question-answer 必须是零工具能力包")


validate_skills()
