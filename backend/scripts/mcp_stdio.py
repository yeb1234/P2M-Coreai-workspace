#!/usr/bin/env python3
"""MCP stdio 传输适配器。

在 backend 目录或容器里运行：
    MCP_USER_ID=<用户 id> python scripts/mcp_stdio.py

stdout 只输出 JSON-RPC，日志写 stderr；不要在这里 print 业务内容。
"""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.mcp.registry import call_tool, list_tools  # noqa: E402

logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
logger = logging.getLogger("siteyeb-mcp-stdio")

_PROTOCOL_VERSION = "2024-11-05"


def _write(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")
    sys.stdout.flush()


def _ok(request_id: Any, result: Any) -> None:
    _write({"jsonrpc": "2.0", "id": request_id, "result": result})


def _error(request_id: Any, code: int, message: str) -> None:
    _write({"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}})


def _tool_result(value: Any, is_error: bool = False) -> dict[str, Any]:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    return {"content": [{"type": "text", "text": text}], "isError": is_error}


def handle(payload: dict[str, Any], user_id: int) -> None:
    request_id = payload.get("id")
    method = payload.get("method")
    params = payload.get("params") or {}

    if request_id is None:
        # notification：执行但不回包
        if method == "notifications/initialized":
            return
        return

    if method == "initialize":
        _ok(
            request_id,
            {
                "protocolVersion": _PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "siteyeb-mcp", "version": "0.1.0"},
            },
        )
        return
    if method == "ping":
        _ok(request_id, {})
        return
    if method == "tools/list":
        _ok(request_id, {"tools": list_tools()})
        return
    if method == "tools/call":
        if not isinstance(params, dict):
            _error(request_id, -32602, "params 必须是对象")
            return
        name = params.get("name")
        arguments = params.get("arguments") or {}
        if not isinstance(name, str) or not name:
            _error(request_id, -32602, "缺少工具名 name")
            return
        if not isinstance(arguments, dict):
            _error(request_id, -32602, "arguments 必须是对象")
            return
        try:
            value = call_tool(name, arguments, user_id)
            _ok(request_id, _tool_result(value))
        except KeyError as exc:
            _error(request_id, -32601, str(exc))
        except (ValueError, RuntimeError) as exc:
            _ok(request_id, _tool_result(str(exc), is_error=True))
        except Exception:
            logger.exception("stdio MCP 工具失败 name=%s", name)
            _ok(request_id, _tool_result("工具执行失败，请稍后重试", is_error=True))
        return

    _error(request_id, -32601, f"不支持的方法: {method}")


def main() -> None:
    raw_user = os.environ.get("MCP_USER_ID")
    if not raw_user:
        print("MCP_USER_ID 未设置；stdio MCP 需要绑定一个已登录用户", file=sys.stderr)
        raise SystemExit(2)
    try:
        user_id = int(raw_user)
    except ValueError:
        print("MCP_USER_ID 必须是整数", file=sys.stderr)
        raise SystemExit(2)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            _error(None, -32700, "Parse error")
            continue
        if not isinstance(payload, dict) or payload.get("jsonrpc") != "2.0":
            _error(payload.get("id") if isinstance(payload, dict) else None, -32600, "Invalid Request")
            continue
        handle(payload, user_id)


if __name__ == "__main__":
    main()
