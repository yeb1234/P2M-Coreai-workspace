# SiteYeb / P2M 个人 IT 学习工作台

> 状态：现行（最后校对 2026-11-20）
> 当前发布：6.0.0 SmartAgents（2026-11-20）

一个本地优先的个人学习工作台：React 前端 + FastAPI 后端 + PostgreSQL 17（pgvector）+ Redis（RQ 队列）。把视频学习、笔记、待办、日历、番茄钟、时间中心、AI 助手和长期记忆放在一个界面里，本机和局域网都能用。

项目目前偏个人使用，也欢迎拿去研究、改造和提交想法。定位是个人、家庭、小团队在可信局域网里使用的内部工具底座，不是开箱即用的公网 SaaS；要对外暴露前需要自行做权限、审计和安全加固。

数据基线（截至 2026-11-16）：`videos` 14,327；`content_chunks` 60,259（向量覆盖 100%）；`subtitle_segments` 3,593,723；有字幕视频 8,785。

## 适合谁

- 想把待办、日历、番茄钟、笔记、本地视频学习和 AI 助手放到一个工作台里的人。
- 有一堆本地课程 / 会议 / 学习视频，希望转录、总结、续播和管理的人。
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

- IT 视频站：本地视频扫描、文件夹导航、继续观看、字幕、AI 总结、AI 任务中心；搜索支持「标题 / 文件夹」与「字幕内容」两种模式。
- 学习路径：规划 Agent 按画像与目标产出分步路径，每一步绑定视频库里真实存在的视频，可直接跳转；进度会被对话 Agent 读取。
- 学习轨迹：等级、本周对比、连续天数、成就徽章、90 天热力图。
- 字幕转录王：文件夹勾选批量转写、AI 任务队列控制、模型下载状态可视化。

### AI 助手与记忆

- 灵境小助手：LangChain ReAct Agent，SSE 流式输出，支持中止生成。6.0 共 13 个受治理工具：检索片段、搜视频标题、视频摘要、学习画像、近期活动、学习目标、我的路径、推荐视频、搜笔记，以及保存笔记、总结另存、安排日历、创建 Todo。
- **6.0 SmartAgents 的核心是「工具契约与模型通道解耦」**：意图只决定本轮工具集，工具仍由同一套注册表、预算、超时、熔断和审计层执行；本地 LLM 与外部 LLM 可以按兜底策略切换，模型换了，工具契约和权限边界不变。
- 写动作走人工确认：保存笔记、日历、Todo 由 LangGraph `interrupt` 弹出确认卡，确认后才写库；每轮最多 1 个写动作，写入后生成动作回执，可在消息里撤回。审计落在 `AgentAction`，工具轨迹落在 `AgentRun.steps`。
- 支持本地 LLM 与 OpenAI-compatible 外部 LLM，按设置页兜底策略在两个通道间切换；429 / 5xx / 超时退避重试，鉴权与路径错误立即换下一家。
- 意图识别在前端完成（根目录 `prompts/clientPrompts.ts`）：6 类有序正则（课程推荐 / 学习路径 / 学习总结 / 代码助手 / 任务拆解 / 知识问答），识别不出才退回手选模板。
- 记忆系统四层：`ChatMessage` 原文 / 会话摘要（超 24 条压缩、保留最近 10 条）/ `MemoryItem` 长期记忆条目（类型、重要度、置信度、置顶、过期、命中次数）/ `UserData` 档案 KV；对话结束后异步抽取记忆，不拖慢回答。
- 检索三路召回：词法（pg_trgm + ILIKE）+ 向量（HNSW halfvec）+ 视频级元数据，加权 RRF 融合；`RRF_K=60`，权重 lexical `0.8` / vector `1.2` / meta `1.5`，`candidate_k=30`，`rerank_top_n=20`；重排 API 失败时退回 LLM 重排。

> 「相关片段」卡片 2026-11-16 起由 `src/config/features.ts` 的 `FEATURES.chatVideoReferences` 开关关闭（默认 `false`）。关闭只影响渲染：`ReferenceBlock`、`dedupeReferences` 和后端 `chat_agent` 的 references 生成都保留，改回 `true` 重建前端即恢复；后端仍照常生成 references，只是前端不渲染。

### 界面与配置

- 左侧三组导航：日常 7 项 / 学习 9 项 / 工具 13 项，共 29 个注册页面（`src/config/pageRegistry.tsx`）；部分工具类页面仍是静态占位，带「施工中」标记。
- 主题系统（含按时间表自动切换调度）、声音 / 背景音、通知；Header 右上角可呼出主题调色板弹窗。

## 运行方式

**全部跑在 Docker 里。** pgvector、Redis、ffmpeg 三件硬依赖由容器提供，本机不再直接跑 uvicorn + `npm run dev` 作为主链路。细节和排障见 [docs/run.md](docs/run.md)。

### 前置准备

```bash
cp .env.example .env
# 至少填：POSTGRES_PASSWORD、JWT_SECRET（长度 >= 32）、EXTERNAL_LLM_API_KEY（用外部 LLM 时）
```

### 启动

Windows 双击 `start.bat`，菜单选择：

- `[1]` 全套：postgres + redis + backend + worker + frontend（要 AI 转写 / 索引选这个）
- `[2]` 仅页面：postgres + redis + backend + frontend，不起 worker
- `[7]` 全停（数据卷保留）

命令行（WSL / macOS / Linux）：

```bash
./start.sh            # 完整（含 AI worker）
./start.sh web        # 只要页面，不起 worker
./start.sh stop       # 全停（数据卷保留）
./start.sh status     # 容器状态 + 探针
./start.sh logs       # 跟后端日志
```

也可以直接用 compose：

```bash
docker compose up -d                                              # 完整
docker compose up -d postgres redis backend frontend              # 不用 AI 助手（不起 worker）
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
| 监控 | 未分配 | 监控段未分配；旧 11162 作废，不再预留 |
| 1234 / 1235 | 宿主机本地模型 | LM Studio；容器内用 `host.docker.internal:1234` / `1235` |
| 11434 | Ollama | 备选本地 LLM |

`worker` 不暴露宿主端口；`backend` 仅把容器内 `8000` 映射到回环 `12402`，对外请求仍全部经 nginx `/api` 转发。

## 视频转录

目前两条路线：

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
  src/                  React 前端
    config/             页面注册表 pageRegistry、功能开关 features
    components/         页面、布局、通用组件
    stores/             Zustand 状态（13 个）
    hooks/              跨模块同步和恢复逻辑（13 个）
    plugins/            工作台插件（5 个）
    lib/                API、提示词、工具函数
    types/              TypeScript 类型
  prompts/              前端提示词与意图识别（clientPrompts.ts）
  backend/app/          FastAPI 后端
    routers/            API 路由（14 个业务路由）
    services/           扫描、转录、检索、AI、记忆、管理服务（39 个）
    agents/             chat_agent / plan_agent / tools
    models.py           21 个 ORM 模型
    worker.py           RQ worker（ai_jobs + background 两个队列）
  docs/                 设计记录、踩坑记录、更新日志
  scripts/              诊断、日志查询、检索评估等脚本
  public/sounds/        本地提示音和背景音
```

## 测试和构建

```bash
npm test
npm run build
npm run test:e2e
cd backend && python -m compileall app
```

测试盘点（截至 2026-11-16）：`src/__tests__` 28 个前端测试文件；`backend/tests` 5 个后端测试文件；仓库根 `tests/` 下只有 `contracts` 与 `e2e` 两个目录，后端没有 API 级集成测试。

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
bash scripts/diagnose.sh
```

打出容器状态、健康探针最后输出、PG 长事务 / 锁等待、worker 注册与队列积压、nginx 错误。

查日志：

```bash
bash scripts/logq.sh errors --since 1h    # 错误（含异常类型与 request_id）
bash scripts/logq.sh req <request_id>    # 一次请求 / 一个任务的完整日志
bash scripts/logq.sh stats --since 24h  # 按级别 / logger / 状态码聚合
```

## 文档

设计记录、踩坑记录、更新日志与部署说明的完整索引见 [docs/README.md](docs/README.md)（文档索引统一维护）。
根目录 `CHANGELOG.md` 记录用户可感知的功能变化，`BUGFIXES.md` 记录缺陷修复，`PERFORMANCE.md` 记录性能改动。

## License

MIT
