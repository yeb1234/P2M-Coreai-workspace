"""MCP over HTTP（JSON-RPC 2.0）。

这不是完整 MCP SDK：支持 initialize / tools/list / tools/call / ping，
面向本站桌面端或自建 MCP 客户端。标准 stdio 传输在 scripts/mcp_stdio.py。
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import Response

from app.auth import get_current_user
from app.mcp.registry import call_tool, list_tools
from app.models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/mcp", tags=["mcp"])

_PROTOCOL_VERSION = "2024-11-05"


def _ok(request_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _tool_result(value: Any, is_error: bool = False) -> dict[str, Any]:
    if isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, ensure_ascii=False, default=str)
    return {"content": [{"type": "text", "text": text}], "isError": is_error}


@router.get("/tools")
def tools_manifest(user: User = Depends(get_current_user)):
    """给调试和自建客户端用的工具清单；MCP 客户端应走 POST /api/mcp。"""
    return {"tools": list_tools()}


@router.post("")
def mcp_rpc(
    payload: dict[str, Any] = Body(...),
    user: User = Depends(get_current_user),
):
    request_id = payload.get("id")
    method = payload.get("method")
    params = payload.get("params") or {}

    if not isinstance(payload, dict) or payload.get("jsonrpc") != "2.0":
        raise HTTPException(status_code=400, detail="只接受 JSON-RPC 2.0")

    if request_id is None and method not in {"initialize", "ping"}:
        # JSON-RPC notification：执行但不返回 body。
        if method == "notifications/initialized":
            return Response(status_code=202)
        return Response(status_code=202)

    if method == "initialize":
        return _ok(
            request_id,
            {
                "protocolVersion": _PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "siteyeb-mcp", "version": "0.1.0"},
            },
        )

    if method == "ping":
        return _ok(request_id, {})

    if method == "tools/list":
        return _ok(request_id, {"tools": list_tools()})

    if method == "tools/call":
        if not isinstance(params, dict):
            return _error(request_id, -32602, "params 必须是对象")
        name = params.get("name")
        arguments = params.get("arguments") or {}
        if not isinstance(name, str) or not name:
            return _error(request_id, -32602, "缺少工具名 name")
        if not isinstance(arguments, dict):
            return _error(request_id, -32602, "arguments 必须是对象")
        try:
            value = call_tool(name, arguments, user.id)
            return _ok(request_id, _tool_result(value))
        except KeyError as exc:
            return _error(request_id, -32601, str(exc))
        except (ValueError, RuntimeError) as exc:
            # 工具级错误按 MCP 约定放在 result.isError，而不是 JSON-RPC error。
            return _ok(request_id, _tool_result(str(exc), is_error=True))
        except Exception as exc:  # noqa: BLE001 —— 不把内部堆栈透给客户端
            logger.exception("MCP tools/call 失败 name=%s", name)
            return _ok(request_id, _tool_result("工具执行失败，请稍后重试", is_error=True))

    return _error(request_id, -32601, f"不支持的方法: {method}")
