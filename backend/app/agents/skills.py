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
from app.database import settings


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


# P2 Lite 的能力包：没有视频库、视频检索和路径规划。
# 保留三类真实价值：面试题学习、笔记检索、个人动作（待办/日历/笔记）。
LITE_SKILLS: tuple[SkillSpec, ...] = (
    SkillSpec(
        name="lite-general-answer",
        version="1.0.0",
        description="纯知识/代码/职业问题，直接回答，不依赖视频库或向量检索。",
        intents=(
            "question-answer",
            "knowledge-qa",
            "course-recommend",
            "learning-path",
        ),
        tools=(),
        max_total_tool_calls=0,
    ),
    SkillSpec(
        name="lite-study-review",
        version="1.0.0",
        description="基于 Lite 站内 Todo、日历、笔记、面试练习和使用痕迹，评价最近学习状态。",
        intents=("study-summary",),
        tools=("get_lite_learning_status",),
        max_total_tool_calls=1,
    ),
    SkillSpec(
        name="lite-coding-helper",
        version="1.0.0",
        description="代码问题优先查私人笔记，不查视频。",
        intents=("coding-helper",),
        tools=("search_notes",),
        max_total_tool_calls=2,
    ),
    SkillSpec(
        name="lite-task-planning",
        version="1.0.0",
        description="把学习任务拆成步骤，结合笔记与个人动作落地。",
        intents=("task-planning",),
        tools=("search_notes",),
        max_total_tool_calls=2,
    ),
    SkillSpec(
        name="lite-interview-coach",
        version="1.0.0",
        description="讲解当前面试题、检索同类题与知识库，不推荐站内视频。",
        intents=("interview-question",),
        tools=(
            "get_interview_question",
            "search_interview_questions",
            "search_interview_knowledge",
        ),
        max_total_tool_calls=5,
    ),
    SkillSpec(
        name="lite-note-library",
        version="1.0.0",
        description="保存当前笔记，或总结后另存为私人笔记。",
        intents=("note-save",),
        tools=("save_note", "summarize_and_save_note"),
        max_total_tool_calls=2,
    ),
    SkillSpec(
        name="lite-fallback",
        version="1.0.0",
        description="未识别意图时的保守能力包：只允许查私人笔记与面试题。",
        intents=(),
        tools=(
            "search_notes",
            "search_interview_questions",
            "get_interview_question",
            "search_interview_knowledge",
        ),
        max_total_tool_calls=3,
    ),
)

LITE_FALLBACK_SKILL = LITE_SKILLS[-1]


def _active_skills() -> tuple[SkillSpec, ...]:
    return LITE_SKILLS if settings.is_lite else SKILLS


def resolve_skill(intent: str | None) -> SkillSpec:
    """按意图解析能力包；Lite 与完整版走各自的白名单。"""
    normalized = (intent or "").strip()
    for skill in _active_skills():
        if skill.enabled and normalized in skill.intents:
            return skill
    return LITE_FALLBACK_SKILL if settings.is_lite else FALLBACK_SKILL


def list_skills() -> tuple[SkillSpec, ...]:
    return tuple(skill for skill in _active_skills() if skill.enabled)


def _validate_skill_set(skills: tuple[SkillSpec, ...], registry: ToolRegistry) -> None:
    names = {skill.name for skill in skills}
    if len(names) != len(skills):
        raise SkillRegistryError("Skill 名称重复")

    intent_owner: dict[str, str] = {}
    for skill in skills:
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

    if resolve_skill("question-answer").tools:
        raise SkillRegistryError("question-answer 必须是零工具能力包")


def validate_skills(registry: ToolRegistry = DEFAULT_REGISTRY) -> None:
    """启动/测试时校验配置，避免意图绑定到不存在的工具。"""
    _validate_skill_set(SKILLS, registry)
    _validate_skill_set(LITE_SKILLS, registry)


validate_skills()
