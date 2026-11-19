# 2026-11-16 文档全量校正变更清单

> 状态：现行（2026-11-16 生成）

## 一、范围与方法

- 基线：worktree `C:\Users\yeb12\WorkBuddy\Worktrees\SiteYeb\p2u-3-0-langchain-529238b4`，分支 `polish/design-system-refresh`，HEAD `9a13650`。旧仓 `C:\SiteYeb`（代码已废弃）不在范围内。
- 覆盖 49 篇 Markdown（根目录 6 篇 + `backend/README.md` + `docs/` 下 42 篇）与 1 个故事页 `docs/project-story.html`，合计 50 个文件；新建 `docs/README.md`（索引）与本清单。
- 方法：逐篇读原文 → 到源码 / 配置 / `git log` 核每一条可验证断言 → 就地改 → 记录依据行号。分工按文档域切成 6 组并行执行，最后由协调方统一口径、合并清单。
- 边界：只动文档。未改 `src/`、`backend/app/`、`backend/alembic/`、`docker-compose*.yml`、`Dockerfile`、`nginx.conf`、`Caddyfile`、`.env`、`package.json`、`vite.config.ts`、`playwright.config.ts`、`scripts/`；未执行 `git add` / `commit`，未跑 docker，未连库。
- 另一个智能体正在改的工作台首页插件与投影同步（`src/components/dashboard/*`、`src/components/calendar/calendarDerivedData.ts`、`src/lib/projections/`、`src/hooks/useDashboardProjectionRefresh.ts`、3 个 `dashboard*Sync.test.tsx`）在文档中一律标「进行中」，没有一处写成已完成。

## 二、全局口径变更（这次影响面最大的几条）

### 1. 端口整体换号

| 用途 | 旧（已作废） | 新（2026-11-16 起） |
|---|---|---|
| 前端 Web | `11102` | `80`（宿主 localhost 入口）+ `12302`（第二入口，同一 nginx） |
| 后端 API | `11112`；期间一度「不映射宿主端口」 | `127.0.0.1:12402`，只绑回环；对外仍走 `http://localhost/api` |
| 前端 dev | `11122` | `12322`（= `12302 + 20`），`/api` 代理到 `127.0.0.1:12302` |
| PostgreSQL | `11132` | `127.0.0.1:12502` |
| Redis | `11142` | `127.0.0.1:12602` |
| 监控 | `11162` 预留 | 未分配，不编新号 |

规则：`<服务前缀><两位项目号>`，固定五位；`123` 前端 Web / `124` 后端 API / `125` 数据库 / `126` 缓存中间件，P2 尾号 `02`。旧的 `11000+(n−1)×100` 号段说法全部作废。

依据：`docker-compose.yml` 头部注释与 `postgres`(75) / `redis`(107) / `backend`(135) / `frontend`(407-408) 的 `ports` 块；`vite.config.ts:12,16`；`playwright.config.ts:12,17`。

### 2. 「相关片段」卡片默认不渲染

`src/config/features.ts:21` 的 `FEATURES.chatVideoReferences = false`（2026-11-16 起）。关闭只影响渲染：`ReferenceBlock`、`dedupeReferences`、后端 `chat_agent` 的 references 生成全部保留，改回 `true` 重建前端即恢复。后端仍照常生成 references，前端不渲染。

凡原文把该卡片写成现役功能的，均按此改写；检索文档里「trace 命中 → 挂引用卡片」的链路描述改成「trace 命中用于组织 references，前端当前不渲染」。

### 3. 结构与计数改按代码实测

| 项 | 旧说法 | 实测 |
|---|---|---|
| 注册页面 | 35 | **29**（`pageRegistry.tsx:59-87` 的 29 个 key，含 `calendar2`；侧栏 7 / 9 / 13 相加同为 29） |
| zustand store | 13 | **12**（`src/stores/` 不含 `index.ts`） |
| hook | 13 | **12**（`src/hooks/` 不含 `index.ts`） |
| 后端 router | 15 | **14**（`main.py` 的 `include_router` 14 处） |
| 后端 service | 39 | 39 个已跟踪 **+ 1 个未提交**（`daily_digest.py`，未计入） |
| 后端测试 | 6 | **5** 个 `.py`（`ai_job_recovery` / `ai_job_rules` / `query_rewrite` / `sprite_quality` / `video_reference_intents`） |
| Alembic | 仅按文件名写 | 2 个 revision：`ed9ec716c9b0`（`2026_11_16_1356` baseline，`down_revision=None`）→ `f2f5d8064921`（`2026_11_16_1358` notes 索引对齐） |

其余不变：`src/__tests__` 28 个测试文件、dashboard 插件 5 个、ORM 模型 21 个、`tests/` 只有 `contracts` 与 `e2e`、后端无 API 级集成测试。

### 4. 数据基线统一标「截至 2026-11-16」

`videos` 14,327 / `content_chunks` 60,259（向量覆盖 100%）/ `subtitle_segments` 3,593,723 / 有字幕视频 8,785 / SpringBoot 视频 22 个（第 5 章 8、第 6 章 14）。

## 三、逐文件变更清单

### 根目录门面文档与后端 README（7 篇）

| 文件 | 处理 | 改了什么 | 依据 |
|---|---|---|---|
| `README.md` | 改写 | 删「当前版本 2.92」「数据主要落在 SQLite」与内嵌旧版本小节（沿革归根 `CHANGELOG.md`）；重写能力清单（29 页面 / 三组导航 / 5 插件 / 9 工具 Agent / 四层记忆 / 三路召回参数）、五服务 compose 表、新端口表、启动命令、实测版本技术栈、测试盘点；补卡片开关关闭注记 | `package.json:2,4,16-47`；`docker-compose.yml:9,75,107,135,407-408`；`pageRegistry.tsx:59-87`；`features.ts:21`；`requirements.txt:2-36`；`models.py:112-147` |
| `README_cn.md` | 改写 | 与 `README.md` 逐项对齐；清掉 5002 / 8100 / SQLite / 旧端口；底部文档清单改指向本索引；去掉本轮无法实测的 pgvector 补丁号 | 同 `README.md`；`.env.example:74,95-97` |
| `BUGFIXES.md` | 局部修补 | 新增 2026-11-16 四条：running 僵尸任务自愈扩扫（`a357a8c`）、上一轮片段跟新问题跑（`9a13650`）、同片段两层去重（`9a13650`）、运行中取消按钮解禁 + `cancelling` 态（`a357a8c`）；历史条目与 commit 原样保留 | `admin_ai_queue.py:610,619-622,644-645`；`git show 9a13650`、`git show a357a8c`；`AIChatPanel.tsx:863,888`；`tools.py:475-485` |
| `CHANGELOG.md` | 局部修补 | 补两条用户可感知变化（视频库字幕内容搜索、运行中转写可取消）；补 references 开关关闭注记；2.91/2.92 历史条目原样保留 | `git show 9a13650`、`git show a357a8c`；`features.ts:21` |
| `PERFORMANCE.md` | 局部修补 | 库量 60,307 → 60,259；旧容器名改 compose 生成名；多用户脚本宿主地址改 `localhost` / 12402；补开关注记；历史实测数字按当时快照保留 | 数据基线；`docker-compose.yml:30,75,107,135`；`backend/scripts/test_multi_user.py:26` |
| `ai-job-center-refactor-report.md` | 局部修补（历史参考） | 新增「与现状差异」节：SQLite→PG、队列工厂现于 `rq_client.py` + `background_tasks.py`、状态机多 `cancelling`、`AiJob` 无 `job_type`、`todoStore.ts` 已移除；仍成立项（两队列分工、RQ SimpleWorker、DB 行进度 + 自愈）标明 | `rq_client.py:66,106`；`background_tasks.py`；`models.py:112-147`；文件清单逐项 Test-Path |
| `backend/README.md` | 改写 | 旧 SQLite / FTS5 / `C:/SiteYeb` / 8000 直连全部替换：PG17+pgvector、14 路由前缀表、39 服务分组、两队列与状态机、迁移双机制、环境变量表、12402 回环、5 个后端测试、安全要点；CORS 并列两套口径 | `routers/*.py` 前缀；`services/` 39 个；`models.py` 21 类；`alembic/versions/` 两文件；`.env.example:74`；`auth.py:37-52` |

### 部署与运维（8 篇）

| 文件 | 处理 | 改了什么 | 依据 |
|---|---|---|---|
| `docs/docker.md` | 改写 | 项目名 `p2-siteyeb`、无 `container_name`（生成 `<项目>-<服务>-1`）；新端口表 + 11112 标作废 + 监控未分配；命名卷仅 `siteyeb-pgdata`/`siteyeb-redis`，产物目录为绑定挂载；backend 12402 常驻回环发布 | `docker-compose.yml:6,28-30,75,107,123,135,226-234,260-271,386,407-408`；`nginx.conf:100`；`vite.config.ts:12,16` |
| `docs/deploy.md` | 改写 | 构建 / 探针 / HTTPS / 备份恢复 / 自检 / 排障重写；API 统一写 nginx `/api`，12402 仅调试；备份表更正为 `content_chunks.halfvec(1024)`，旧 `segment_embeddings` 标注已删；补数据基线 | `docker-compose.yml:135,234,370,407-408`；`main.py:266-321,324-357`；`scripts/backup.sh:16,35-52`；`scripts/restore.sh:20,36-53`；`tables.py:57-82` |
| `docs/deploy-tencent.md` | 改写 | 覆盖层资源与日志轮转按 yml 核对；配额与限流表按代码重核（chat 200 / 管理员 1000，plan 20 / 100；chat 20/min、plan 6/10min；登录 IP 30、账号 8/15min；注册 5/h）；embedding 为可选 profile 不映射宿主口；容量数字标历史估算 | `docker-compose.tencent.yml:12-60,65-88`；`quota.py:98-103`；`rate_limit.py:59-67`；`database.py:158-161` |
| `docs/run.md` | 改写 | 启动菜单对照 `start.bat`/`start.sh`；端口换新号并保留 11112 作废行；dev 12322 代理 12302；旧「60,422 块」基线改 60,259 | `start.bat:48-59,125,143`；`start.sh:9-16,31,44-87`；`docker-compose.yml:75,107,135,407-408` |
| `docs/logging.md` | 改写 | 落盘路径更正 `./logs:/data/logs`（`backend.jsonl` / `worker.jsonl`）；静默成因写准：`fileConfig` 清空 root handler 且 `disable_existing_loggers=True` 关已有 logger；明确「加 `disable_existing_loggers=False` 无效」，正确做法是不让旧调用触发 `fileConfig`（`skip_logging_config` 保护链路） | `observability.py:42-69,94-122,144-177,200-251`；`database.py:47-48,411`；`alembic/env.py:56-57`；`worker.py:55-57`；`scripts/logq.mjs:5-11,131,145` |
| `docs/migrations.md` | 改写 | 写明 Alembic 与 `migrations.py` + `ensure_runtime_schema` 两套并存（未写成已迁完）；版本链 `ed9ec716c9b0`→`f2f5d8064921`；PG 先 `upgrade head` 再 `upgrade_postgres`，SQLite 走 legacy；`content_chunks` 独立 MetaData 不进 Alembic；旧「262 列 / 82 索引」标未复核 | `database.py:381,384-431,437-463`；`migrations.py:84-210,212,320`；`alembic/env.py:17-25,56-57,96-121`；`tables.py:35-82` |
| `docs/background-tasks.md` | 改写 | `ai_jobs` 队列 + 前端任务中心（`/api/ai-jobs`，管理员）vs `background` 队列无独立前端；worker 为 RQ `SimpleWorker`（Windows 下 `WindowsWorker`），双队列名 `ai-worker-{pid}`；`chunk_index` 投递链路；缩略图走进程内线程池，旧 `thumbnail` 注册为死代码；10 条管理接口按路由重核 | `worker.py:47-49,55-57,64-86,100-107`；`rq_client.py:69,114`；`routers/ai_jobs.py:22,53,60,65`；`ai_job_tasks.py:33,47,133,175`；`thumbnail_worker.py:80-93,130,207-237` |
| `docs/frontend-build-issue.md` | 仅加状态标记 | 改「历史记录（问题已不存在，仅留档）」；补 2026-11-16 复核：`journey` 条目现存、`./dist` 挂载仍在（开发便利，生产应删）；原排查过程与教训原样留档 | `pageRegistry.tsx:26,68,122`；`uiStore.ts:7,15`；`docker-compose.yml:378-379,386` |

### 检索、记忆、数据质量（6 篇）

| 文件 | 处理 | 改了什么 | 依据 |
|---|---|---|---|
| `docs/retrieval-metadata-design.md` | 改写 | 三路 RRF（权重 lexical 0.8 / vector 1.2 / meta 1.5，`RRF_K=60`）、两道 df 闸门、位置系数、java 排除/展开与 df 口径（1,119→11）、`RERANK_MIN_SCORE` 两处取值（`.env` 0.10 / settings 默认 0.02）逐条核到行号；引用链路按开关现状改写；端口换新号；旧 60,307 等测量值标历史或未核实 | `hybrid_search.py:33,318-324,347-352,503,530,557`；`lexical.py:38-50,68-92,165,277,314,346-358,429-484,538,547`；`retrieval_meta.py:68-97`；`database.py:84,90,93`；`.env:53,100`；`tools.py:49-57,100,464-466`；`chat_agent.py:465,586-645`；`features.ts:21` |
| `docs/retrieval-tuning.md` | 局部修补 | 碎片模式与上下文扩展标历史已删；分块参数现行；调参现状表按代码更新（top_k 8 / candidate_k 30 / 三路权重 / min_vector_score 0.0）；修重排 fallback 与 `.env` 行号引用 | `chunker.py:14-17`；`hybrid_search.py:207-246,347-352,503,551-557`；`lexical.py:165`；`database.py:84,93` |
| `docs/retrieval-iteration-report.md` | 局部修补 | 标历史过程记录；§六参数现状表核到行号；demo 50 视频与 60,257 / 359 万标历史快照；两轮阈值实验（0.02→0.10）保留为当晚人工评测，生效值以 `.env` 0.10 为准 | `lexical.py:159`；`hybrid_search.py:33,347-352,503,557`；`.env:53,100` |
| `docs/memory-system-design.md` | 改写 | 重写为现行四层（`ChatMessage` / `ChatSession.summary` / `MemoryItem` / `UserData` KV）；压缩参数、字段、异步抽取参数逐条核到代码；**四条已知缺陷单列「已知缺陷」**（recall 不过滤 confidence/source 却注入为「用户已确认」；按 importance 而非相关性召回；去重只认完全相同字符串；TTL 两条写入路径都不传）；旧 Profile/Persona 设计稿存档 | `models.py:173-178,206-219,222-235,257-269,464-497`；`memory.py:27-28,251-396`；`memory_extract.py:29,88-166`；`memory_admin.py:36-37,167-176`；`chat_agent.py:164-184,207-249` |
| `docs/data-quality-cleanup.md` | 局部修补 | 四段入库/清洗管线现行；dry-run 数字与块跨度标历史；去重落地与存量残留标未核实；容器名与端口换新口径；补卡片开关注记 | `file_scanner.py:152-179`；`textclean.py:84,93,125`；`dedupe_videos.py:217`；`backend/Dockerfile:38,65`；`features.ts:21` |
| `docs/storage-sync-audit.md` | 改写 | 存储矩阵按 `idbStorage`（双写）/ `localOnlyStorage`（纯本地）归属修正；番茄钟 persist 纯本地 + 独立 `pomodoroSync` 三键同步；待办双轨读侧已收口 `scheduleStore`，列两项残留；历史数字标注；脚本现状更新 | `idbStorage.ts:49,61-72,102-105,158-181,208-241,258`；`pomodoroStore.ts:833-834`；`pomodoroSync.ts:4-6`；`types.ts:90-91`；`PrivacyDataSettings.tsx:23-30,139` |

### 架构与工程治理（10 篇）

| 文件 | 处理 | 改了什么 | 依据 |
|---|---|---|---|
| `docs/project-structure.md` | 改写 | 目录树逐层对齐文件系统：补 `backend/alembic/`、`src/plugins/`、`src/lib/projections/`、`src/config/features.ts`，删已不存在目录；计数全部带口径（29 / 12 / 12 / 5 / 14 / 39+1 / 21）；补卡片开关注记；进行中工作流只写「进行中」；`chatIntent.test.ts` 案例如数 18 条 | `pageRegistry.tsx:59-87`；`src/stores/`；`src/hooks/`；`main.py` `include_router` 14 处；`models.py` 21；`features.ts:17-21`；`hybrid_search.py:33,503` |
| `docs/maintainability.md` | 改写 | 分层与依赖方向复核；已修实例逐条标注（`delete_user` 清 14 模型、番茄回写、`emptyOutDir`、环境音按开关预加载、worker 异常兜底、`useTodoStore` 已删）；排查命令去掉已删项；坏味道表保留未修技术债 | `admin.py:488-515`；`pomodoroStore.ts:395-404`；`vite.config.ts:26`；`worker.py:119-120`；`background_tasks.py:69`；`ai_jobs.py:60,160,272` |
| `docs/security-audit.md` | 改写 | 遗留表加「复核状态（2026-11-16）」列；httpOnly Cookie、CSRF、五档限流、安全头、SSRF、admin 依赖落到具体文件；**CORS 列为配置一致性风险（不算已修）**；端口换新号、监控段未分配；Caddy 兜底与脚本旧名列入待确认；备份行改「脚本已备、定时/异地待部署」 | `auth.py:192-210`；`core/csrf.py`；`rate_limit.py:59-67`；`nginx.conf:70-208`；`admin.py:60`；`assistant.py:308-312`；`.env.example:74`；`docker-compose.yml:205,341`；`database.py:25` |
| `docs/2026-11-15-3.0-architecture.md` | 局部修补 | 标历史架构快照；补现行差异（四层记忆、RRF 加 meta 1.5 第三路、JWT 默认 12h、拓扑改「前端 → nginx:80/12302 → backend:8000（宿主 12402 回环）」）；§六遗留逐条标已修/未修；§七命令与 §八回滚标历史 | `models.py:176-178,206-219`；`hybrid_search.py:33,503`；`database.py:147`；`scripts/backfill_embeddings.py` 已不在仓 |
| `docs/release-3.0.0-beta.md` | 局部修补 | 标历史发布记录；§6 补 Alembic revision 链与两套机制并存说明；§8 脚本旧容器名列待确认；示例容器名改 compose 生成名 | `alembic/versions/` 两文件；`migrations.py`；`database.py` `ensure_runtime_schema` |
| `docs/PR-design-system.md` | 局部修补 | 标历史 PR 记录；预设主题 16 → 现行 14（`THEME_PRESETS`）；`todoStore` 遗留标已清理；颜色变量化方案仍现行 | `themes.ts:205-577`；`components/settings/types.ts:90`；`scheduleStore.ts` |
| `docs/multi-user-report.md` | 局部修补 | 标历史诊断报告；快照数字加基线注；`notes` scope/`user_id` 已落地复核；下一步复核状态表逐项标注；`admin` 用户名 `role=member` 标未复核；注册开关被 compose 覆盖的现状写清 | `models.py:176,178`；`docker-compose.yml:210,346`；`database.py:149` |
| `docs/codex-improvements.md` | 局部修补 | 旧结论标注：`services/assistant.py` 整模块已删、`todoCalendarSyncPlan` 0 引用已删、SQLite WAL 结论失效；队列暂停态改 Redis key `ai_queue:paused`；worker 异常兜底标已修；隐患表补复核状态列 | `admin_ai_queue.py:36`；`worker.py:119-120`；`chat_agent.py:23`；`tools.py:15`；`services/llm.py:43` |
| `docs/lessons.md` | 局部修补 | 三实例状态标注：`ENABLE_DOCS` 现行默认 `False`；`use_langchain` 假开关标历史（现真实 import langchain）；admin 端点无鉴权实例标已修（router 级 `require_admin`）；教训本身保留现行 | `database.py:147`；`chat_agent.py:23`；`tools.py:15`；`routers/admin.py:60` |
| `docs/testing-workflow.md` | 改写 | 第 0 节如实盘点：`src/__tests__` 28、`tests/contracts` 1、`tests/e2e` 1 规格（3 个 Chromium 项目）、`backend/tests` 5 个 `.py`；写明后端无 API 级集成测试；3 个裸 `def test_*` 需 pytest 但依赖未引、无 `conftest`；3 个 dashboard 测试标进行中；E2E `baseURL` 12322 | `src/__tests__/` 28 文件；`tests/contracts/regressionContracts.test.ts`；`tests/e2e/layout.spec.ts`；`playwright.config.ts:12,17,22-33`；`requirements.txt` 无 pytest |

### 2.x 历史报告与路线（9 篇）

| 文件 | 处理 | 改了什么 | 依据 |
|---|---|---|---|
| `docs/2026-05-11-2.5-technical-report.md` | 局部修补 | 文头历史标记；4 条「后续变化」注记：任务中心轮询改 5s/20s、`todoCalendarSyncPlan.ts` 已移除、端口换号（旧 5002 与 111xx 作废并给新号）、§22 建议多数未落地 | `vite.config.ts:12`；`useAiJobCenter.ts:378`；`database.py:3-7`；compose 各 `ports` |
| `docs/2026-05-11-2.6-technical-report.md` | 局部修补 | 文头历史标记；注记即时写入集合已扩到 4 个本地键；§12 升级点复核均未落地 | `idbStorage.ts:49`；`pomodoroSync.ts:4-6`；`models.py:272` |
| `docs/2026-05-12-2.7-technical-report.md` | 仅加状态标记 | 时区 / 排程 / 字幕纠错链路核实仍在；测试通过数保留当时快照 | `main.py:238`；`routers/videos.py:748`；`pomodoroSync.ts:95,117` |
| `docs/2026-05-13-2.91-technical-report.md` | 局部修补 | 文头历史标记；注记 `job_lifecycle.py` 已并入 `rq_client.py`；下载端点拆为 POST 触发 / GET 查询 | `rq_client.py:73-101`；`routers/admin.py:218,223`；`videoApi.ts:665` |
| `docs/2026-05-16-2.92-technical-report.md` | 局部修补 | 文头历史标记；删除文末游离 `</content>` 编辑残片；§五建议复核（`longBreakInterval` UI 已完成，其余未落地） | `PomodoroSettings.tsx:145` |
| `docs/changelog.md` | 局部修补 | 文头标历史并指向根 `CHANGELOG.md`；SQLite→PG、端口换号、模型名快照加注记；正文保留未删 | `database.py:3-7`；compose 各 `ports` |
| `docs/2.6-roadmap.md` | 改写 | 两张优先级表加「复核状态」列；§3–§11 逐条标待做 / 进行中 / 部分推进；§14 验收清单按现状更新 | `tests/e2e/` 仅 `layout.spec.ts`；`thumbnail_worker.py:129,144,187`；`routers/videos.py:142` |
| `docs/next-improvement-todo.md` | 局部修补 | 文头部分现行；未勾选项补现状（`src/components` 旧色值残留 57 处、三类 Playwright 场景待做）；已勾项抽样核实文件存在 | 旧色值命中 57 处；`tests/e2e/layout.spec.ts` |
| `docs/today-fixes-and-pitfalls.md` | 局部修补 | 文头部分现行 + 现行性复核总表；失效/变更条目内联注记（thumbnail 启用开关删除、`job_lifecycle` 并入、plan 文件移除、SQLite 迁移、下载端点方法变更） | `database.py:127,133-134`；`rq_client.py:73-101`；`uiStore.ts:233,240`；`routers/admin.py:218,223` |

### PR 记录与专题（10 个文件）

| 文件 | 处理 | 改了什么 | 依据 |
|---|---|---|---|
| `docs/pr/README.md` | 局部修补 | 补状态块（容器名 compose 生成、PG/Redis 端口换号、`/api` 入口仍有效）；修正 PR-004 失效链接；**未另起全站索引**（指向 `docs/README.md`） | `git log`：`5a82093` / `fb5f573` / `157a42c` 均在历史；`docker-compose.yml:75,107,135` |
| `docs/pr/PR-001-security-hardening.md` | 局部修补 | 加历史参考状态块；鉴权 / PBKDF2 600k / 网关限流核实现行；历史叙述与回滚记录原样保留 | `auth.py:38,47,52-53`；`routers/auth.py:254` |
| `docs/pr/PR-002-session-cookie.md` | 局部修补 | 加状态块；`p2m_session`、httpOnly + SameSite=Lax、12h（`Max-Age=43200`）、CSRF 核实现行；验证命令走 `http://localhost/api` | `database.py:144-145`；`core/csrf.py:40-41` |
| `docs/pr/PR-003-storage-governance.md` | 局部修补 | 注记 `segment_embeddings` 已删、当前同位置是 `content_chunks`；验证命令容器名改 `p2-siteyeb-postgres-1` / `p2-siteyeb-redis-1`；3,577,042 标提交当时、基线 3,593,723 | `migrations.py:125-127`；`docker-compose.yml:75,101-104,107` |
| `docs/pr/PR-004-learning-path.md` | 局部修补 | 加状态块；3 个端点、`get_my_learning_path` 工具、`p2m:play-video` 事件核实现行；「E2E 11 项全过」标当时快照 | `routers/learning.py:252,402`；`routers/assistant.py:154`；`tools.py:482`；`videoNavigation.ts:26` |
| `docs/project-story.html` | 改写 | 现状叙述改准：工具 8→9；RRF 补 meta 1.5；检索链路改三路召回 `candidate_k=30` → `rerank_top_n=20` → cross-encoder 优先、API 失败退 LLM、阈值 0.10、片段最多 5 张且开关默认关闭；向量规模改 60,259 / 8,785 有字幕 / 100% 覆盖；「186 万条 / 覆盖率 1.5%」等过期叙述改全量覆盖；记忆「等 20 秒」改后台异步（超时 40s）；四服务改五服务 | `tools.py:475-485`；`hybrid_search.py:503`；`database.py:84`；`.env` `RERANK_MIN_SCORE`；`features.ts:18-21`；`AIChatPanel.tsx:181` |
| `docs/project-story.html`（端口与附录命令） | 局部修补 | 附录 dev 去掉旧 `VITE_API_BASE_URL`，改 `npm run dev`（12322 → 代理 12302）；后端直连注释标回环 12402、对外仍走 nginx；清除旧号段与 111xx 表述、「不映射宿主端口」说法；迁移/回填脚本路径更正，回填命令去掉不存在的 `--all`；HNSW `m=16 / ef_construction=64` 标 pgvector 默认值 | compose 头部注释与各 `ports`；`vite.config.ts:12,16`；`migrate_sqlite_to_pg.py:253-257`；`backfill_chunk_embeddings.py:38-40`；`tables.py:77-78` |
| `docs/theme-import-export.md` | 仅加状态标记 | 与 `themes.ts` 逐条核对一致（`ThemeVars`、`generateThemeCss`、`parseThemeVarsText`、5 个深色主题、`kind=p2m-theme` `version=1`）；正文未动 | `themes.ts:1-13,55,85,109-112`；`themeImportExport.test.ts` |
| `docs/todo-reminder-input-rules.md` | 局部修补 | 部分现行状态块；「待抽函数」改已落地位置（`todoQuickInput.ts` 的 `parseTodoQuickInput`，接入 `TodoForm` / `InlineAddInput`）；番茄估算删死写示例，改述 `calculatePomodoroRounds` 规则 | `todoQuickInput.ts:4,12-17,110`；`pomodoroPlanning.ts:11-31,93-107`；`types/pomodoro.ts:43-46` |
| `docs/folder-checkbox-filter-fix.md` | 局部修补 | 历史参考状态块（修复已落地）；`category_ids` / `category_id` / `selectedFolderIds` 与六个文件仍存在；视频个数标当时演示快照 | `routers/videos.py:139-165,347,352`；`videoApi.ts:387-394,432-434`；`videoStore.ts:121,180,453` |
| `docs/demo-video-script.md` | 局部修补 | 部分现行状态块；规模改基线 14,327 / 8,785 / 3,593,723；健康检查 `/api/health` → `/health`；「等 20 秒出记忆」改后台异步（超时 40s）；转写耗时、模型、等级、徽章标录制快照 | `main.py:266,324`；`.env` `DEFAULT_WHISPER_MODEL` 等；`features.ts:21` |

### 新建

| 文件 | 处理 | 内容 | 依据 |
|---|---|---|---|
| `docs/README.md` | 新建 | 全站文档索引：状态标记读法、全局口径（端口 / 数据基线 / 结构计数）、按域分组的逐篇索引（用途 + 状态 + 最后校对）、写文档三条约定 | 本次 6 组碎片合并；计数与端口均已回代码核 |
| `docs/docs-refresh-2026-11-16.md` | 新建 | 本清单 | 本次 6 组碎片合并 |

## 四、配置项收口（2026-11-16 已施工）

前四条与版本号已在代码/配置侧改完，文档同步为单一权威口径：

1. **CORS 已统一**：`.env.example`、`docker-compose.yml` 两处内联默认、`database.py` 代码回退均改为六源（`localhost` / `127.0.0.1` 的 12302、12322）。
2. **六组运维脚本已改用生成名**：`start.bat`、`start.sh`、`scripts/diagnose.sh`、`backup.sh`、`restore.sh`、`preflight.sh` 统一为 `p2-siteyeb-<service>-1`，保留 `*_CONTAINER` 覆盖；compose 未补 `container_name`。
3. **Caddy 兜底端口已改 12302**，与 `WEB_PORT` 默认一致。
4. **注册默认已关闭**：compose `${ALLOW_REGISTRATION:-false}`，`.env.example` 为 `false`；需开放时显式设 true 并重启 backend。
5. **对外版本号已统一为 3.0.0**：`package.json`、`package-lock.json`、`backend/app/main.py` 与 CHANGELOG 标题一致；镜像标签仍为 `3.0`。
6. **旧仓端口规划 HTML** 已按五位规则重写，旧 `11000+(n−1)×100` 公式标作废。

仍待拍板：

- **`docs/changelog.md` 是否归档**：与根 `CHANGELOG.md` 在 2.5–2.92 区间重复且更旧。建议把详细叙述并入根文件历史区，或移入 `docs/archive/`；本次只标历史 + 指向根文件，未删未并。
- **历史正文里的旧号怎么办**：2.5 报告、`docs/changelog.md` 等历史正文保留了旧端口（`5002`、`11000+(n−1)×100`、111xx），只在紧跟的注记里给新号并标作废。若要求正文也换成新号，需另行确认 —— 那样会牺牲历史保真。
- **记忆系统四条缺陷的排期**：建议先做召回侧 confidence/source 过滤与 TTL 两条写入路径，再评估召回是否加相关性排序、是否做同义归并。另外原稿「条目被否决后不再自动生成同类条目」当前链路没有实现，要不要做。
- **存储遗留键与隐私边界**：`STORAGE_KEYS` 里 `p2m-todo-storage` / `p2m-calendar-storage` 是否删除；隐私设置「清空全部」是否补后端业务表（`schedule_items` / `calendar_events` / `memory_items` / 观看记录）删除接口，还是保持只清本地与 KV 并在界面写清边界。
- **数据质量存量清理**：重复视频、零长度块、超长块、历史标题广告后缀，是否跑一次批量清理 / 批量 UPDATE。
11. **故事页代码规模与未复测数字**：KPI 仍写后端 10,902 行 / 59 文件、前端 29,451 行 / 203 文件（11/15 快照）；本轮粗算 77 个 py / 16,008 行、218 个 ts·tsx / 30,121 行（含不含测试目录口径未统一）。另有 PG 2.76 GB、Redis 1.5 MB、Lv.3 1078 经验、12 徽章解锁 5 个、转写 13.4s→6.34s 等未复测。是刷新还是保留快照注记。
12. **腾讯云容量口径**：`deploy-tencent.md` 的机型 / 磁盘 / 带宽来自早期 21,136 视频 / 1,574GB 估算，是否按当前库（14,327 / 60,259）实测重算。
13. **路线图优先级**：`2.6-roadmap.md` 三个 P0 测试（真实后端 smoke、AI 任务中心 e2e、播放列表拖拽 e2e）长期未落地，保留 P0 还是降级。
14. **深色主题残留**：`src/components` 57 处旧色值（`bg-white` / `bg-[#faf9f7]` / `text-[#1a1a1a]` 等），是否列入下一批清理并补验收截图。
15. **2.7 报告测试数不一致**：文头「186/186 passed」、§7「187/187 passed」，按历史快照保留未改，是否订正口径。
16. **`admin` 账号角色**：`users` 表 username=`admin` 但 `role=member`，改名还是提权需查库决定。
17. **演示脚本账号**：`demo-video-script.md` 写 `demo / Demo2026`，本轮未核实该账号是否仍存在，重录前需确认。
18. **进行中工作流合并后回写文档**：`src/lib/projections/`、`useDashboardProjectionRefresh.ts`、3 个 `dashboard*Sync.test.tsx`、`daily_digest.py`、`WeeklyHoursPicker.tsx`、`features.ts` 均未提交；合并后结构、计数、功能状态要再核一遍（现在文档里统一写「进行中」）。
19. **旧仓过期页**：`C:\SiteYeb\docs\2026-11-16-端口号段规划.html` 仍写 `11000+(n−1)×100`，但它在旧仓、不在本 worktree，本次未动，请确认是否另行清理。

## 五、未核实项

本轮只读代码与配置，没有跑 docker、没有连库、没有重跑测试与评测集。以下已如实标在文档里，未编数字：

- 运行态：容器实际生成名、healthcheck 结果、库内列/索引精确计数。
- 历史实测：`PERFORMANCE.md` 的延迟与吞吐、各报告的测试通过数、故事页「18/18 命中」与延迟对比、转写耗时。
- 运行态行为：Redis 暂停键 `ai_queue:paused` 重启是否丢态、是否有定时 recover stuck、崩溃残留临时文件是否清理、前端 AI 任务中心筛选是否持久化。
- 后端 3 个裸 `def test_*` 在未引 pytest 的环境下无法被 unittest 发现，真实环境是否跑通未验证。
- 视频库搜索页是否读取 `hit.meta` 字段（开关关闭期间前端看不到卡片，后续接入前需先确认）。
- `PERFORMANCE.md:139` 的 pgvector 补丁版本 `0.8.7` 未连库核对；`README_cn.md` 已去掉补丁号只留大版本。
- 本地 venv 启动命令（`uvicorn app.main:app --port 8100`）沿用旧文出处，未实跑。

## 六、下一步

1. 先定四、1–4 四条配置/脚本口径，改完把对应文档的「并列两套值」收成单一值。
2. 记忆四缺陷按优先级立 issue，修完回来改 `memory-system-design.md` 的「已知缺陷」节。
3. 进行中工作流合并后，重跑一次结构计数（29 / 12 / 12 / 14 / 39+1 / 21），把「进行中」改掉。
4. 下次做数据盘点后，同步更新 `docs/README.md` 的基线表和引用它的各篇。
