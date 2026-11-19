"""MCP 协议适配层。

这里不是第二套 Agent 框架：它只把可用能力描述成 MCP 的
tools/list / tools/call，并把真正执行交给现有服务或数据库。
"""

from app.mcp.registry import MCP_TOOLS, McpToolSpec, list_tools, call_tool

__all__ = ["MCP_TOOLS", "McpToolSpec", "list_tools", "call_tool"]
