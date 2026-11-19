# P2 验收与评估（2026-11-16）

> 状态：现行（本轮实测）。这是“这一版到底测了什么、没测什么”的记录；不是发布许可证。

## 结论

前端单测、后端单测、生产构建、桌面 E2E **通过**；ESLint **未全绿**，后端没有 API 级集成测试，E2E 用的是 mock API。演示可以用，但不能说“生产 Ready”。

| 检查 | 结果 | 证据 |
|---|---|---|
| 前端单元/组件 | **29 个文件 / 232 个用例通过** | `npm test`，2026-11-16 22:51，20.88s |
| 后端单测 | **8 个 unittest + 11 个裸函数，全部通过** | `python scripts/run_unit_tests.py`，`unittest=8 failures=0 errors=0 bare=11/11` |
| 生产构建 | **通过** | `npm run build`，1.39s；入口 `dist/assets/index-DuVoHX1q.js` 80.97 kB / gzip 23.03 kB |
| 桌面 E2E | **26 通过 / 1 跳过** | `npm run test:e2e -- --project=chromium-desktop`，14.8s；刷新了 2026-11-16 视觉基线 |
| 全部 E2E 项目 | **50 通过 / 31 跳过 / 0 失败** | `npm run test:e2e`，25.8s；桌面 + 窄屏 + 移动 |
| 后端字节码 | **通过** | `python -m compileall -q app`，exit 0 |
| ESLint | **未通过：31 problems（26 errors / 5 warnings）** | `npm run lint` |

## 前端单测

```text
Test Files  29 passed (29)
Tests       232 passed (232)
Duration    20.88s
```

29 个文件 = `src/__tests__` 28 个 + `tests/contracts` 1 个。之前有 1 个失败，失败在 `tests/contracts/regressionContracts.test.ts` 仍期待旧的轮询间隔 `3000/10000`；实际 `src/hooks/useAiJobCenter.ts` 已是有意改成前台 5000 / 后台 20000。改契约期望后全绿，产品行为没有回退。

## 后端单测

本轮新增 `backend/scripts/run_unit_tests.py`，把两种测试形态统一成一条命令：

```bash
docker compose exec backend python scripts/run_unit_tests.py
```

结果：

```text
Ran 8 tests ... OK
RESULT unittest=8 failures=0 errors=0 bare=11/11
```

- `unittest`：`test_ai_job_rules` 5 条、`test_sprite_quality` 3 条。
- 裸函数：`test_ai_job_recovery` 3 条、`test_query_rewrite` 4 条、`test_video_reference_intents` 4 条。
- 合计 **19 条**。之前裸函数要手工 import，仓库又没有 pytest；现在这个 runner 不依赖 pytest，容器里直接跑。

## 桌面 E2E

本轮把 `tests/e2e/layout.spec.ts` 的测试脚手架修到当前 3.0 行为：

- 注册默认关闭后，`prepareApp` 不再依赖“去注册”建登录态；改为注入 `p2m-auth-user-id=1` / `p2m-role=member`，并让 `/api/auth/me` 返回带 `id` 的用户。
- 补 mock `**/api/calendar-events**` 和 `**/api/admin/generate-thumbnails`；后者未 mock 会 401，触发 authStore 清会话，测试直接掉回登录页。
- 页签文案从「日历2」改「周历」；时间中心断言从已删除的「时间任务表」改为当前「当前时间 / 正计时」。
- 拖拽日程断言从“第一个可见”改为 `toHaveCount(1)`：待办被折叠分组时 DOM 存在但不可见，旧断言把正常 UI 行为判成失败。
- 视觉基线用 `--update-snapshots` 刷新到 2026-11-16；这是 UI 设计刷新后的预期差异，不是布局溢出。断言里的 `expectNoHorizontalOverflow` 仍然保留并通过。

结果：桌面项目 **26 passed / 1 skipped**；三个项目合计 **50 passed / 31 skipped / 0 failed**。31 个跳过里，一部分是移动/窄屏项目本来就不执行的用例；另一部分是 3 条桌面专用日历场景（拖拽泳道、右侧待办面板、周切换），在窄屏/移动上侧栏或入口不同，显式标了 skip，不伪装成通过。

边界：E2E 走 mock API，只能证明布局、交互和状态没有明显回归，**不能证明真实后端链路通**。真实后端 smoke 仍未做。

## ESLint：31 个问题，没为了变绿改行为

`npm run lint` 当前是 `31 problems (26 errors, 5 warnings)`。代表性问题：

- `react-hooks/set-state-in-effect`：`SubtitleEditDialog.tsx`、`useWatchTelemetry.ts` 等在 effect 内同步 `setState`。
- `react-hooks/refs`、`react-refresh/only-export-components`：若干页面组件。
- `@typescript-eslint/no-explicit-any`：`VideoList.tsx` 等。
- `no-regex-spaces`：`tests/contracts/regressionContracts.test.ts`。
- `react-hooks/exhaustive-deps` warning：`VideoList.tsx` 的 `useMemo`。

这些是既有代码的规则债，不是本轮演示功能引入的。没有为了 Lint 全绿去重构 hooks 或组件边界；演示时如实说“Lint 未全绿”。

## 视觉基线变更

本轮刷新了 `tests/e2e/layout.spec.ts-snapshots/*.png`。原因：

- 侧栏页签「日历2」改为「周历」。
- 时间中心页面重做，旧文案「时间任务表 / 统一管理计时…」已不存在。
- 聊天历史标题改为“主题 + `#id` + 条数 + 时间”，不再是清一色「学习对话」。
- 相关片段卡片默认关闭（`features.ts:21` `chatVideoReferences=false`），后端仍返回 references，前端不渲染。

这些是已知、有意的 UI 变化；如果要做严格的像素审查，应逐张看 `test-results` 的 diff，而不是只看“绿了”。

## 本轮没验证的

- **真实后端 E2E / API 集成**：没有起 `TestClient` 按端点断言鉴权、隔离、限流；E2E 全是 mock。
- **真实转写吞吐**：没有跑 Whisper；腾讯云 demo 是预置字幕/转译。
- **worker 强杀恢复**：状态判定单测通过，但没有在真实 Redis/RQ 上强杀 worker 复现。
- **Redis 暂停键重启是否丢态**、定时 recover stuck、前端筛选持久化：未实测。
- **配额与限流**：代码口径已核对，但没有压测 20 次/分钟、200 次/天等边界。
- **ESLint 全绿**：没有。
- **窄屏/移动端的日历拖拽、右侧面板、周切换**：没有真正覆盖；3 条桌面专用用例在窄屏/移动显式跳过。

## 演示时怎么讲

> 这版前端 232 个用例、后端 19 条单测、生产构建和桌面 E2E 都过了；Lint 还有 31 个既有规则问题，后端没有 API 级集成测试。演示环境是 mock/预置数据，不是生产。

这句话比“全部完成”更可信，也和 `docs/demo/architecture-demo.html` 的边界一节一致。

## 复现命令

```powershell
cd C:\Users\yeb12\WorkBuddy\Worktrees\SiteYeb\p2u-3-0-langchain-529238b4

npm test
npm run build
npm run lint

docker compose exec backend python scripts/run_unit_tests.py
docker compose exec backend python -m compileall -q app

npm run test:e2e -- --project=chromium-desktop
# 视觉基线有意变化时才用：
# npm run test:e2e -- --project=chromium-desktop --update-snapshots
```
