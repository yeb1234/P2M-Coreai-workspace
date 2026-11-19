# MCP 与笔记 AI 接入

> 状态：现行（2026-11-19 对照代码校对）

## 笔记 AI

`POST /api/notes/ai`，需要登录。正文由前端带上来，后端不读 IndexedDB、不写 `notes` 表。

```json
{
  "action": "summary",
  "title": "LangGraph 学习记录",
  "markdown": "# ...",
  "instruction": "可选，仅 polish 使用"
}
```

`action` 取值：

| action | 返回 | 说明 |
| --- | --- | --- |
| `summary` | `result.summary` | Markdown 摘要 + 下一步 |
| `polish` | `result.markdown` | 重写后的完整 Markdown |
| `actions` | `result.todos` / `result.events` | 只给建议，不写库 |

失败返回 422（可展示的 AI 原因）或 502；失败会退回本次 AI 配额。

## MCP HTTP

`POST /api/mcp`，JSON-RPC 2.0，登录态与站点一致。

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"note_summarize","arguments":{"title":"...","markdown":"..."}}}
```

调试清单：`GET /api/mcp/tools`。

当前工具：

| 工具 | 读/写 | 说明 |
| --- | --- | --- |
| `note_summarize` | 读 | 摘要 |
| `note_polish` | 读 | 润色 |
| `note_detect_actions` | 读 | 抽取待办/日程建议 |
| `note_create` | 写 | 保存私人笔记，可带 `summary`；需要 `confirm=true` |
| `todo_create` | 写 | 需要 `confirm=true` |
| `calendar_create` | 写 | 需要 `confirm=true` |
| 现有 Agent 只读工具 | 读 | `search_videos`、`search_notes` 等 |

写工具的 `annotations.destructiveHint` 为 `true`；未传 `confirm=true` 时返回 `isError: true`，不会落库。

## stdio

```bash
cd backend
MCP_USER_ID=<站点用户 id> python scripts/mcp_stdio.py
```

stdout 只输出 JSON-RPC，日志走 stderr。stdio 适配器与 HTTP 共用 `app/mcp/registry.py`，新增工具只改注册表。

## 扩展约定

1. 新工具先在 `backend/app/mcp/registry.py` 声明 name、description、inputSchema、handler、readOnly/destructive。
2. 读工具复用现有 service；写工具必须带 `confirm` 与最小字段校验。
3. 不把用户 id 做成模型可填参数；HTTP 用登录态，stdio 用 `MCP_USER_ID`。
4. 工具错误统一返回 `content + isError`，内部堆栈只进日志。
