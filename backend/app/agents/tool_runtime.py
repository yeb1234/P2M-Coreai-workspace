"""统一工具执行包装：预算、超时、重试、错误归一化、结果截断与审计。

设计边界
--------
- 工具仍然是 LangChain `StructuredTool`，不改变模型看到的 schema；
- 每个请求按 Skill 生成一组 governed tools，预算对象随工具闭包走，
  不依赖 ContextVar 跨线程传播；
- 超时使用线程 future 的 `result(timeout=...)`。Python 不能强杀线程，
  所以超时后底层调用可能继续跑；搜索命中通过 `ToolCallToken` 丢弃，
  不会污染已经返回的回答。
"""

from __future__ import annotations

import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from contextvars import copy_context
from dataclasses import dataclass, field

from langchain_core.tools import BaseTool, StructuredTool

from app.agents.skills import SkillSpec, resolve_skill
from app.agents.tool_context import (
    ToolCallToken,
    reset_call_token,
    set_call_token,
)
from app.agents.tool_metrics import BREAKER, METRICS
from app.agents.tool_registry import DEFAULT_REGISTRY, ToolRegistry, ToolSpec

logger = logging.getLogger(__name__)

_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="tool-governed")

# 个人动作工具不再按意图发放。
#
# 旧实现只有 note-save 意图才挂 save_note，于是这种自然对话会断：
# 助手问「要不要把排期存成笔记」，用户回「可以」——detectIntent(可以)=None，
# 落到 fallback，save_note 根本不在工具列表里。模型仍然按提示词说
# 「确认卡应该弹出来了」，但没有任何工具调用，用户既看不到卡也没落库。
#
# 现在只要登录，就给所有能力包附加这一组写工具。写动作是否执行仍由
# 确认闸门、每轮 1 次写预算和审计表三道约束兜底。
PERSONAL_ACTION_TOOLS = (
    "save_note",
    "summarize_and_save_note",
    "create_calendar_event",
    "create_todo",
)


class ToolBudgetExceeded(RuntimeError):
    pass


@dataclass
class ToolBudget:
    """单轮工具调用预算，线程安全。"""

    max_total_calls: int
    max_calls_per_tool: dict[str, int] = field(default_factory=dict)
    # 写动作不分工具名，整轮共用一个额度。否则模型可以 save_note + calendar + todo
    # 在同一个确认里连续写三次，用户看到的是一张卡、实际落三处数据。
    max_write_calls: int = 1
    _total: int = field(default=0, init=False)
    _per_tool: dict[str, int] = field(default_factory=dict, init=False)
    _writes: int = field(default=0, init=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)

    def reserve(self, tool_name: str, *, is_write: bool = False) -> None:
        with self._lock:
            if self._total >= self.max_total_calls:
                raise ToolBudgetExceeded(
                    f"本轮工具总预算 {self.max_total_calls} 次已用完"
                )
            limit = self.max_calls_per_tool.get(tool_name, 1)
            used = self._per_tool.get(tool_name, 0)
            if used >= limit:
                raise ToolBudgetExceeded(
                    f"工具 {tool_name} 本轮最多调用 {limit} 次"
                )
            if is_write and self._writes >= self.max_write_calls:
                raise ToolBudgetExceeded(
                    "本轮最多执行 1 个写动作；需要再改一处请下一轮重新确认"
                )
            self._total += 1
            self._per_tool[tool_name] = used + 1
            if is_write:
                self._writes += 1

    @property
    def total_used(self) -> int:
        with self._lock:
            return self._total

    @property
    def write_used(self) -> int:
        with self._lock:
            return self._writes

    @property
    def remaining(self) -> int:
        with self._lock:
            return max(0, self.max_total_calls - self._total)


@dataclass
class GovernedToolSet:
    skill: SkillSpec
    budget: ToolBudget
    tools: list[BaseTool]
    tool_names: tuple[str, ...]


def build_governed_toolset(
    intent: str | None,
    *,
    user_id: int | None = None,
    allow_writes: bool = True,
    registry: ToolRegistry = DEFAULT_REGISTRY,
) -> GovernedToolSet:
    """按意图解析 Skill，并生成带预算的工具列表。

    `requires_login=True` 的工具在匿名请求里会被过滤掉：例如学习画像、
    学习路径、推荐、笔记都依赖当前用户，不能在没有用户上下文时读到别人的数据。

    `allow_writes=False` 用于没有 HITL 确认能力的同步接口：只挂只读工具，
    避免模型在用户看不到确认卡的情况下写入个人数据。

    登录用户额外获得一组个人动作工具（笔记 / 日历 / Todo）。它们不绑意图，
    否则「可以」这类承接上文的短回答会因为意图识别为空而拿不到写工具。
    """
    skill = resolve_skill(intent)
    allowed_names = [
        name
        for name in skill.tools
        if registry.spec(name).enabled
        and (allow_writes or registry.spec(name).read_only)
        and (not registry.spec(name).requires_login or user_id is not None)
    ]
    if user_id is not None and allow_writes:
        for name in PERSONAL_ACTION_TOOLS:
            if name in allowed_names:
                continue
            spec = registry.spec(name)
            if spec.enabled and (not spec.requires_login or user_id is not None):
                allowed_names.append(name)
    per_tool = {
        name: registry.spec(name).max_calls_per_turn for name in allowed_names
    }
    base_total = min(
        skill.max_total_tool_calls,
        sum(
            registry.spec(name).max_calls_per_turn
            for name in skill.tools
            if name in allowed_names
        ) if skill.tools else 0,
    )
    # 个人动作只占一个额外槽位：写预算本身限制 1 次，不需要给 4 个工具各加一次。
    has_personal_actions = any(name in allowed_names for name in PERSONAL_ACTION_TOOLS)
    max_total = base_total + (1 if has_personal_actions else 0)
    if has_personal_actions and max_total < 1:
        max_total = 1
    budget = ToolBudget(
        max_total_calls=max_total,
        max_calls_per_tool=per_tool,
        max_write_calls=1,
    )
    tools = [
        _govern_tool(registry.get(name), registry.spec(name), budget, skill.name)
        for name in allowed_names
    ]
    return GovernedToolSet(
        skill=skill,
        budget=budget,
        tools=tools,
        tool_names=tuple(allowed_names),
    )


def _govern_tool(
    raw: BaseTool,
    spec: ToolSpec,
    budget: ToolBudget,
    skill_name: str,
) -> BaseTool:
    def _invoke(**kwargs):
        return execute_tool(raw, spec, budget, skill_name, kwargs)

    return StructuredTool(
        name=raw.name,
        description=raw.description,
        args_schema=raw.args_schema,
        func=_invoke,
        return_direct=getattr(raw, "return_direct", False),
        response_format=getattr(raw, "response_format", "content"),
        tags=[*(getattr(raw, "tags", None) or []), "governed"],
        metadata={
            "governed": True,
            "skill": skill_name,
            "tool_version": spec.version,
            "scopes": list(spec.scopes),
            "timeout_s": spec.timeout_s,
            "max_calls_per_turn": spec.max_calls_per_turn,
            "max_retries": spec.max_retries,
            "breaker_failures": spec.breaker_failures,
            "breaker_cooldown_s": spec.breaker_cooldown_s,
        },
    )


def execute_tool(
    raw: BaseTool,
    spec: ToolSpec,
    budget: ToolBudget,
    skill_name: str,
    args: dict,
) -> str:
    """执行一次已注册工具，永不抛异常给 Agent。"""
    started = time.perf_counter()
    METRICS.record_request(spec.name)

    # 熔断优先于预算：工具已经连续挂了，别再让模型排队等超时。
    if not BREAKER.allow(spec.name, spec.breaker_failures, spec.breaker_cooldown_s):
        METRICS.record_circuit_open(spec.name)
        _log_call(
            spec=spec,
            skill_name=skill_name,
            ok=False,
            started=started,
            attempts=0,
            error_kind="circuit_open",
            budget=budget,
        )
        status = BREAKER.status(spec.name, spec.breaker_failures, spec.breaker_cooldown_s)
        return (
            f"Error: 工具 {spec.name} 连续失败已临时熔断，"
            f"{status['retry_after_s']:g}s 后重试。"
        )

    try:
        budget.reserve(spec.name, is_write=not spec.read_only)
    except ToolBudgetExceeded as exc:
        METRICS.record_budget_rejection(spec.name)
        _log_call(
            spec=spec,
            skill_name=skill_name,
            ok=False,
            started=started,
            attempts=0,
            error_kind="budget",
            budget=budget,
        )
        return f"Error: 工具 {spec.name} 未执行：{exc}"

    METRICS.record_call(spec.name)
    last_exc: Exception | None = None
    attempts = 0

    for attempt in range(spec.max_retries + 1):
        attempts = attempt + 1
        token = ToolCallToken()
        ctx_token = set_call_token(token)
        try:
            # 必须在 set_call_token 之后复制，保证工具线程拿到本轮用户与调用令牌。
            # callbacks=[]：外层 governed tool 已经负责发 on_tool_start/on_tool_end，
            # 内层 raw.invoke 再发一遍会让前端看到重复工具步骤。
            context = copy_context()
            future = _EXECUTOR.submit(
                context.run,
                raw.invoke,
                args,
                config={"callbacks": []},
            )
            try:
                result = future.result(timeout=spec.timeout_s)
            except FutureTimeoutError:
                token.active = False
                BREAKER.record_failure(
                    spec.name,
                    spec.breaker_failures,
                    spec.breaker_cooldown_s,
                )
                METRICS.record_failure(
                    spec.name,
                    (time.perf_counter() - started) * 1000,
                    "timeout",
                    f"超过 {spec.timeout_s:g}s 未返回",
                    timeout=True,
                )
                _log_call(
                    spec=spec,
                    skill_name=skill_name,
                    ok=False,
                    started=started,
                    attempts=attempts,
                    error_kind="timeout",
                    budget=budget,
                )
                return (
                    f"Error: 工具 {spec.name} 超时（{spec.timeout_s:g}s）。"
                    "请缩小问题范围或稍后重试。"
                )
            except Exception as exc:  # noqa: BLE001 - 统一转成模型可读错误
                last_exc = exc
                if attempt < spec.max_retries and _is_retryable(exc):
                    METRICS.record_retry(spec.name)
                    time.sleep(0.2 * (attempt + 1))
                    continue
                BREAKER.record_failure(
                    spec.name,
                    spec.breaker_failures,
                    spec.breaker_cooldown_s,
                )
                METRICS.record_failure(
                    spec.name,
                    (time.perf_counter() - started) * 1000,
                    type(exc).__name__,
                    str(exc),
                )
                _log_call(
                    spec=spec,
                    skill_name=skill_name,
                    ok=False,
                    started=started,
                    attempts=attempts,
                    error_kind=type(exc).__name__,
                    budget=budget,
                )
                return (
                    f"Error: 工具 {spec.name} 执行失败：{_safe_exception_message(exc)}"
                )

            text = _stringify(result)
            truncated = False
            if len(text) > spec.max_result_chars:
                text = text[: spec.max_result_chars] + "\n...[结果已截断]"
                truncated = True
            BREAKER.record_success(spec.name)
            METRICS.record_success(
                spec.name,
                (time.perf_counter() - started) * 1000,
                attempts,
            )
            _log_call(
                spec=spec,
                skill_name=skill_name,
                ok=True,
                started=started,
                attempts=attempts,
                error_kind=None,
                budget=budget,
                truncated=truncated,
            )
            return text
        finally:
            reset_call_token(ctx_token)

    # 理论上到不了这里；兜底避免返回 None。
    _log_call(
        spec=spec,
        skill_name=skill_name,
        ok=False,
        started=started,
        attempts=attempts,
        error_kind=type(last_exc).__name__ if last_exc else "unknown",
        budget=budget,
    )
    return f"Error: 工具 {spec.name} 执行失败"


def _is_retryable(exc: Exception) -> bool:
    name = type(exc).__name__.lower()
    message = str(exc).lower()
    markers = ("timeout", "connection", "temporar", "rate limit", "429", "503")
    return any(marker in name or marker in message for marker in markers)


def _safe_exception_message(exc: Exception) -> str:
    text = str(exc).replace("\n", " ").strip()
    text = re.sub(r"sk-[A-Za-z0-9._-]+", "sk-***", text)
    text = re.sub(r"(?i)(api[_-]?key=)[^&\s]+", r"\1***", text)
    return text[:180] or type(exc).__name__


def _stringify(result) -> str:
    if result is None:
        return "（工具没有返回内容）"
    content = getattr(result, "content", result)
    if isinstance(content, str):
        return content
    return str(content)


def _log_call(
    *,
    spec: ToolSpec,
    skill_name: str,
    ok: bool,
    started: float,
    attempts: int,
    error_kind: str | None,
    budget: ToolBudget,
    truncated: bool = False,
) -> None:
    logger.info(
        "tool_call",
        extra={
            "extra_fields": {
                "tool": spec.name,
                "tool_version": spec.version,
                "skill": skill_name,
                "ok": ok,
                "attempts": attempts,
                "error_kind": error_kind,
                "truncated": truncated,
                "ms": round((time.perf_counter() - started) * 1000, 1),
                "budget_used": budget.total_used,
                "budget_remaining": budget.remaining,
            }
        },
    )
