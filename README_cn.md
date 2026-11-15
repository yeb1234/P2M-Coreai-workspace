# SiteYeb / P2M CoreAI 工作台

一个本地优先、持续生长的个人 CoreAI 工作台。

它适合个人日常使用，也适合在局域网里给小团队、工作室或家庭设备改造使用。当前不是开箱即用的公网 SaaS，更像一个可以认真折腾、继续加固、继续接 AI 能力的开源底座。

> **3.0 架构重构（2026-11-15）**
>
> 主库已从 SQLite 迁移到 **PostgreSQL 17 + pgvector 0.8.7**，检索从「失效的中文 FTS5 + 319 万条废向量」换成 **pg_trgm 词法 + HNSW 语义 + 加权 RRF + LLM 重排**；
> 灵境小助手升级为 **LangChain ReAct Agent**（8 个工具、SSE 流式、会话记忆），并新增 **LangGraph 学习路径规划**。
> 完整设计取舍与实测数据见 [docs/2026-11-15-3.0-architecture.md](docs/2026-11-15-3.0-architecture.md)。
>
> 启动数据库：`docker compose -f docker-compose.pg.yml --env-file .env up -d`

## 当前功能

- 待办、日历1、日历2、番茄钟、笔记、时间中心。
- 待办和两个日历统一使用后台排程数据，开始时间/截止时间精确到分钟。
- 番茄钟使用本地每秒计时 + 后台关键事件/15 秒快照同步，局域网设备刷新后可以恢复当前阶段、设置和完成历史。
- 番茄钟配置会同步完整小参数、环境音策略、当前背景音、各背景音音量和上次播放状态。
- 本地视频学习、字幕转录、AI 总结、播放进度。
- 字幕转录王：文件夹勾选批量转写、AI 任务队列控制、模型下载状态可视化。
- 灵境小助手，支持本地 LLM 和 OpenAI-compatible 外部 LLM。
- 主题系统（含自动主题切换调度：按时间表自动切换不同主题，支持多规则配置和手动覆盖；Header 右上角可呼出调色板弹窗，以三色竖条色块直观展示所有主题，一键切换）、声音系统、背景音、通知。
- 左侧插件式导航，后续大量 AI 页面都会继续接到插件里。

## 快速启动

### 方式一：Docker 一键启动（推荐，部署/交付用）

```bash
cp .env.example .env      # 填 POSTGRES_PASSWORD、JWT_SECRET、EXTERNAL_LLM_API_KEY
docker compose up -d --build
open http://localhost
```

一次起全套：PostgreSQL(pgvector) + Redis + 后端 + nginx 前端。
GPU 转写、数据迁移、常见问题见 [docs/docker.md](docs/docker.md)。

### 方式二：本地开发（改代码用这个）

先只起数据库：

```bash
docker compose -f docker-compose.pg.yml --env-file .env up -d
```

后端（注意别用 8000，该端口被 Docker 占用）：

```bash
cd backend
.venv311/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8100 --reload
```

前端开发使用 5002 端口，支持 Vite 热更新：

```bash
npm install
VITE_API_BASE_URL=http://127.0.0.1:8100 npm run dev
```

- 前端开发：http://localhost:5002
- API 指向 8100

## 端口

| 端口 | 用途 |
| --- | --- |
| 80 | 后端 / 生产入口，局域网直接访问 |
| 5002 | 前端开发，Vite 热更新 |
| 1234 | LM Studio / OpenAI-compatible 本地模型常用端口 |
| 11434 | Ollama 默认端口 |

## 视频转录

CPU 转录路线更通用，主要走 `faster-whisper`。

GPU / 外部引擎路线主要是 `whisper.cpp`。因为本机为了 A 卡做过 Windows 兼容层，这块对环境依赖比较强，换机器、换显卡或换系统时可能需要大改。建议先用 CPU 路线跑通，再根据自己的硬件继续折腾 GPU。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 前端 | React 19、TypeScript 6、Vite 8 |
| UI | Tailwind CSS、lucide-react |
| 状态 | Zustand、IndexedDB/Dexie、SQLite |
| 后端 | FastAPI、SQLAlchemy、SQLite、JWT |
| 视频/AI | ffmpeg、Faster-Whisper、whisper.cpp、LM Studio/OpenAI-compatible API |
| 测试 | Vitest、jsdom、Playwright |

## 测试

```bash
npm test
npm run build
npm run test:e2e
cd backend && .venv311/Scripts/python -m compileall app
```

## 参与

欢迎开 issue、提 PR、拆功能、改主题、接新模型、做新插件。

这个项目的方向是：先把个人工作流做舒服，再把视频学习、时间管理、AI 助手和插件系统慢慢打磨成一个稳定的本地工作台。

如果要给小团队使用，建议优先补账号权限、备份恢复、HTTPS/反向代理、安全审计和 AI 调用限制。

## 文档

- [更新日志](docs/changelog.md)
- [2.92 技术改进报告](docs/2026-05-16-2.92-technical-report.md)
- [2.7 技术改进报告](docs/2026-05-12-2.7-technical-report.md)
- [踩坑与维护记录](docs/today-fixes-and-pitfalls.md)
- [待办、提醒时间和番茄快捷输入规则](docs/todo-reminder-input-rules.md)
- [主题导入导出说明](docs/theme-import-export.md)
- [后续改进 Todo](docs/next-improvement-todo.md)

## License

MIT
