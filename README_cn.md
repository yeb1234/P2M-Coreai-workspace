# P2 7.2 Media / 灵境工作台

> 状态：现行（P2 7.2 产品线分叉）
> 当前发布：P2 7.2 Media；配套 P2 7.2 Transcribe；P2 7.2 Lite 已验收并合并到 `main`

> **P2 7.2 产品线**
>
> - **P2 7.2 Media**：主站保留视频浏览、字幕阅读、视频检索、笔记与学习路径；转写入口从主站正面移除。
> - **P2 7.2 Transcribe**：独立本机控制台（默认 `http://127.0.0.1:12703`），负责扫描路径、批量转写 / 总结、队列暂停与 worker 监控。
> - **P2 7.2 Lite**：独立轻量 profile，不建 pgvector、不跑视频/转写/embedding/worker；只保留 Agent、面试题、笔记、待办、日历等 OLTP 页面，另带 3 个不接后端的静态产品演示页（视频检索 Mock / P2 Media / P2 Transcribe），与 P1 共用一套 2GB PostgreSQL 和 Redis（`db_p2` / Redis DB 1 / `p2:` key 前缀）。默认入口 `http://127.0.0.1:12305`；本机与 P5 同时运行时，本地 `.env` 使用 `12315` / `12715`。
> - **P2 7.2 Lite Demo**：独立演示库 `db_p2_demo`（Redis DB 5 / `p2demo:`），默认入口 `http://127.0.0.1:12306`；本机与 P6 同时运行时，本地 `.env` 使用 `12316` / `12716`。登录页预填 `demo / P2Demo2026`，自带便签、笔记、待办、日历、番茄、面试和 AI 会话样例数据。导航新增“产品线”分组：视频检索 Mock、P2 Media 真能力、P2 Transcribe 控制台三个静态演示页，不接 Lite 后端。部署与重置见 [infra/lite-demo/README.md](infra/lite-demo/README.md)。
>
> 拆分说明见 [docs/2026-11-20-p2-7.2-media-split.md](docs/2026-11-20-p2-7.2-media-split.md)；Lite 边界、共享库与内存验收见 [docs/2026-11-20-p2-7.2-lite.md](docs/2026-11-20-p2-7.2-lite.md)。

一个本地优先的个人学习工作台：React 前端 + FastAPI 后端 + PostgreSQL 17（pgvector）+ Redis（RQ 队列）。适合个人日常使用，也适合在局域网里给小团队、工作室或家庭设备改造使用。当前不是开箱即用的公网 SaaS，更像一个可以继续加固、继续接 AI 能力的开源底座。

数据基线（截至 2026-11-20 扫描）：`videos` 14,380；`content_chunks` 98,271（向量覆盖 100%）；`subtitle_segments` 5,667,374（约 566 万）；有字幕视频 14,160。

> **3.0 架构重构（历史快照，2026-11-15）**
>
> 主库已从 SQLite 迁移到 **PostgreSQL 17 + pgvector**，检索从「失效的中文 FTS5 + 319 万条废向量」换成
> **pg_trgm 词法 + HNSW 语义 + 视频级元数据三路召回 + 加权 RRF + 重排**；
> 灵境小助手在这一版升级为 **LangChain ReAct Agent**（当时 9 个工具、SSE 流式、会话记忆），并新增 **LangGraph 学习路径规划**。
> 完整设计取舍与实测数据见 [docs/2026-11-15-3.0-architecture.md](docs/2026-11-15-3.0-architecture.md)。
> 项目复盘（架构 / 演进 / 十个坑 / 面试问答）单页版：[docs/project-story.html](docs/project-story.html)，浏览器直接打开即可。
>
> **安全加固（2026-11-15）**
>
> 上线前审计发现并修复 9 个 P0：密码从无盐 SHA-256 换成 PBKDF2（600k 迭代、登录时透明升级）、
> 22 个管理端点补上管理员校验、埋点与画像 / 路径按用户隔离、堵住 SSRF、数据库端口收回本地回环。
> 完整问题清单、证据与「没修的问题及原因」见 [docs/security-audit.md](docs/security-audit.md)。
>
> **首次部署必读**：`ALLOW_REGISTRATION=true` 注册第一个账号（自动成为管理员），之后改回 `false`；
> `JWT_SECRET` 必须换成长随机串。公网部署必须前置 HTTPS。
>
> **会话与多用户（2026-11-15 晚）**
>
> 令牌从 localStorage 搬进 **httpOnly Cookie**（JS 读不到，XSS 偷不走），并补上 CSRF 三道防线；
> 前端存储按 `user_id` 分区，切换账号整页重载，杜绝串号；新增「设置 → 用户管理」图形界面
> （建号 / 改角色 / 停用 / 重置密码 / 删除，含三条防呆规则）。
>
> 上线能力：`docker-compose.https.yml` + `Caddyfile` 自动证书、`scripts/backup.sh` 备份、
> `scripts/preflight.sh` 16 项自检。完整步骤见 **[docs/deploy.md](docs/deploy.md)**。

## 当前能力

### 日常

- 待办、日历看板、周历、番茄钟、笔记、时间中心；待办和两个日历统一使用后台排程数据，开始时间 / 截止时间精确到分钟。
- 番茄钟使用本地每秒计时 + 后台关键事件 / 15 秒快照同步，局域网设备刷新后可以恢复当前阶段、设置和完成历史；配置会同步完整小参数、环境音策略、当前背景音、各背景音音量和上次播放状态。
- 笔记区分共享 / 私有：AI 转写产物为共享，自己写的为私有；私有笔记只有本人能读写。

### 学习

- 本地视频浏览、文件夹导航、继续观看、字幕阅读、AI 总结；视频库搜索支持「标题 / 文件夹」与「字幕内容」两种模式，字幕内容走和助手同一条混合检索链路。主站不再提供扫描、转写或批量任务入口。
- **学习路径**：设定目标后由 LangGraph 规划出步骤，每一步绑定视频库里真实存在的视频，可点击直接跳到对应视频；进度会被对话 Agent 读取，回答「下一步学什么」时按路径推进而不是另起一套。
- **学习轨迹**：等级、本周对比、连续天数、成就徽章、90 天热力图。
- **P2 Transcribe**：独立控制台支持手动扫描视频库子目录、按范围筛选候选、批量转写 / 补总结、暂停与恢复队列，并保留流水线监控。

### AI 助手与记忆

- 灵境小助手：LangChain ReAct Agent，SSE 流式输出，支持中止生成。6.0 共 13 个受治理工具：检索片段、搜视频标题、视频摘要、学习画像、近期活动、学习目标、我的路径、推荐视频、搜笔记，以及保存笔记、总结另存、安排日历、创建 Todo。
- **6.0 SmartAgents 的核心是「工具契约与模型通道解耦」**：意图只决定本轮工具集，工具仍由同一套注册表、预算、超时、熔断和审计层执行；本地 LLM 与外部 LLM 可以按兜底策略切换，模型换了，工具契约和权限边界不变。
- 写动作走人工确认：保存笔记、日历、Todo 由 LangGraph `interrupt` 弹出确认卡，确认后才写库；每轮最多 1 个写动作，写入后生成动作回执，可在消息里撤回。审计落在 `AgentAction`，工具轨迹落在 `AgentRun.steps`。
- 支持本地 LLM 与 OpenAI-compatible 外部 LLM，按设置页兜底策略在两个通道间切换；429 / 5xx / 超时退避重试，鉴权与路径错误立即换下一家。
- 意图识别在前端完成（`configs/prompts/clientPrompts.ts`）：6 类有序正则（课程推荐 / 学习路径 / 学习总结 / 代码助手 / 任务拆解 / 知识问答），识别不出才退回手选模板。
- 记忆系统四层：`ChatMessage` 原文 / 会话摘要（超 24 条压缩、保留最近 10 条）/ `MemoryItem` 长期记忆条目 / `UserData` 档案 KV；对话结束后异步抽取记忆。
- 检索三路召回：词法（pg_trgm + ILIKE）+ 向量（HNSW halfvec）+ 视频级元数据，加权 RRF 融合；参数集中在 `configs/retrieval.yaml`（`RRF_K=60`，lexical `0.8` / vector `1.2` / meta `1.5`，`candidate_k=30`，`rerank_top_n=20`）；重排 API 失败时退回 LLM 重排。

> 「相关片段」卡片 2026-11-16 起由 `frontend/src/config/features.ts` 的 `FEATURES.chatVideoReferences` 开关关闭（默认 `false`）。关闭只影响渲染：`ReferenceBlock`、`dedupeReferences` 和后端 `chat_agent` 的 references 生成都保留，改回 `true` 重建前端即恢复；后端仍照常生成 references，只是前端不渲染。

### 界面

- 左侧三组导航：日常 8 项 / 学习 9 项 / 工具 12 项，共 29 个注册页面；部分工具类页面仍是静态占位，带「施工中」标记。
- 主题系统（含自动主题切换调度：按时间表自动切换不同主题，支持多规则配置和手动覆盖；Header 右上角可呼出调色板弹窗）、声音系统、背景音、通知。

## 快速启动

### 方式一：Docker 一键启动（推荐，部署 / 交付用）

```bash
cp .env.example .env      # 填 POSTGRES_PASSWORD、JWT_SECRET、EXTERNAL_LLM_API_KEY
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
# 或 Windows 双击 ops\start.bat 选 [1]；./ops/start.sh 完整启动
```

一次起全套：PostgreSQL(pgvector) + Redis + backend + worker + frontend。
GPU 转写、数据迁移、常见问题见 [docs/docker.md](docs/docker.md)。

视频库位置、相对路径与跨盘挂载见 [docs/runtime-paths.md](docs/runtime-paths.md)。默认约定是：
Docker 用 `.env` 的 `VIDEO_HOST_PATH=../data/video-library` 挂到容器 `/videos`；容器内的
`VIDEO_FOLDER` 始终是 `/videos`，不要改成宿主机的 `D:/ITJC`。项目在 C 盘、素材在 D 盘时，
用 junction / symlink 在 `data/video-library` 建挂载点，配置保持相对路径。

只要页面、不起 worker：

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d postgres redis backend frontend
# 或 ./ops/start.sh web
```

### 方式二：前端本地开发（改 UI 用这个）

后端跑在容器里，只起 Vite 热更新：

```bash
cd frontend
npm install
npm run dev
```

- 前端开发：http://localhost:12322
- `/api` 代理到 http://127.0.0.1:12302（生产入口 nginx）

## 端口

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
| 12305 / 12705 | P2 Lite | 默认入口 / API；本机全项目并存时改用 `12315` / `12715`，避开 P5 的 `12305` / `12705` |
| 12306 / 12706 | P2 Lite Demo | 默认入口 / API；本机全项目并存时改用 `12316` / `12716`，避开 P6 的 `12306` / `12706` |
| 1234 / 1235 | 宿主机本地模型 | LM Studio；容器内用 `host.docker.internal:1234` / `1235` |
| 11434 | Ollama | 备选本地 LLM |

`worker` 不暴露宿主端口；`backend` 仅把容器内 `8000` 映射到回环 `12402`，对外请求仍全部经 nginx `/api` 转发。Lite / Demo 的默认端口写在各自 `.env.example`；本机多项目并存只改本地 `.env`，不动 compose 默认值。

## P2 Transcribe 控制台

转写已从主站移动到 **P2 7.2 Transcribe**。主站只展示已有字幕和总结，不再轮询 AI 任务、不再提供转写按钮，也不提供视频库扫描入口。

启动控制台：

```bash
python artifacts/pipeline-monitor/transcribe_console.py
# 或者 Windows 双击 ops\p2-transcribe.bat
# 浏览器打开 http://127.0.0.1:12703
```

控制台通过 `OPS_TOKEN` 调后端 `/api/ops`，只绑定本机回环。先在 `.env` 设置 `OPS_TOKEN`，再重建 backend；控制台会读取同一份 `.env`。

## 转写路线

目前两条转写路线仍在后端 worker 中执行：

- CPU 路线：`faster-whisper`，相对通用，CPU 部分正常。
- 外部引擎路线：`whisper.cpp`，本机为了 A 卡做过 Windows 兼容层，换机器、换显卡或换系统时可能需要调整。

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

## 测试

```bash
cd frontend
npm test
npm run build
npm run test:e2e
cd ../backend && python -m compileall app
```

测试基线（P2 7.2 Media）：前端 52 文件 / 406 用例（共享代码）；后端 99 项；Media 构建 2700 modules，前端/后端镜像已按同一套代码重建。

测试基线（P2 7.2 Lite）：后端 99 项（含 profile 边界、Lite 学习状态、动作联动、确认卡跨重启恢复、Lite MCP/能力清单/健康检查、Demo 登录预填）；前端 52 文件 / 406 用例；Lite / Demo 构建 2700 modules；4 路并发 Agent 峰值 189.8 MiB（backend 177.7 + frontend 12.1）。

## 参与

欢迎开 issue、提 PR、拆功能、改主题、接新模型、做新插件。

方向是先把个人工作流做舒服，再把视频学习、时间管理、AI 助手和插件系统慢慢打磨成一个稳定的本地工作台。

如果要给小团队使用，建议优先补账号权限、备份恢复、HTTPS / 反向代理、安全审计和 AI 调用限制。

## 配置资产版本库

7.0 把 7 个配置资产纳入 PostgreSQL 原生版本库，由后端提供 Git 风格 API，前端设置页提供管理界面：

- 入口：管理员登录后，设置 → 配置资产；或直接打开 `/asset-registry.html` / `/#/asset-registry`。
- 纳管清单：`configs/manifest.yaml`，当前 7 个文件（前后端提示词、检索、向量、LLM、数据库、工具治理）。
- 操作：编辑 → 提交；新建分支 / 标签；对比上一提交；合并；回滚；发布 HEAD 原子写回 `configs/`；审计日志。
- 发布后：后端读取新配置会热刷新；已加载旧提示词的 worker 需要重启后生效。
- 权限：仅 `role=admin` 可见可写；版本库只存文本 blob，不依赖外部 Git 服务。

## 文档

设计记录、踩坑记录、更新日志与部署说明的完整索引见 [docs/README.md](docs/README.md)（文档索引统一维护）。
根目录 `CHANGELOG.md` 记录用户可感知的功能变化，`docs/BUGFIXES.md` 记录缺陷修复，`docs/PERFORMANCE.md` 记录性能改动。

## License

MIT
