# 工具与 Skill 治理层

这份文档对应 `backend/app/agents/` 下的五个文件：

- `tool_registry.py`：工具元数据与注册表
- `skills.py`：能力包（Skill）与「意图 → 工具」策略
- `tool_runtime.py`：预算、超时、重试、错误归一化、结果截断
- `tool_context.py`：检索命中轨迹与超时调用令牌
- `tool_metrics.py`：工具级指标与连续失败熔断

目标不是做一套插件市场，而是先把「模型能调什么、调多少次、超时怎么办、出错怎么记」管起来。

## 1. 工具注册表

每个工具必须有 `ToolSpec`，启动时校验一一对应。新增一个 `@tool` 却忘了补元数据，应用会在导入阶段直接报错，而不是悄悄多挂一个工具。

当前注册的 13 个工具：

| 工具 | 超时 | 单轮上限 | 重试 | 登录 |
|---|---:|---:|---:|---|
| `search_videos` | 20s | 2 | 1 | 否 |
| `search_video_titles` | 8s | 2 | 1 | 否 |
| `get_video_summary` | 8s | 2 | 0 | 否 |
| `get_learning_profile` | 10s | 1 | 0 | 是 |
| `get_recent_activity` | 10s | 1 | 0 | 是 |
| `get_learning_goal` | 8s | 1 | 0 | 是 |
| `get_my_learning_path` | 8s | 1 | 0 | 是 |
| `recommend_next_videos` | 20s | 1 | 0 | 是 |
| `search_notes` | 8s | 1 | 0 | 是 |
| `save_note` | 12s | 1 | 0 | 是（写） |
| `summarize_and_save_note` | 70s | 1 | 0 | 是（写） |
| `create_calendar_event` | 12s | 1 | 0 | 是（写） |
| `create_todo` | 12s | 1 | 0 | 是（写） |

`ToolSpec` 还带：

- `version`：工具版本；
- `scopes`：权限范围，例如 `library:read`、`profile:read`；
- `requires_login`：匿名请求是否可用；
- `read_only`：当前工具是否只读；
- `tags`：检索/学习/笔记等分类；
- `max_result_chars`：回给模型的最大字符数；
- `breaker_failures` / `breaker_cooldown_s`：连续失败熔断阈值与冷却时间，默认 5 次 / 60 秒，0 表示关闭。

## 2. Skill 能力包

`SkillSpec` 不是外部 `SKILL.md`，而是一个后端能力包：

- 绑定一个或多个意图；
- 绑定一组已注册工具；
- 声明单轮工具总预算；
- 有名称、版本、启用开关。

当前能力包：

| Skill | 意图 | 工具 |
|---|---|---|
| `general-answer` | `question-answer` | 无 |
| `knowledge-lookup` | `knowledge-qa` | `search_videos` / `search_video_titles` / `get_video_summary` |
| `course-discovery` | `course-recommend` | `recommend_next_videos` / `search_videos` / `search_video_titles` / `get_video_summary` |
| `learning-review` | `study-summary` | 画像 / 最近活动 / 路径 / 目标 |
| `learning-planning` | `learning-path` | 目标 / 路径 / 推荐 / 检索 |
| `coding-helper` | `coding-helper` | 检索 / 标题 / 笔记 |
| `task-planning` | `task-planning` | 目标 / 路径 / 笔记 |
| `note-library` | `note-save` | `save_note` / `summarize_and_save_note` |
| `fallback` | 空/未知 | 只读检索三件套 |

重要变化：

- `question-answer` 仍然是零工具，纯知识回答不会被视频库带跑；
- 其他意图不再拿 `ALL_TOOLS`，只拿自己能力包里的工具；
- 未识别意图走 `fallback`，只允许只读检索，不再全量放开；
- `requires_login=True` 的工具在匿名请求里会被过滤，避免读到别人的画像、路径或笔记。

### 个人动作层（6.0 SmartAgents）

`save_note` / `summarize_and_save_note` / `create_calendar_event` / `create_todo`
不再只绑在 `note-save` 意图上，而是作为登录用户的常驻动作层追加到每个 Skill 之后。
原因很实际：用户说「可以」「就按这个来」时，前端往往识别不出新意图，落到 `fallback`；
如果写工具只挂 `note-save`，模型就会自述「确认卡已经弹出」，但实际没有任何工具可调。

这四条工具有三个独立约束：

- 只对登录用户可见，匿名请求拿不到；
- 每个工具单轮最多 1 次，且整轮最多 1 个写动作；
- 同一 `run_id` 内按动作类型去重，重复调用返回已有记录，不重复落库。

个人动作层仍然经过 `execute_tool()`，只是预算里额外占一个槽位；不会因为四个工具而放宽总调用数。

前端 `detectIntent()` 仍然是意图来源；后端 Skill 负责「这个意图能调什么工具」。提示词模板仍由前端 `DEFAULT_PROMPT_TEMPLATES` 管理，暂不强行搬到后端。

## 3. 执行包装

每个 Skill 生成一组 governed tools，模型看到的 schema 与原 `@tool` 一致，但执行会经过 `execute_tool()`：

1. 指标入口：每次调用先记 `requests`；
2. 熔断检查：连续失败达到阈值后直接返回「临时熔断」，不消耗预算；
3. 预算检查：总调用数、单工具调用数；被拒绝记 `budget_rejections`；
4. 线程池执行，`future.result(timeout=...)` 超时；超时记 `timeouts` 并计一次熔断失败；
5. 可重试错误最多重试 `max_retries` 次；每次重试记 `retries`；
6. 异常统一转成 `Error: 工具 xxx ...`，不把 traceback 扔给模型；最终失败记一次熔断失败；
7. 成功记延迟样本、`successes`，重试后成功记 `retry_successes`；
8. 结果超过 `max_result_chars` 截断；
9. 记录结构化日志：`tool`、`skill`、`ok`、`attempts`、`error_kind`、`ms`、`budget_remaining`、`truncated`。

### 写动作闸门、审计与撤回

写工具不是普通工具，执行前多两道闸门：

1. `chat_agent` 的 `post_model_hook` 检测到写调用后直接 `interrupt`，SSE 推 `hitl` 确认卡；
2. 用户点 A / 确认后，resume 才把 `confirm=True` 注入对应工具调用并进入 ToolNode。
   点 B / 取消则不执行，任何数据都不改。

成功写入在同一 DB 事务里做两件事：写业务对象（`Note` / `CalendarEvent` / `ScheduleItem`），
写 `AgentAction` 审计记录。`AgentRun.steps` 同时保留工具名、参数、结果和耗时；
HITL 中断时也会先把已发生的轨迹落盘，resume 后继续补全，不会丢掉前半段。

前端在 assistant 消息下渲染动作回执，提供撤回入口：

```http
GET  /api/agent-actions
POST /api/agent-actions/{action_id}/undo
```

撤回语义：笔记删除、日历事件硬删、Todo 软删（写 `deleted_at`）。动作记录保留，
状态从 `applied` 改为 `undone`，不提供 redo。

超时使用线程 future；Python 不能强杀线程，所以底层调用可能继续跑完。为了避免「回答已返回，引用卡片又冒出来」，`tool_context.py` 用 `ToolCallToken` 标记调用生命周期：超时后 `active=False`，迟到的 `search_videos` 命中会被 `record_search_hits()` 丢弃。

## 4. 只读管理面

管理员可以查看当前注册表：

```http
GET /api/assistant/capabilities
```

返回工具的名称、版本、权限范围、超时、单轮上限、重试、是否需登录、启用状态，以及 Skill 的意图、工具、预算和启用状态。这个接口只读，不提供运行时改配置；当前启用/禁用仍以代码里的 `ToolSpec.enabled` / `SkillSpec.enabled` 为准，改完需要重启 backend。`ToolSpec.enabled=False` 时注册表仍保留这条元数据，但 `build_governed_toolset` 不会把它挂给模型。

工具指标与熔断状态：

```http
GET /api/assistant/tool-metrics
```

返回每个工具的 `requests / calls / successes / failures / timeouts / retries / retry_successes / budget_rejections / circuit_open_rejections`，延迟 p50/p95/p99/avg，`timeout_rate`、`retry_success_rate`、`last_error`，以及熔断器 `open / probing / consecutive_failures / retry_after_s`。指标是进程内指标，backend 重启清零；需要跨天趋势时从 `tool_call` 结构化日志聚合。

熔断器在冷却结束后只放一个探测请求：成功则关闭，失败则重新打开。熔断错误文案会直接告诉模型「多少秒后重试」，而不是让模型继续重试同一个坏工具。

## 5. 新增工具/能力包

新增工具：

1. 在 `tools.py`（或独立模块）写 `@tool`；
2. 加入 `ALL_TOOLS`；
3. 在 `tool_registry.py` 补 `ToolSpec`；
4. 在 `skills.py` 把工具挂到对应 Skill；
5. 跑 `python scripts/run_unit_tests.py`。

漏了第 3 步会启动失败；漏了第 4 步工具虽然注册但不会被任何意图使用；被多个 Skill 绑定则按各自预算独立计算。

新增 Skill：

1. 在 `SKILLS` 里加 `SkillSpec`；
2. 确保 `intents` 不与已有 Skill 重复；
3. 确保 `tools` 全部已在 registry；
4. `validate_skills()` 会在导入时检查。

## 6. 已知边界

- 超时是「返回给 Agent 的超时」，不是硬杀线程；底层 HTTP 仍应保留自己的 timeout。
- 当前只有单轮预算，没有跨请求的工具级速率限制；全站聊天限流仍在 `services/rate_limit.py`。
- 单轮写动作上限固定为 1；同一轮里既要存笔记又要排日历，需要拆成下一轮。
- `enabled` 是代码级开关，不是数据库/管理后台的运行时开关；工具被禁用后元数据仍在注册表里，便于管理面显示和恢复。
- 指标与熔断是进程内状态，重启清零；多进程/多容器之间不共享。跨天趋势看日志聚合。
- 评测集覆盖 72 条「问题 → 意图 → 工具 → 参数」样例；个人动作层不计入 Skill 意图路由，单独校验是否常驻；真实检索探针需要显式 `--probe`。

## 7. 验证

```powershell
docker cp backend/app/agents/tool_context.py p2-siteyeb-backend-1:/app/app/agents/tool_context.py
docker cp backend/app/agents/tool_registry.py p2-siteyeb-backend-1:/app/app/agents/tool_registry.py
docker cp backend/app/agents/skills.py p2-siteyeb-backend-1:/app/app/agents/skills.py
docker cp backend/app/agents/tool_runtime.py p2-siteyeb-backend-1:/app/app/agents/tool_runtime.py
docker cp backend/app/agents/tool_metrics.py p2-siteyeb-backend-1:/app/app/agents/tool_metrics.py
docker cp backend/app/agents/tools.py p2-siteyeb-backend-1:/app/app/agents/tools.py
docker cp backend/app/agents/chat_agent.py p2-siteyeb-backend-1:/app/app/agents/chat_agent.py
docker cp backend/app/routers/assistant.py p2-siteyeb-backend-1:/app/app/routers/assistant.py
docker cp backend/tests/test_tool_governance.py p2-siteyeb-backend-1:/app/tests/test_tool_governance.py
docker cp backend/scripts/eval_tool_routing.py p2-siteyeb-backend-1:/app/scripts/eval_tool_routing.py
docker exec p2-siteyeb-backend-1 mkdir -p /app/tests/eval
docker cp backend/tests/eval/tool_routing_eval.json p2-siteyeb-backend-1:/app/tests/eval/tool_routing_eval.json
docker exec p2-siteyeb-backend-1 python scripts/run_unit_tests.py
docker exec p2-siteyeb-backend-1 python scripts/eval_tool_routing.py
docker exec p2-siteyeb-backend-1 python scripts/eval_tool_routing.py --probe
```

`test_tool_governance.py` 覆盖：

- registry 覆盖全部工具；
- 每个意图只绑定一个 Skill；
- `question-answer` 零工具；
- 未识别意图走保守检索；
- 匿名请求过滤登录工具；
- schema 保真与 metadata；
- 单工具/总预算；
- 成功、截断、超时、异常脱敏、预算拒绝；
- 超时后迟到检索命中被丢弃；
- 指标计数与延迟分位；
- 连续失败熔断、冷却后半开探测、熔断拒绝不消耗预算。

当前结果（2026-11-20，6.0.0）：后端全量 `59 passed`（其中工具治理 `19 passed`）；评测集 `cases=72 probes=0 failures=0`，带真实检索探针 `probes=1 failures=0`；后端 `/health` 可达，容器状态 `healthy`。`/health` 若因数据库长事务显示 `degraded`，属于数据库会话告警，不是工具层失败。

评测入口：

- 后端策略：`backend/scripts/eval_tool_routing.py`
- 数据集：`backend/tests/eval/tool_routing_eval.json`
- 前端意图：`npx vitest run src/__tests__/toolRoutingEval.test.ts src/__tests__/chatIntent.test.ts`（94 条通过）

## 8. 下一步接 MCP

MCP 搜索不要直接塞进 `ALL_TOOLS`。按同一套流程：

1. 新建 `web_search` 工具，返回纯文本；
2. 补 `ToolSpec`：`scopes=("web:read",)`、`timeout_s=15`、`max_calls_per_turn=1`、`requires_login=False`；
3. 挂到 `knowledge-lookup` 或单独的 `external-research` Skill；
4. 在 `execute_tool` 里自动获得预算、超时、重试、脱敏和日志。

这样 MCP 只是注册表里的一个工具，不会破坏现有意图策略。
