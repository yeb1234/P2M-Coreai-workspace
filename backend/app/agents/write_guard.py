"""写操作的两段式许可。

模型自己传 `confirm=true` 不等于用户确认。真正的写权限只能由
`post_model_hook` 在用户选择「确认执行」之后发放，工具侧再消费一次。
这样即使某条链路（例如同步 `/chat`）没有 HITL 中断，也不会落库。
"""

from __future__ import annotations

import threading
import time

# 写工具与确认卡文案集中在这里，避免 hook 和工具各维护一份名单。
WRITE_TOOL_NAMES: frozenset[str] = frozenset(
    {
        "save_note",
        "summarize_and_save_note",
        "create_calendar_event",
        "create_todo",
    }
)

WRITE_TOOL_LABELS: dict[str, str] = {
    "save_note": "保存笔记",
    "summarize_and_save_note": "总结并另存笔记",
    "create_calendar_event": "创建日历日程",
    "create_todo": "创建 Todo",
}

# 许可只覆盖「确认后马上执行」这一小段时间；超时未执行就作废。
_GRANT_TTL_SECONDS = 10 * 60

_grants: dict[tuple[str, str], float] = {}
_grants_lock = threading.Lock()


def grant_write(tool_name: str, run_id: str | None) -> None:
    """用户确认后发放一次性写许可。"""
    if not run_id or tool_name not in WRITE_TOOL_NAMES:
        return
    key = (str(run_id), tool_name)
    with _grants_lock:
        _grants[key] = time.monotonic() + _GRANT_TTL_SECONDS


def consume_write_grant(tool_name: str, run_id: str | None) -> bool:
    """工具执行前消费许可；同一轮同一工具只能写一次。"""
    if not run_id or tool_name not in WRITE_TOOL_NAMES:
        return False
    key = (str(run_id), tool_name)
    with _grants_lock:
        expires_at = _grants.pop(key, None)
    return bool(expires_at and expires_at >= time.monotonic())


def clear_write_grants(run_id: str | None = None) -> None:
    """清理许可；测试和异常收尾用。"""
    with _grants_lock:
        if run_id is None:
            _grants.clear()
            return
        prefix = str(run_id)
        for key in [item for item in _grants if item[0] == prefix]:
            _grants.pop(key, None)
