# P2 7.2 Media / 灵境工作台

> 状态：现行（P2 7.2 产品线分叉）
> 当前发布：P2 7.2 Media；配套 P2 7.2 Transcribe；P2 7.2 Lite 已在 `feat/p2-lite` 实测

一个本地优先的个人学习工作台：React 前端 + FastAPI 后端 + PostgreSQL 17（pgvector）+ Redis（RQ 队列）。把视频学习、笔记、待办、日历、番茄钟、时间中心、AI 助手和长期记忆放在一个界面里，本机和局域网都能用。

> **P2 7.2 产品线**
>
> - **P2 7.2 Media**：主站保留视频浏览、字幕阅读、视频检索、笔记与学习路径；转写入口从主站正面移除。
> - **P2 7.2 Transcribe**：独立本机控制台（默认 `http://127.0.0.1:12703`），负责扫描路径、批量转写 / 总结、队列暂停与 worker 监控。
> - **P2 7.2 Lite**：独立轻量 profile，不建 pgvector、不跑视频/转写/embedding/worker；只保留 Agent、面试题、笔记、待办、日历等 OLTP 页面，另带 3 个不接后端的静态产品演示页（视频检索 Mock / P2 Media / P2 Transcribe），与 P1 共用一套 2GB PostgreSQL 和 Redis（`db_p2` / Redis DB 1 / `p2:` key 前缀）。默认入口 `http://127.0.0.1:12305`。
> - **P2 7.2 Lite Demo**：独立演示库 `db_p2_demo`（Redis DB 5 / `p2demo:`），入口 `http://127.0.0.1:12306`；登录页预填 `demo / P2Demo2026`，自带便签、笔记、待办、日历、番茄、面试和 AI 会话样例数据。导航另有“产品线”分组：视频检索 Mock、P2 Media 真能力、P2 Transcribe 控制台三页静态演示，不接 Lite 后端。部署与重置见 [infra/lite-demo/README.md](infra/lite-demo/README.md)。
>
> 拆分说明见 [docs/2026-11-20-p2-7.2-media-split.md](docs/2026-11-20-p2-7.2-media-split.md)；Lite 边界、共享库与内存验收见 [docs/2026-11-20-p2-7.2-lite.md](docs/2026-11-20-p2-7.2-lite.md)。

项目目前偏个人使用，也欢迎拿去研究、改造和提交想法。定位是个人、家庭、小团队在可信局域网里使用的内部工具底座，不是开箱即用的公网 SaaS；要对外暴露前需要自行做权限、审计和安全加固。

数据基线（截至 2026-11-20 扫描）：`videos` 14,380；`content_chunks` 60,259（向量覆盖 100%）；`subtitle_segments` 3,593,723；有字幕视频 14,157。

## 适合谁

- 想把待办、日历、番茄钟、笔记、本地视频学习和 AI 助手放到一个工作台里的人。
- 有一堆本地课程 / 会议 / 学习视频，希望把转写放到独立控制台、主站专心浏览和检索的人。
- 想在局域网里给自己几台设备或小团队共用一个轻量工具的人。
- 想研究 React + FastAPI + PostgreSQL/pgvector + 本地 / 外部 LLM 工作流的人。

直接暴露到公网前请先做安全加固；当前版本更接近「个人和小团体内网工具」。

## 当前能力

### 日常

- 工作台：左侧插件导航、顶部快捷入口、右侧灵境小助手、通知面板；5 个工作台插件（日历、番茄钟、快捷统计、最近笔记、待办）。
- 待办：优先级、截止日期、番茄计划、时间提醒；与周历、统计、隐私设置共用同一份后端排程数据。
- 日历：日历看板（月视图）+ 周历，查看待办、提醒、番茄专注记录和普通事件。
- 番茄钟：专注 / 休息循环、背景音、统计、历史记录；本地每秒计时 + 后台关键事件与快照同步。
- 时间中心：模拟时钟、世界时钟、自定义时区、正计时、倒计时、闹钟、提醒。
- 笔记：共享 / 私有区分，私有笔记只有本人能读写。

### 学习

- IT 视频站：本地视频浏览、文件夹导航、继续观看、字幕阅读、AI 总结；搜索支持「标题 / 文件夹」与「字幕内容」两种模式。主站不再提供扫描、转写或批量任务入口。
- 学习路径：规划 Agent 按画像与目标产出分步路径，每一步绑定视频库里真实存在的视频，可直接跳转；进度会被对话 Agent 读取。
- 学习轨迹：等级、本周对比、连续天数、成就徽章、90 天热力图。
- P2 Transcribe：独立于主站的本机控制台，支持手动扫描视频库子目录、按范围筛选候选视频、批量转写 / 补总结、暂停与恢复队列，并保留流水线监控。

### AI 助手与记忆

- 灵境小助手：LangChain ReAct Agent，SSE 流式输出，支持中止生成。6.0 共 13 个受治理工具：检索片段、搜视频标题、视频摘要、学习画像、近期活动、学习目标、我的路径、推荐视频、搜笔记，以及保存笔记、总结另存、安排日历、创建 Todo。
- **6.0 SmartAgents 的核心是「工具契约与模型通道解耦」**：意图只决定本轮工具集，工具仍由同一套注册表、预算、超时、熔断和审计层执行；本地 LLM 与外部 LLM 可以按兜底策略切换，模型换了，工具契约和权限边界不变。
- 写动作走人工确认：保存笔记、日历、Todo 由 LangGraph `interrupt` 弹出确认卡，确认后才写库；每轮最多 1 个写动作，写入后生成动作回执，可在消息里撤回。审计落在 `AgentAction`，工具轨迹落在 `AgentRun.steps`。
- 支持本地 LLM 与 OpenAI-compatible 外部 LLM，按设置页兜底策略在两个通道间切换；429 / 5xx / 超时退避重试，鉴权与路径错误立即换下一家。
- 意图识别在前端完成（`configs/prompts/clientPrompts.ts`）：6 类有序正则（课程推荐 / 学习路径 / 学习总结 / 代码助手 / 任务拆解 / 知识问答），识别不出才退回手选模板。
- 记忆系统四层：`ChatMessage` 原文 / 会话摘要（超 24 条压缩、保留最近 10 条）/ `MemoryItem` 长期记忆条目（类型、重要度、置信度、置顶、过期、命中次数）/ `UserData` 档案 KV；对话结束后异步抽取记忆，不拖慢回答。
- 检索三路召回：词法（pg_trgm + ILIKE）+ 向量（HNSW halfvec）+ 视频级元数据，加权 RRF 融合；参数集中在 `configs/retrieval.yaml`（`RRF_K=60`，lexical `0.8` / vector `1.2` / meta `1.5`，`candidate_k=30`，`rerank_top_n=20`）；重排 API 失败时退回 LLM 重排。

> 「相关片段」卡片 2026-11-16 起由 `frontend/src/config/features.ts` 的 `FEATURES.chatVideoReferences` 开关关闭（默认 `false`）。关闭只影响渲染：`ReferenceBlock`、`dedupeReferences` 和后端 `chat_agent` 的 references 生成都保留，改回 `true` 重建前端即恢复；后端仍照常生成 references，只是前端不渲染。

### 界面与配置

- 左侧三组导航：日常 8 项 / 学习 9 项 / 工具 12 项，共 29 个注册页面（`frontend/src/config/pageRegistry.tsx`）；部分工具类页面仍是静态占位，带「施工中」标记。
- 主题系统（含按时间表自动切换调度）、声音 / 背景音、通知；Header 右上角可呼出主题调色板弹窗。

## 运行方式

**全部跑在 Docker 里。** pgvector、Redis、ffmpeg 三件硬依赖由容器提供，本机不再直接跑 uvicorn + `npm run dev` 作为主链路。细节和排障见 [docs/run.md](docs/run.md)。

### 前置准备

```bash
cp .env.example .env
# 至少填：POSTGRES_PASSWORD、JWT_SECRET（长度 >= 32）、EXTERNAL_LLM_API_KEY（用外部 LLM 时）
```

### 启动

Windows 双击 `ops\start.bat`，菜单选择：

- `[1]` 全套：postgres + redis + backend + worker + frontend（要 AI 转写 / 索引选这个）
- `[2]` 仅页面：postgres + redis + backend + frontend，不起 worker
- `[7]` 全停（数据卷保留）

命令行（WSL / macOS / Linux）：

```bash
./ops/start.sh            # 完整（含 AI worker）
./ops/start.sh web        # 只要页面，不起 worker
./ops/start.sh stop       # 全停（数据卷保留）
./ops/start.sh status     # 容器状态 + 探针
./ops/start.sh logs       # 跟后端日志
```

也可以直接用 compose（compose 文件在 `infra/`，必须显式指定）：

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d
docker compose --env-file .env -f infra/docker-compose.yml up -d postgres redis backend frontend
```

访问 http://localhost （第二入口 http://localhost:12302）。

### 服务与依赖

compose 项目名 `p2-siteyeb`，共五个服务；镜像标签 `3.0`，backend 与 worker 共用后端镜像。容器名由 compose 生成（如 `p2-siteyeb-backend-1`），compose 文件里不写死 `container_name`。

| 服务 | 镜像 | 作用 | 不用 AI 助手时 |
|---|---|---|---|
| `postgres` | `pgvector/pgvector:pg17` | PostgreSQL 17 + pgvector | 必须 |
| `redis` | `redis:7-alpine` | RQ 队列存储 | 跟着起（backend 依赖其 healthy），只占几 MB |
| `backend` | `p2-siteyeb-backend:3.0` | FastAPI：API、缩略图生成、文件监听、Agent 链路 | 必须 |
| `worker` | `p2-siteyeb-backend:3.0`（复用后端镜像） | RQ `SimpleWorker`，消费 `ai_jobs` + `background` 两个队列：转写、建块、向量化、缩略图 | 可以不起 |
| `frontend` | `p2-siteyeb-frontend:3.0` | nginx：静态页面 + `/api` 反代到 backend | 必须 |

不起 worker 时：浏览、播放、搜索、笔记、待办、路径查看全部正常；新发起的转写和向量化会堆在队列里没人消费。

### 前端开发（改 UI 时）

Vite 热更新可用，后端跑在容器里：

```bash
cd frontend
npm install
npm run dev        # http://localhost:12322，/api 代理到 http://127.0.0.1:12302
```

## 端口说明

端口按 `<服务前缀><两位项目号>` 分配：123 前端 Web、124 后端 API、125 数据库、126 缓存/中间件，P2 尾号 02。

| 端口 | 用途 | 说明 |
| --- | --- | --- |
| 80 | 生产入口 | nginx：静态页面 + `/api` 反代到 `backend:8000`；裸 localhost 只回流 P2 |
| 12302 | 第二前端入口 | `WEB_PORT`，同一个 nginx；dev 代理也打到这里 |
| 12402 | 后端 API | 只绑 `127.0.0.1` 的宿主回环映射（容器内 8000）；对外仍走 `http://localhost/api`，12402 仅供宿主调试直连 |
| 12322 | 前端开发 | Vite 热更新，只在 `npm run dev` 时占用；`/api` 代理到 `127.0.0.1:12302` |
| 12502 | PostgreSQL | 只绑 `127.0.0.1`，不对外 |
| 12602 | Redis | 只绑 `127.0.0.1`，不对外 |
| 12702 | 只读流水线监控 | `artifacts/pipeline-monitor/monitor_server.py`，只读看板 |
| 12703 | P2 Transcribe 控制台 | 独立本机进程，绑定 `127.0.0.1`；扫描、批量入队、队列暂停与监控 |
| 1234 / 1235 | 宿主机本地模型 | LM Studio；容器内用 `host.docker.internal:1234` / `1235` |
| 11434 | Ollama | 备选本地 LLM |

`worker` 不暴露宿主端口；`backend` 仅把容器内 `8000` 映射到回环 `12402`，对外请求仍全部经 nginx `/api` 转发。

## P2 Transcribe 控制台

转写已从主站移动到 **P2 7.2 Transcribe**。主站只展示已有字幕和总结，不再轮询 AI 任务、不再提供转写按钮，也不提供视频库扫描入口。

启动控制台：

```bash
python artifacts/pipeline-monitor/transcribe_console.py
# 或者 Windows 双击 ops\p2-transcribe.bat
# 浏览器打开 http://127.0.0.1:12703
```

控制台通过 `OPS_TOKEN` 调后端 `/api/ops`，只绑定本机回环。先在 `.env` 设置 `OPS_TOKEN`，再重建 backend；控制台会读取同一份 `.env`。

目前两条转写路线仍在后端 worker 中执行：

- CPU 路线：`faster-whisper`，相对通用，CPU 部分正常。
- 外部引擎路线：`whisper.cpp`，本机为了 A 卡做过 Windows 兼容层。

A 卡 / GPU 部分和本机环境绑定较深，换机器、换显卡或换系统可能需要大改。建议先用 CPU 路线跑通流程，再按自己的硬件折腾 GPU。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 前端 | React 19.2、TypeScript ~6.0、Vite 8、react-router-dom 7（HashRouter） |
| UI | Tailwind CSS 3.4、lucide-react |
| 状态 | Zustand 5、IndexedDB / Dexie 4、后端 PostgreSQL |
| 后端 | FastAPI 0.115、SQLAlchemy 2.0.36、Alembic 1.13.3、psycopg3、pgvector、Pydantic 2.9、PyJWT 2.9 |
| Agent / LLM | langchain-core 1.x、langchain-openai 1.x、langgraph 1.x（prebuilt `create_react_agent`） |
| 队列 / 缓存 | RQ 1.16、Redis 5 |
| 视频 / AI | ffmpeg、Faster-Whisper 1.0.3、whisper.cpp、LM Studio / OpenAI-compatible API |
| 测试 | Vitest 4、jsdom、Playwright 1.57；后端 pytest |

## 项目结构

```text
SiteYeb/
  frontend/             React 前端
    src/                页面、组件、状态、hooks、插件、API 客户端
    tests/              契约测试与 e2e
    public/             静态资源与独立入口页（asset-registry.html）
    Dockerfile          从前端目录构建
  backend/              FastAPI 后端
    app/                routers / services / agents / models / worker
    alembic/            数据库迁移
    tests/              pytest
  configs/              运行时配置与资产基线
    prompts/            前端意图提示词与后端运行时提示词
    retrieval.yaml      检索、RRF、重排参数
    vector.yaml         embedding、分块、HNSW 参数
    llm.yaml            LLM 路由与预算（不含密钥）
    database.yaml       连接池、超时、迁移基线
    governance.yaml     工具预算与审计策略
  infra/                docker-compose、nginx、Caddy、HTTPS/GPU/腾讯云编排
  ops/                  启动脚本、停止脚本、诊断与运维脚本
  artifacts/            demo、监控面板、设计稿、面试资料等可交付展示物
  data/                 运行时数据（视频库、日志、缓存、模型、legacy），默认不入库
  docs/                 设计记录、发布说明、踩坑与运维文档
```

## 测试和构建

```bash
cd frontend
npm test
npm run build
npm run test:e2e
cd ../backend && python -m compileall app
```

测试基线（P2 7.2 Media）：前端 52 文件 / 406 用例（共享代码）；后端 99 项；Media 构建 2700 modules，前端/后端镜像已按同一套代码重建。

测试基线（P2 7.2 Lite）：后端 99 项（含 profile 边界、Lite 学习状态、动作联动、确认卡跨重启恢复、Lite MCP/能力清单/健康检查、Demo 登录预填）；前端 52 文件 / 406 用例；Lite / Demo 构建 2700 modules；4 路并发 Agent 峰值 189.8 MiB（backend 177.7 + frontend 12.1）。

日常改前端时至少跑：

```bash
npm test
npm run build
```

## 参与和改造

欢迎 issue、PR、二次开发和各种实验性想法。方向是先让个人工作流真的好用，再逐步把 AI、视频学习、时间管理和插件系统打磨得更稳。

准备给小团队使用时，建议优先补：

- 更严格的账号和权限策略。
- 数据备份和恢复。
- 公网部署时的 HTTPS、反向代理和访问控制。
- AI 接口额度、日志和审计。
- 视频文件目录的权限隔离。

## 排障

站点异常时第一条命令（只读，不改任何状态）：

```bash
bash ops/scripts/diagnose.sh
```

打出容器状态、健康探针最后输出、PG 长事务 / 锁等待、worker 注册与队列积压、nginx 错误。

查日志：

```bash
bash ops/scripts/logq.sh errors --since 1h    # 错误（含异常类型与 request_id）
bash ops/scripts/logq.sh req <request_id>    # 一次请求 / 一个任务的完整日志
bash ops/scripts/logq.sh stats --since 24h  # 按级别 / logger / 状态码聚合
```

## 配置资产版本库

7.0 把 7 个配置资产纳入 PostgreSQL 原生版本库，由后端提供 Git 风格 API，前端设置页提供管理界面：

- 入口：管理员登录后，设置 → 配置资产；或直接打开 `/asset-registry.html` / `/#/asset-registry`。
- 纳管清单：`configs/manifest.yaml`，当前 7 个文件（前后端提示词、检索、向量、LLM、数据库、工具治理）。
- 操作：编辑 → 提交；新建分支 / 标签；对比上一提交；合并；回滚；发布 HEAD 原子写回 `configs/`；审计日志。
- 发布后：后端读取新配置会热刷新；已加载旧提示词的 worker 需要重启后生效。
- 权限：仅 `role=admin` 可见可写。版本库只存文本 blob，不依赖外部 Git 服务。

## 文档

设计记录、踩坑记录、更新日志与部署说明的完整索引见 [docs/README.md](docs/README.md)（文档索引统一维护）。
根目录 `CHANGELOG.md` 记录用户可感知的功能变化，`docs/BUGFIXES.md` 记录缺陷修复，`docs/PERFORMANCE.md` 记录性能改动。

## License

MIT
