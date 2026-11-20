"""MCP 工具注册表。

一个工具只在这里声明一次：名字、给人看的说明、JSON Schema、只读/破坏性、
真正执行的 handler。`server.py` 只做协议翻译，不判断业务。
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable
from uuid import uuid4

from app.agents.tool_registry import DEFAULT_REGISTRY
from app.agents.tools import set_tool_user
from app.database import SessionLocal, settings
from app.models import CalendarEvent, ScheduleItem
from app.services.note_ai import (
    NoteAIError,
    extract_note_actions,
    polish_note,
    summarize_note,
)
from app.services.note_library import MAX_NOTE_CONTENT, save_private_note

logger = logging.getLogger(__name__)

Handler = Callable[[dict[str, Any], int], Any]


@dataclass(frozen=True)
class McpToolSpec:
    name: str
    title: str
    description: str
    input_schema: dict[str, Any]
    handler: Handler
    read_only: bool = True
    destructive: bool = False
    tags: tuple[str, ...] = ()


def _object_schema(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": required or [],
        "additionalProperties": False,
    }


_NOTE_PROPERTIES = {
    "title": {"type": "string", "maxLength": 240, "description": "笔记标题，可为空"},
    "markdown": {"type": "string", "maxLength": 60000, "description": "当前笔记的 Markdown 正文"},
}


def _note_summary(args: dict[str, Any], user_id: int) -> dict[str, Any]:
    result = summarize_note(str(args.get("title") or ""), str(args.get("markdown") or ""))
    return {"summary": result["summary"], "provider": result["provider"], "model": result["model"]}


def _note_polish(args: dict[str, Any], user_id: int) -> dict[str, Any]:
    result = polish_note(
        str(args.get("title") or ""),
        str(args.get("markdown") or ""),
        str(args.get("instruction") or ""),
    )
    return {"markdown": result["markdown"], "provider": result["provider"], "model": result["model"]}


def _note_actions(args: dict[str, Any], user_id: int) -> dict[str, Any]:
    return extract_note_actions(str(args.get("title") or ""), str(args.get("markdown") or ""))


def _note_create(args: dict[str, Any], user_id: int) -> dict[str, Any]:
    _require_confirm(args)
    title = str(args.get("title") or "").strip()[:240] or "AI 笔记"
    content = str(args.get("content") or "").strip()
    summary = str(args.get("summary") or "").strip()
    if not content and not summary:
        raise ValueError("content 和 summary 至少提供一个")
    if len(content) > MAX_NOTE_CONTENT:
        raise ValueError(f"content 超过 {MAX_NOTE_CONTENT} 字符")

    if summary:
        body = f"## AI 总结\n\n{summary}"
        if content:
            body += f"\n\n---\n\n## 原文\n\n{content}"
    else:
        body = content

    note = save_private_note(
        user_id=user_id,
        title=title,
        content=body,
        source="assistant",
    )
    return {"id": note.id, "title": note.title, "chars": len(body)}


def _require_confirm(args: dict[str, Any]) -> None:
    if args.get("confirm") is not True:
        raise ValueError("写操作需要用户确认；请让用户确认后传 confirm=true")


def _parse_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ValueError("时间必须是 ISO 字符串")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"无法解析时间: {value}") from exc


def _todo_create(args: dict[str, Any], user_id: int) -> dict[str, Any]:
    _require_confirm(args)
    title = str(args.get("title") or "").strip()[:240]
    if not title:
        raise ValueError("待办标题不能为空")
    description = str(args.get("description") or "").strip()[:2000]
    due_date = str(args.get("due_date") or "").strip()
    if due_date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", due_date):
        raise ValueError("due_date 必须是 YYYY-MM-DD")
    if due_date:
        description = (description + f"\n建议截止：{due_date}").strip()

    priority = str(args.get("priority") or "green").lower()
    if priority not in {"high", "medium", "low", "green"}:
        priority = "green"

    start_at = _parse_datetime(args.get("start_at"))
    due_at = _parse_datetime(args.get("due_at"))
    if (start_at is None) != (due_at is None):
        raise ValueError("start_at 和 due_at 必须成对提供")
    if start_at and due_at and due_at <= start_at:
        raise ValueError("due_at 必须晚于 start_at")

    now = datetime.now()
    with SessionLocal() as db:
        item = ScheduleItem(
            id=uuid4().hex,
            user_id=user_id,
            type="todo",
            title=title,
            description=description,
            status="pending",
            priority=priority,
            start_at=start_at,
            due_at=due_at,
            reminder_at=None,
            pomodoro_count=0,
            pomodoro_rounds=0,
            total_focus_minutes=0,
            completed_at=None,
            deleted_at=None,
            sort_order=0,
            created_at=now,
            updated_at=now,
        )
        db.add(item)
        db.commit()
        db.refresh(item)
        return {"id": item.id, "title": item.title, "type": item.type, "due_date": due_date or None}


def _calendar_create(args: dict[str, Any], user_id: int) -> dict[str, Any]:
    _require_confirm(args)
    title = str(args.get("title") or "").strip()[:240]
    if not title:
        raise ValueError("日程标题不能为空")
    date_text = str(args.get("date") or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_text):
        raise ValueError("date 必须是 YYYY-MM-DD")
    start_time = str(args.get("start_time") or "").strip() or None
    end_time = str(args.get("end_time") or "").strip() or None
    for label, value in (("start_time", start_time), ("end_time", end_time)):
        if value and not re.fullmatch(r"\d{2}:\d{2}", value):
            raise ValueError(f"{label} 必须是 HH:MM")

    now = datetime.now()
    with SessionLocal() as db:
        event = CalendarEvent(
            id=uuid4().hex,
            user_id=user_id,
            title=title,
            date=date_text,
            start_time=start_time,
            end_time=end_time,
            type="event",
            color="#8b5cf6",
            todo_id=None,
            pomodoro_session_id=None,
            description=str(args.get("description") or "").strip()[:2000] or None,
            created_at=now,
            updated_at=now,
        )
        db.add(event)
        db.commit()
        db.refresh(event)
        return {"id": event.id, "title": event.title, "date": event.date}


def _existing_handler(name: str) -> Handler:
    def handle(args: dict[str, Any], user_id: int) -> Any:
        set_tool_user(user_id)
        try:
            return DEFAULT_REGISTRY.get(name).invoke(args or {})
        finally:
            set_tool_user(None)

    return handle


def _schema_for_existing(name: str) -> dict[str, Any]:
    tool = DEFAULT_REGISTRY.get(name)
    schema = getattr(tool, "args_schema", None)
    if schema is None:
        return _object_schema({})
    if isinstance(schema, dict):
        return schema
    if hasattr(schema, "model_json_schema"):
        try:
            result = schema.model_json_schema()
            if isinstance(result, dict):
                return result
        except Exception:  # noqa: BLE001 —— 生成失败不应该让整个 MCP 启动失败
            logger.warning("生成工具 schema 失败 name=%s", name, exc_info=True)
    return _object_schema({})


NATIVE_TOOLS: list[McpToolSpec] = [
    McpToolSpec(
        name="note_summarize",
        title="总结笔记",
        description="把一篇 Markdown 笔记压缩成 3-6 条复习要点，并给一个下一步动作。只读，不写笔记。",
        input_schema=_object_schema(_NOTE_PROPERTIES, ["markdown"]),
        handler=_note_summary,
        tags=("notes", "ai"),
    ),
    McpToolSpec(
        name="note_polish",
        title="润色笔记",
        description="重写 Markdown 笔记，保留事实、代码块和结构，输出更清楚紧凑的正文。只读，不写笔记。",
        input_schema=_object_schema(
            {**_NOTE_PROPERTIES, "instruction": {"type": "string", "maxLength": 300, "description": "可选的额外润色要求"}},
            ["markdown"],
        ),
        handler=_note_polish,
        tags=("notes", "ai"),
    ),
    McpToolSpec(
        name="note_detect_actions",
        title="从笔记抽取待办和日程",
        description=(
            "从 Markdown 正文抽取明确的待办和日程建议。只返回建议，不创建任何记录；"
            "创建必须由用户确认后调用 todo_create / calendar_create。"
        ),
        input_schema=_object_schema(_NOTE_PROPERTIES, ["markdown"]),
        handler=_note_actions,
        tags=("notes", "actions", "ai"),
    ),
    McpToolSpec(
        name="note_create",
        title="保存私人笔记",
        description=(
            "在用户确认后把正文保存为当前用户的私人笔记；可附带 summary，"
            "会写成「AI 总结 + 原文」的结构。不会创建共享笔记。"
        ),
        input_schema=_object_schema(
            {
                "title": {"type": "string", "maxLength": 240},
                "content": {"type": "string", "maxLength": MAX_NOTE_CONTENT},
                "summary": {"type": "string", "maxLength": 6000},
                "confirm": {"type": "boolean", "description": "必须是用户确认后的 true"},
            },
            ["title", "confirm"],
        ),
        handler=_note_create,
        read_only=False,
        destructive=True,
        tags=("notes", "write"),
    ),
    McpToolSpec(
        name="todo_create",
        title="创建待办",
        description="在用户确认后创建一条待办。没有明确时间时不要擅自占用日程时段。",
        input_schema=_object_schema(
            {
                "title": {"type": "string", "maxLength": 240},
                "description": {"type": "string", "maxLength": 2000},
                "due_date": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"},
                "priority": {"type": "string", "enum": ["high", "medium", "low", "green"]},
                "start_at": {"type": "string", "description": "可选 ISO 时间；必须与 due_at 成对"},
                "due_at": {"type": "string", "description": "可选 ISO 时间；必须与 start_at 成对"},
                "confirm": {"type": "boolean", "description": "必须是用户确认后的 true"},
            },
            ["title", "confirm"],
        ),
        handler=_todo_create,
        read_only=False,
        destructive=True,
        tags=("schedule", "todo", "write"),
    ),
    McpToolSpec(
        name="calendar_create",
        title="创建日历日程",
        description="在用户确认后创建一条日历日程；日期和时间必须来自用户或笔记中的明确安排。",
        input_schema=_object_schema(
            {
                "title": {"type": "string", "maxLength": 240},
                "date": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"},
                "start_time": {"type": "string", "pattern": "^\\d{2}:\\d{2}$"},
                "end_time": {"type": "string", "pattern": "^\\d{2}:\\d{2}$"},
                "description": {"type": "string", "maxLength": 2000},
                "confirm": {"type": "boolean", "description": "必须是用户确认后的 true"},
            },
            ["title", "date", "confirm"],
        ),
        handler=_calendar_create,
        read_only=False,
        destructive=True,
        tags=("schedule", "calendar", "write"),
    ),
]


def _build_existing_tools() -> list[McpToolSpec]:
    tools: list[McpToolSpec] = []
    for name in DEFAULT_REGISTRY.names():
        spec = DEFAULT_REGISTRY.spec(name)
        if not spec.enabled or not spec.read_only:
            continue
        tools.append(
            McpToolSpec(
                name=name,
                title=name,
                description=(DEFAULT_REGISTRY.get(name).description or name)[:400],
                input_schema=_schema_for_existing(name),
                handler=_existing_handler(name),
                read_only=True,
                tags=spec.tags,
            )
        )
    return tools


MCP_TOOLS: list[McpToolSpec] = [*NATIVE_TOOLS, *_build_existing_tools()]
_BY_NAME = {tool.name: tool for tool in MCP_TOOLS}

# MCP 原生工具始终属于「笔记 / 待办 / 日程」这条共享业务线，
# Lite 也具备这些能力，所以不受 profile 过滤。
_MCP_NATIVE_NAMES = frozenset(tool.name for tool in NATIVE_TOOLS)


def _lite_mcp_tool_names() -> frozenset[str]:
    """Lite 只暴露当前能力包真正可用的 MCP 工具。

    Lite 没有视频库、学习路径和向量检索；如果直接把完整 MCP 清单给它，
    页面会展示一堆一点就 404 / 报错的工具，客户端也会误以为这些能力存在。
    `list_skills()` 是 Lite 的权威白名单，这里只取其中只读工具，
    再加原生笔记/待办/日程工具。完整版仍返回全量 MCP_TOOLS。
    """
    from app.agents.skills import list_skills

    names = set(_MCP_NATIVE_NAMES)
    for skill in list_skills():
        for name in skill.tools:
            tool = _BY_NAME.get(name)
            if tool is not None and tool.read_only:
                names.add(name)
    return frozenset(names)


def active_tools() -> list[McpToolSpec]:
    """按 profile 返回当前真正可用的 MCP 工具。"""
    if not settings.is_lite:
        return MCP_TOOLS
    allowed = _lite_mcp_tool_names()
    return [tool for tool in MCP_TOOLS if tool.name in allowed]


def list_tools() -> list[dict[str, Any]]:
    return [
        {
            "name": tool.name,
            "description": tool.description,
            "inputSchema": tool.input_schema,
            "annotations": {
                "title": tool.title,
                "readOnlyHint": tool.read_only,
                "destructiveHint": tool.destructive,
                "idempotentHint": False,
                "openWorldHint": True,
            },
        }
        for tool in active_tools()
    ]


def call_tool(name: str, args: dict[str, Any], user_id: int) -> Any:
    tool = _BY_NAME.get(name)
    if tool is None:
        raise KeyError(f"未知工具: {name}")
    if settings.is_lite and name not in _lite_mcp_tool_names():
        raise KeyError(f"当前 Lite profile 不提供工具: {name}")
    if not isinstance(args, dict):
        raise ValueError("arguments 必须是对象")
    if tool.destructive and args.get("confirm") is not True:
        raise ValueError("写操作需要用户确认；请让用户确认后传 confirm=true")
    try:
        return tool.handler(args, user_id)
    except NoteAIError:
        raise
    except ValueError:
        raise
    except Exception as exc:  # noqa: BLE001 —— 由协议层统一脱敏
        logger.exception("MCP 工具执行失败 name=%s", name)
        raise RuntimeError(f"工具 {name} 执行失败") from exc
