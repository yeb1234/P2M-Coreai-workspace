"""工具注册表：把「Python 里有哪些 @tool」变成可校验的工具清单。

设计目标
--------
- 每个工具必须有元数据，不能只靠函数名和 docstring；
- 工具清单和权限/超时/预算/版本集中在一处，增删工具不再靠翻 `ALL_TOOLS`；
- 启动时校验「工具函数」和「元数据」一一对应，漏注册直接报错，避免悄悄多挂一个工具。

这不是重型插件系统：工具仍然是 Python 函数，注册表只负责发现、校验和取用。
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from langchain_core.tools import BaseTool

from app.agents.tools import ALL_TOOLS


class ToolRegistryError(RuntimeError):
    pass


@dataclass(frozen=True)
class ToolSpec:
    """一个工具的管理元数据。"""

    name: str
    version: str
    scopes: tuple[str, ...]
    timeout_s: float
    max_calls_per_turn: int
    max_retries: int = 0
    max_result_chars: int = 6000
    enabled: bool = True
    requires_login: bool = False
    read_only: bool = True
    # 连续失败多少次后熔断，以及冷却多久。0 表示关闭熔断。
    breaker_failures: int = 5
    breaker_cooldown_s: float = 60.0
    tags: tuple[str, ...] = ()


TOOL_SPECS: dict[str, ToolSpec] = {
    "search_videos": ToolSpec(
        name="search_videos",
        version="1.0.0",
        scopes=("library:read",),
        timeout_s=20.0,
        max_calls_per_turn=2,
        max_retries=1,
        max_result_chars=5000,
        tags=("retrieval", "hybrid"),
    ),
    "search_video_titles": ToolSpec(
        name="search_video_titles",
        version="1.0.0",
        scopes=("library:read",),
        timeout_s=8.0,
        max_calls_per_turn=2,
        max_retries=1,
        max_result_chars=3000,
        tags=("retrieval", "title"),
    ),
    "get_video_summary": ToolSpec(
        name="get_video_summary",
        version="1.0.0",
        scopes=("library:read",),
        timeout_s=8.0,
        max_calls_per_turn=2,
        max_result_chars=3000,
        tags=("library", "summary"),
    ),
    "get_learning_profile": ToolSpec(
        name="get_learning_profile",
        version="1.0.0",
        scopes=("profile:read",),
        timeout_s=10.0,
        max_calls_per_turn=1,
        max_result_chars=3000,
        requires_login=True,
        tags=("learning", "profile"),
    ),
    "get_recent_activity": ToolSpec(
        name="get_recent_activity",
        version="1.0.0",
        scopes=("profile:read",),
        timeout_s=10.0,
        max_calls_per_turn=1,
        max_result_chars=3000,
        requires_login=True,
        tags=("learning", "activity"),
    ),
    "get_lite_learning_status": ToolSpec(
        name="get_lite_learning_status",
        version="1.0.0",
        scopes=("profile:read", "learning:read"),
        timeout_s=12.0,
        max_calls_per_turn=1,
        max_result_chars=5000,
        requires_login=True,
        tags=("lite", "learning", "activity", "review"),
    ),
    "get_learning_goal": ToolSpec(
        name="get_learning_goal",
        version="1.0.0",
        scopes=("learning:read",),
        timeout_s=8.0,
        max_calls_per_turn=1,
        max_result_chars=3000,
        requires_login=True,
        tags=("learning", "goal"),
    ),
    "get_my_learning_path": ToolSpec(
        name="get_my_learning_path",
        version="1.0.0",
        scopes=("learning:read",),
        timeout_s=8.0,
        max_calls_per_turn=1,
        max_result_chars=4000,
        requires_login=True,
        tags=("learning", "path"),
    ),
    "recommend_next_videos": ToolSpec(
        name="recommend_next_videos",
        version="1.0.0",
        scopes=("library:read", "profile:read", "learning:read"),
        timeout_s=20.0,
        max_calls_per_turn=1,
        max_result_chars=3000,
        requires_login=True,
        tags=("learning", "recommend"),
    ),
    "search_notes": ToolSpec(
        name="search_notes",
        version="1.0.0",
        scopes=("notes:read",),
        timeout_s=8.0,
        max_calls_per_turn=1,
        max_result_chars=3000,
        requires_login=True,
        tags=("notes", "search"),
    ),
    "save_note": ToolSpec(
        name="save_note",
        version="1.0.0",
        scopes=("notes:write",),
        timeout_s=12.0,
        max_calls_per_turn=1,
        max_result_chars=2000,
        requires_login=True,
        read_only=False,
        tags=("notes", "write"),
    ),
    "summarize_and_save_note": ToolSpec(
        name="summarize_and_save_note",
        version="1.0.0",
        scopes=("notes:write", "notes:ai"),
        timeout_s=70.0,
        max_calls_per_turn=1,
        max_result_chars=5000,
        requires_login=True,
        read_only=False,
        tags=("notes", "ai", "write"),
    ),
    "create_calendar_event": ToolSpec(
        name="create_calendar_event",
        version="1.0.0",
        scopes=("calendar:write",),
        timeout_s=12.0,
        max_calls_per_turn=1,
        max_result_chars=2000,
        requires_login=True,
        read_only=False,
        tags=("calendar", "write"),
    ),
    "create_todo": ToolSpec(
        name="create_todo",
        version="1.0.0",
        scopes=("todo:write",),
        timeout_s=12.0,
        max_calls_per_turn=1,
        max_result_chars=2500,
        requires_login=True,
        read_only=False,
        tags=("todo", "write", "single-block"),
    ),
    "search_interview_questions": ToolSpec(
        name="search_interview_questions",
        version="1.0.0",
        scopes=("interview:read",),
        timeout_s=8.0,
        max_calls_per_turn=2,
        max_result_chars=5000,
        tags=("interview", "question-bank", "retrieval"),
    ),
    "get_interview_question": ToolSpec(
        name="get_interview_question",
        version="1.0.0",
        scopes=("interview:read",),
        timeout_s=8.0,
        max_calls_per_turn=2,
        max_result_chars=7000,
        tags=("interview", "question-bank", "detail"),
    ),
    "search_interview_knowledge": ToolSpec(
        name="search_interview_knowledge",
        version="1.0.0",
        scopes=("interview:read", "knowledge:read"),
        timeout_s=8.0,
        max_calls_per_turn=2,
        max_result_chars=7000,
        tags=("interview", "knowledge-base", "retrieval"),
    ),
    "ask_user": ToolSpec(
        name="ask_user",
        version="1.0.0",
        scopes=("chat:human",),
        timeout_s=1.0,
        max_calls_per_turn=1,
        max_result_chars=1000,
        tags=("human-in-the-loop", "clarify", "confirm"),
    ),
}


class ToolRegistry:
    """工具对象与 ToolSpec 的双向索引。"""

    def __init__(
        self,
        tools: Iterable[BaseTool],
        specs: Mapping[str, ToolSpec],
    ) -> None:
        self._tools: dict[str, BaseTool] = {}
        self._specs: dict[str, ToolSpec] = {}

        for tool in tools:
            name = getattr(tool, "name", None)
            if not name:
                raise ToolRegistryError("工具缺少 name")
            if name in self._tools:
                raise ToolRegistryError(f"工具重复注册: {name}")
            spec = specs.get(name)
            if spec is None:
                raise ToolRegistryError(
                    f"工具 {name} 没有 ToolSpec；新增工具必须同时补元数据"
                )
            # 保留 disabled 工具：注册表负责“知道它存在”，是否挂给模型由
            # build_governed_toolset 按 spec.enabled 过滤。这样启停只需要改
            # 一处开关，不必同时删 ALL_TOOLS 和 ToolSpec。
            self._tools[name] = tool
            self._specs[name] = spec

        missing = sorted(set(specs) - set(self._tools))
        if missing:
            raise ToolRegistryError(
                "以下 ToolSpec 找不到对应工具: " + ", ".join(missing)
            )

    def get(self, name: str) -> BaseTool:
        try:
            return self._tools[name]
        except KeyError as exc:
            raise ToolRegistryError(f"未注册工具: {name}") from exc

    def spec(self, name: str) -> ToolSpec:
        try:
            return self._specs[name]
        except KeyError as exc:
            raise ToolRegistryError(f"未注册工具: {name}") from exc

    def names(self) -> tuple[str, ...]:
        return tuple(self._tools)

    def specs(self) -> tuple[ToolSpec, ...]:
        return tuple(self._specs[name] for name in self._tools)


DEFAULT_REGISTRY = ToolRegistry(ALL_TOOLS, TOOL_SPECS)
