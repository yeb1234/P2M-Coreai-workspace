"""工具调用上下文：搜索命中轨迹与当前调用令牌。

为什么单独一层
--------------
1. LangGraph 可能把同步工具放进线程池执行，`ContextVar` 不会自动跨线程。
   运行包装会显式 `copy_context()`，这里只负责保存本轮轨迹。
2. 工具超时后，后台线程不一定立刻停止。它如果继续往本轮引用命中里写数据，
   会造成「回答已经返回，引用卡片又冒出一条」。调用令牌 `active=False`
   之后，`record_search_hits()` 直接丢弃迟到的命中。
"""

from __future__ import annotations

from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from typing import Any


@dataclass
class SearchTrace:
    hits: list[Any] = field(default_factory=list)


@dataclass
class ToolCallToken:
    """一次工具调用的生命周期标记。超时/取消后置为 False。"""

    active: bool = True


_trace: ContextVar[SearchTrace | None] = ContextVar("tool_search_trace", default=None)
_call: ContextVar[ToolCallToken | None] = ContextVar("tool_call_token", default=None)


def begin_search_trace() -> None:
    """每轮对话开始前清空上一轮的检索命中。"""
    _trace.set(SearchTrace())


def record_search_hits(hits: list[Any]) -> None:
    """记录一次 search_videos 的命中。

    没有调用令牌时（例如脚本直接调用工具）仍然记录；
    有令牌且令牌已失效时丢弃，避免超时线程污染引用区。
    """
    trace = _trace.get()
    if trace is None:
        return
    token = _call.get()
    if token is not None and not token.active:
        return
    trace.hits.extend(hits)


def take_search_hits() -> list[Any]:
    """取出本轮所有 search_videos 命中，按「片段 + 视频 + 起点」去重。"""
    trace = _trace.get()
    if trace is None:
        return []

    seen: set[tuple] = set()
    out: list[Any] = []
    for hit in trace.hits:
        key = (
            getattr(hit, "segment_id", None),
            getattr(hit, "video_id", None),
            round(float(getattr(hit, "start_sec", 0) or 0), 1),
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(hit)
    return out


def set_call_token(token: ToolCallToken) -> Token:
    return _call.set(token)


def reset_call_token(token: Token) -> None:
    _call.reset(token)


def current_call_token() -> ToolCallToken | None:
    return _call.get()
