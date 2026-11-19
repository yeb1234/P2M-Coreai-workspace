# SiteYeb / P2M 个人 IT 学习工作台

> 状态：现行（最后校对 2026-11-20）
> 当前发布：6.0.0 SmartAgents（2026-11-20）

> **6.0 SmartAgents（2026-11-20）**
>
> 工具契约与模型通道解耦：意图只决定本轮工具集，工具由同一套注册表、预算、超时、熔断与审计层执行；
> 本地 LLM 与外部 LLM 可切换、可降级，工具权限和确认边界不随模型变化。
> 写动作走 LangGraph HITL 确认卡，确认后才落库；每轮最多 1 个写动作，写入后生成动作回执并支持撤回。
> 详见 [docs/2026-11-20-6.0-smartagents-release.md](docs/2026-11-20-6.0-smartagents-release.md)。

一个本地优先的个人学习工作台：React 前端 + FastAPI 后端 + PostgreSQL 17（pgvector）+ Redis（RQ 队列）。适合个人日常使用，也适合在局域网里给小团队、工作室或家庭设备改造使用。当前不是开箱即用的公网 SaaS，更像一个可以继续加固、继续接 AI 能力的开源底座。

数据基线（截至 2026-11-16）：`videos` 14,327；`content_chunks` 60,259（向量覆盖 100%）；`subtitle_segments` 3,593,723；有字幕视频 8,785。

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

- 本地视频学习、字幕转录、AI 总结、播放进度；视频库搜索支持「标题 / 文件夹」与「字幕内容」两种模式，字幕内容走和助手同一条混合检索链路。
- **学习路径**：设定目标后由 LangGraph 规划出步骤，每一步绑定视频库里真实存在的视频，可点击直接跳到对应视频；进度会被对话 Agent 读取，回答「下一步学什么」时按路径推进而不是另起一套。
- **学习轨迹**：等级、本周对比、连续天数、成就徽章、90 天热力图。
- 字幕转录王：文件夹勾选批量转写、AI 任务队列控制、模型下载状态可视化。

### AI 助手与记忆

- 灵境小助手：LangChain ReAct Agent，SSE 流式输出，支持中止生成。6.0 共 13 个受治理工具：检索片段、搜视频标题、视频摘要、学习画像、近期活动、学习目标、我的路径、推荐视频、搜笔记，以及保存笔记、总结另存、安排日历、创建 Todo。
- **6.0 SmartAgents 的核心是「工具契约与模型通道解耦」**：意图只决定本轮工具集，工具仍由同一套注册表、预算、超时、熔断和审计层执行；本地 LLM 与外部 LLM 可以按兜底策略切换，模型换了，工具契约和权限边界不变。
- 写动作走人工确认：保存笔记、日历、Todo 由 LangGraph `interrupt` 弹出确认卡，确认后才写库；每轮最多 1 个写动作，写入后生成动作回执，可在消息里撤回。审计落在 `AgentAction`，工具轨迹落在 `AgentRun.steps`。
- 支持本地 LLM 与 OpenAI-compatible 外部 LLM，按设置页兜底策略在两个通道间切换；429 / 5xx / 超时退避重试，鉴权与路径错误立即换下一家。
- 意图识别在前端完成（根目录 `prompts/clientPrompts.ts`）：6 类有序正则（课程推荐 / 学习路径 / 学习总结 / 代码助手 / 任务拆解 / 知识问答），识别不出才退回手选模板。
- 记忆系统四层：`ChatMessage` 原文 / 会话摘要（超 24 条压缩、保留最近 10 条）/ `MemoryItem` 长期记忆条目 / `UserData` 档案 KV；对话结束后异步抽取记忆。
- 检索三路召回：词法（pg_trgm + ILIKE）+ 向量（HNSW halfvec）+ 视频级元数据，加权 RRF 融合；`RRF_K=60`，权重 lexical `0.8` / vector `1.2` / meta `1.5`，`candidate_k=30`，`rerank_top_n=20`；重排 API 失败时退回 LLM 重排。

> 「相关片段」卡片 2026-11-16 起由 `src/config/features.ts` 的 `FEATURES.chatVideoReferences` 开关关闭（默认 `false`）。关闭只影响渲染：`ReferenceBlock`、`dedupeReferences` 和后端 `chat_agent` 的 references 生成都保留，改回 `true` 重建前端即恢复；后端仍照常生成 references，只是前端不渲染。

### 界面

- 左侧三组导航：日常 7 项 / 学习 9 项 / 工具 13 项，共 29 个注册页面；部分工具类页面仍是静态占位，带「施工中」标记。
- 主题系统（含自动主题切换调度：按时间表自动切换不同主题，支持多规则配置和手动覆盖；Header 右上角可呼出调色板弹窗）、声音系统、背景音、通知。

## 快速启动

### 方式一：Docker 一键启动（推荐，部署 / 交付用）

```bash
cp .env.example .env      # 填 POSTGRES_PASSWORD、JWT_SECRET、EXTERNAL_LLM_API_KEY
docker compose up -d --build
# 或 Windows 双击 start.bat 选 [1]；./start.sh 完整启动
```

一次起全套：PostgreSQL(pgvector) + Redis + backend + worker + frontend。
GPU 转写、数据迁移、常见问题见 [docs/docker.md](docs/docker.md)。

视频库位置、相对路径与跨盘挂载见 [docs/runtime-paths.md](docs/runtime-paths.md)。默认约定是：
Docker 用 `.env` 的 `VIDEO_HOST_PATH=./video-library` 挂到容器 `/videos`；容器内的
`VIDEO_FOLDER` 始终是 `/videos`，不要改成宿主机的 `D:/ITJC`。项目在 C 盘、素材在 D 盘时，
用 junction / symlink 在项目内建 `video-library` 挂载点，配置保持相对路径。

只要页面、不起 worker：

```bash
docker compose up -d postgres redis backend frontend
# 或 ./start.sh web
```

### 方式二：前端本地开发（改 UI 用这个）

后端跑在容器里，只起 Vite 热更新：

```bash
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
| 监控 | 未分配 | 监控段未分配；旧 11162 作废，不再预留 |
| 1234 / 1235 | 宿主机本地模型 | LM Studio；容器内用 `host.docker.internal:1234` / `1235` |
| 11434 | Ollama | 备选本地 LLM |

`worker` 不暴露宿主端口；`backend` 仅把容器内 `8000` 映射到回环 `12402`，对外请求仍全部经 nginx `/api` 转发。

## 视频转录

CPU 转录路线更通用，主要走 `faster-whisper`。

GPU / 外部引擎路线主要是 `whisper.cpp`。因为本机为了 A 卡做过 Windows 兼容层，这块对环境依赖比较强，换机器、换显卡或换系统时可能需要大改。建议先用 CPU 路线跑通，再根据自己的硬件继续折腾 GPU。

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

## 测试

```bash
npm test
npm run build
npm run test:e2e
cd backend && python -m compileall app
```

测试盘点（截至 2026-11-16）：`src/__tests__` 28 个前端测试文件；`backend/tests` 5 个后端测试文件；仓库根 `tests/` 下只有 `contracts` 与 `e2e` 两个目录，后端没有 API 级集成测试。

## 参与

欢迎开 issue、提 PR、拆功能、改主题、接新模型、做新插件。

方向是先把个人工作流做舒服，再把视频学习、时间管理、AI 助手和插件系统慢慢打磨成一个稳定的本地工作台。

如果要给小团队使用，建议优先补账号权限、备份恢复、HTTPS / 反向代理、安全审计和 AI 调用限制。

## 文档

设计记录、踩坑记录、更新日志与部署说明的完整索引见 [docs/README.md](docs/README.md)（文档索引统一维护）。
根目录 `CHANGELOG.md` 记录用户可感知的功能变化，`BUGFIXES.md` 记录缺陷修复，`PERFORMANCE.md` 记录性能改动。

## License

MIT
