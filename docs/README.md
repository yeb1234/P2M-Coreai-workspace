# 文档索引

> 状态：现行（最后校对 2026-11-21）

这份索引管全项目的文档：哪个文件讲什么、现在还可不可信、最后一次对照代码是哪天。写新文档或改老文档前，先在这里定位，不要另起一套。

代码基线：`main` 已合并 7.0（`feat/7.0-framework-overhaul`），发布标签 `v7.0.0`；6.0 对照线 `P2U-3.0-LangChain` 冻结在 `cae8d1b` / `v6.0.0`。

## 状态怎么读

每个文档一级标题下都有一行 `> 状态：…`，取值只有这几类：

| 标记 | 含义 | 能不能照着操作 |
|---|---|---|
| 现行 | 与当前代码一致，本次逐条核对过 | 能，直接照做 |
| 事实已核实 | 端口、路径、命令、参数都对过源码与配置 | 能 |
| 部分现行 | 主体可信，文中某些段落已标「已删 / 已改 / 历史」 | 能，但要看清标注 |
| 历史参考、历史快照、历史留档 | 某时点的事实记录，只作背景与沿革 | 不要照着操作，以现行文档为准 |

历史文档不删，过期只在文头标注 + 就地加「后续变化」注记。真要合并或归档，先写进变更清单再动。

## 全局口径（2026-11-16）

端口、数据量、页面数这类数字全项目只在这里和对应文档里各说一次；发现两处不一致，以代码为准并回来改索引。

### 端口与入口

2026-11-16 整体换号：`<服务前缀><两位项目号>`，固定五位；`123` 前端 Web、`124` 后端 API、`125` 数据库、`126` 缓存/中间件。P2 尾号 `02`。

| 用途 | 端口 | 说明 |
|---|---|---|
| 前端 Web | `80`、`12302` | 同一个 nginx；`80` 是宿主 localhost 入口，P2 独占 |
| 后端 API | `127.0.0.1:12402` | 只绑回环；对外统一走 `http://localhost/api` |
| 前端 dev | `12322` | Vite，`/api` 代理到 `127.0.0.1:12302` |
| PostgreSQL | `127.0.0.1:12502` | 只绑回环 |
| Redis | `127.0.0.1:12602` | 只绑回环 |
| 监控 | 未分配 | 旧 `11162` 作废，不再沿用 |

已作废、不要再出现的写法：`11000+(n−1)×100` 号段、`11102` / `11112` / `11122` / `11132` / `11142` / `11162`、「backend 不映射宿主端口」。

### 数据基线（截至 2026-11-16）

| 项 | 数量 |
|---|---|
| `videos` | 14,327 |
| `content_chunks` | 60,259（向量覆盖 100%） |
| `subtitle_segments` | 3,593,723 |
| 有字幕视频 | 8,785 |
| SpringBoot 视频 | 22 个（第 5 章 8 / 第 6 章 14） |

引用这些数字时带上「截至 2026-11-16」，重新统计后回来改这一张表。

### 结构计数（口径写在括号里）

- 前端页面 29 个（`src/config/pageRegistry.tsx` 第 59–87 行注册的 key，含 `calendar2`；侧栏三组 7 / 9 / 13 相加也是 29）
- zustand store 12 个（`src/stores/` 不含 `index.ts`）；hook 12 个（`src/hooks/` 不含 `index.ts`）
- dashboard 插件 5 个（`src/plugins/`，`registry.ts` + `registerAllPlugins`）
- 后端 router 15 个（`main.py` 的 `include_router` 计数，含 `mcp`）；service 44 个（`backend/app/services/*.py`，不含 `__init__.py`）；ORM 模型 21 个（`models.py` 的 `__tablename__` 计数）
- 测试：`src/__tests__` 28 个文件 + `tests/contracts` 1 个 = 29 个文件 / 232 个用例；`tests/e2e` 1 个规格（桌面 26 passed / 1 skipped，三项目合计 50 passed / 31 skipped / 0 failed）；`backend/tests` 8 个 `.py`。后端**没有** API 级集成测试，`pytest` 尚未加入运行镜像。

## 项目根目录的门面文档

| 文件 | 用途 | 状态 | 最后校对 |
|---|---|---|---|
| [README.md](../README.md) | 项目总览、能力清单、五服务 compose 与端口、启动方式、技术栈 | 现行 | 2026-11-16 |
| [README_cn.md](../README_cn.md) | 与 README 对应的中文版，多了 3.0 架构 / 安全 / 会话 / 部署几块 callout | 现行 | 2026-11-21 |
| [backend/README.md](../backend/README.md) | 后端入口：14 路由前缀、服务分组、两队列与状态机、迁移双机制、环境变量、安全要点 | 现行 | 2026-11-16 |
| [CHANGELOG.md](../CHANGELOG.md) | 面向用户的版本变化（现行记录以这份为准） | 现行 | 2026-11-16 |
| [BUGFIXES.md](../BUGFIXES.md) | 缺陷修复台账，带 commit 溯源 | 现行 | 2026-11-16 |
| [PERFORMANCE.md](../PERFORMANCE.md) | 性能与规模实测记录、检索延迟、库量 | 现行 | 2026-11-16 |
| [ai-job-center-refactor-report.md](../ai-job-center-refactor-report.md) | AI 任务中心那轮重构的方案与过程 | 历史参考 | 2026-11-16 |

## docs/ 目录

### 上手与排障

| 文件 | 用途 | 状态 | 最后校对 |
|---|---|---|---|
| [run.md](run.md) | 本机怎么起：启动菜单、端口、dev 代理、常见起不来 | 事实已核实 | 2026-11-16 |
| [testing-workflow.md](testing-workflow.md) | 测试怎么跑、当前测试盘点与覆盖缺口（后端无 API 级集成测试） | 部分现行 | 2026-11-16 |
| [frontend-build-issue.md](frontend-build-issue.md) | 一次前端构建失败的完整排查留档（坑已不存在） | 历史留档 | 2026-11-16 |

### 部署与运维

| 文件 | 用途 | 状态 | 最后校对 |
|---|---|---|---|
| [docker.md](docker.md) | 五服务 compose：镜像、卷、端口、健康检查、常用命令 | 事实已核实 | 2026-11-16 |
| [runtime-paths.md](runtime-paths.md) | 运行路径与视频库：`VIDEO_HOST_PATH`、容器 `/videos`、相对路径与跨盘挂载 | 现行 | 2026-11-16 |
| [deploy.md](deploy.md) | 部署与回滚主流程：构建、探针、HTTPS、备份恢复、排障 | 事实已核实 | 2026-11-16 |
| [deploy-tencent.md](deploy-tencent.md) | 腾讯云覆盖层：资源上限、日志轮转、配额与限流、内网 embedding | 事实已核实（容量为历史估算） | 2026-11-16 |
| [logging.md](logging.md) | 日志双通道、JSONL 字段、脱敏、logq 查询；Alembic 把 root logger 打哑的那个坑 | 事实已核实 | 2026-11-16 |
| [migrations.md](migrations.md) | 迁移现状：Alembic 两 revision 与旧 `migrations.py` / `ensure_runtime_schema` 并存 | 事实已核实 | 2026-11-16 |
| [background-tasks.md](background-tasks.md) | 两套后台任务：`ai_jobs` 队列 + 前端任务中心 vs `background` 队列 | 事实已核实 | 2026-11-16 |

### 检索与记忆

| 文件 | 用途 | 状态 | 最后校对 |
|---|---|---|---|
| [retrieval-metadata-design.md](retrieval-metadata-design.md) | 检索主设计：三路召回 + 加权 RRF、df 闸门、重排降级、引用链路 | 现行 | 2026-11-16 |
| [retrieval-tuning.md](retrieval-tuning.md) | 调参与 A/B 评估方法，哪些阈值结论还成立 | 部分现行 | 2026-11-16 |
| [retrieval-iteration-report.md](retrieval-iteration-report.md) | 2026-11-16 那批 demo 调参过程记录 | 历史过程记录 | 2026-11-16 |
| [memory-system-design.md](memory-system-design.md) | 记忆四层结构、压缩与抽取参数、**已知缺陷四条** | 部分现行 | 2026-11-16 |
| [data-quality-cleanup.md](data-quality-cleanup.md) | 入库到检索的四段清洗管线、去重与广告清理 | 部分现行 | 2026-11-16 |
| [storage-sync-audit.md](storage-sync-audit.md) | 前端存储矩阵：IndexedDB 双写 / 纯本地 / 后端同步各归谁 | 部分现行 | 2026-11-16 |

### 架构与工程治理

| 文件 | 用途 | 状态 | 最后校对 |
|---|---|---|---|
| [2026-11-21-7.0-framework-overhaul.md](2026-11-21-7.0-framework-overhaul.md) | 7.0 框架级重构：monorepo、配置资产版本库、发布与回退 | 现行发布记录 | 2026-11-21 |
| [2026-11-20-6.0-smartagents-release.md](2026-11-20-6.0-smartagents-release.md) | 6.0 SmartAgents 发布说明：工具与模型解耦、HITL 写动作、审计与撤回 | 历史发布记录（对照线保留） | 2026-11-20 |
| [project-structure.md](project-structure.md) | 目录树与结构计数（第一节现状；后面几节是未执行的重构提案） | 部分现行 | 2026-11-16 |
| [maintainability.md](maintainability.md) | 分层与依赖方向、坏味道清单、已修与未修技术债 | 部分现行 | 2026-11-16 |
| [security-audit.md](security-audit.md) | 两轮安全审计：Cookie/CSRF、五档限流、安全头、SSRF、遗留项复核表 | 历史审计记录（已复核） | 2026-11-16 |
| [lessons.md](lessons.md) | 踩过的开关、鉴权、并发类教训，多数仍适用 | 现行 | 2026-11-16 |
| [codex-improvements.md](codex-improvements.md) | 早期结构拆分与编码约定的改进清单 | 部分现行 | 2026-11-16 |
| [multi-user-report.md](multi-user-report.md) | 多用户隔离的诊断报告与越权结论 | 历史诊断报告 | 2026-11-16 |
| [release-3.0.0-beta.md](release-3.0.0-beta.md) | 3.0.0-beta 发布记录、破坏性变更与升级步骤 | 历史发布记录 | 2026-11-16 |
| [PR-design-system.md](PR-design-system.md) | 设计系统重构 PR 记录，颜色变量化方案仍现行 | 历史 PR 记录 | 2026-11-16 |
| [2026-11-15-3.0-architecture.md](2026-11-15-3.0-architecture.md) | 3.0 架构重构快照与决策过程 | 历史架构快照 | 2026-11-16 |
| [mcp.md](mcp.md) | 笔记 AI 与 MCP HTTP/stdio 接入、工具清单、写操作确认约定 | 现行 | 2026-11-19 |
| [adr/0002-note-ai-and-mcp.md](adr/0002-note-ai-and-mcp.md) | 笔记 AI 无状态边界、动作确认、MCP 注册表与双传输决策 | 现行 | 2026-11-19 |

### 2.x 历史报告与路线

| 文件 | 用途 | 状态 | 最后校对 |
|---|---|---|---|
| [2026-05-11-2.5-technical-report.md](2026-05-11-2.5-technical-report.md) | 2.5 技术报告 | 历史参考 | 2026-11-16 |
| [2026-05-11-2.6-technical-report.md](2026-05-11-2.6-technical-report.md) | 2.6 技术报告 | 历史参考 | 2026-11-16 |
| [2026-05-12-2.7-technical-report.md](2026-05-12-2.7-technical-report.md) | 2.7 技术报告 | 历史参考 | 2026-11-16 |
| [2026-05-13-2.91-technical-report.md](2026-05-13-2.91-technical-report.md) | 2.91 技术报告 | 历史参考 | 2026-11-16 |
| [2026-05-16-2.92-technical-report.md](2026-05-16-2.92-technical-report.md) | 2.92 技术报告 | 历史参考 | 2026-11-16 |
| [changelog.md](changelog.md) | 2.5–2.92 详细变更记录（现行变更看根 [CHANGELOG.md](../CHANGELOG.md)） | 历史参考 | 2026-11-16 |
| [2.6-roadmap.md](2.6-roadmap.md) | 2.6 路线图，各条已补「已完成 / 待做 / 部分推进」复核状态 | 部分现行 | 2026-11-16 |
| [next-improvement-todo.md](next-improvement-todo.md) | 待改进清单，已勾项对照代码核实 | 部分现行 | 2026-11-16 |
| [today-fixes-and-pitfalls.md](today-fixes-and-pitfalls.md) | 2026-05-10～05-14 的踩坑合集，仍适用的按主题保留 | 部分现行 | 2026-11-16 |

### PR 记录

PR 目录自己有索引，从这里进入即可，不再重复列一份：[pr/README.md](pr/README.md)（PR-001 安全加固 / PR-002 会话 Cookie / PR-003 存储治理 / PR-004 学习路径）。

### 专题与留档

| 文件 | 用途 | 状态 | 最后校对 |
|---|---|---|---|
| [project-story.html](project-story.html) | 可直接打开的项目故事页：来龙去脉、架构、检索与记忆怎么长出来的 | 现行复盘页 | 2026-11-16 |
| [demo-video-script.md](demo-video-script.md) | 旧版演示视频脚本，保留作对照；新脚本见 `demo/` | 部分现行 | 2026-11-16 |
| [theme-import-export.md](theme-import-export.md) | 主题导入导出的 JSON 格式与校验规则 | 现行 | 2026-11-16 |
| [todo-reminder-input-rules.md](todo-reminder-input-rules.md) | 待办快捷输入与提醒规则，解析器已落地 | 部分现行 | 2026-11-16 |
| [folder-checkbox-filter-fix.md](folder-checkbox-filter-fix.md) | 文件夹勾选筛选的修复记录（已落地） | 历史参考 | 2026-11-16 |

### 演示与腾讯云

| 文件 | 用途 | 状态 | 最后校对 |
|---|---|---|---|
| [demo/README.md](demo/README.md) | 演示素材包入口：先看哪个、边界、三条动线 | 现行 | 2026-11-16 |
| [demo/architecture-demo.html](demo/architecture-demo.html) | 单文件可交互架构页：5 个视角、动画、明暗主题、实拍截图 | 现行 | 2026-11-16 |
| [demo/highlights.md](demo/highlights.md) | 8 个亮点：一句话、证据、讲法、不要说过头 | 现行 | 2026-11-16 |
| [demo/demo-script.md](demo/demo-script.md) | 8 分钟逐字稿 + 60 秒/3 分钟压缩版 + 录屏检查 | 现行 | 2026-11-16 |
| [demo/evaluation.md](demo/evaluation.md) | 本轮测试、构建、Lint、E2E 结果与未覆盖项 | 现行 | 2026-11-16 |
| [demo/diagrams.md](demo/diagrams.md) | 5 张 Mermaid 架构图 + 端口资源表 | 现行 | 2026-11-16 |
| [tencent-cloud-ready-demo.md](tencent-cloud-ready-demo.md) | 腾讯云轻量假演示：规格、启动、预置数据、边界 | 演示方案 | 2026-11-16 |
| [tomorrow-worker-batch.md](tomorrow-worker-batch.md) | 2026-11-17 本机 worker 全天批处理：队列顺序、向量化判断、雪碧图与转写边界 | 现行 | 2026-11-16 |

### 变更与校对记录

| 文件 | 用途 | 状态 |
|---|---|---|
| [docs-refresh-2026-11-16.md](docs-refresh-2026-11-16.md) | 2026-11-16 全量文档校正的变更清单：逐文件改了什么、依据哪行代码、哪些留待确认 | 现行 |

## 写文档的三条约定

1. **文头必须有状态标记**，格式见上表；历史文档改正文只改会误导操作的地方，其余保留原叙述并加注记。
2. **数字带口径和截止日期**。「60,259 条」要写成「截至 2026-11-16，`content_chunks` 60,259 条」；核不到的写「未核实」，不要估。
3. **端口、路径、参数只从代码和配置抄**。写完在 `docker-compose.yml`、`vite.config.ts`、`settings` 里各回查一遍；发现文档和代码不一致，改文档，别改代码。
