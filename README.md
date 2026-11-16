# SiteYeb / P2M CoreAI Workspace

当前版本：2.92

一个还在持续生长的个人工作台。

SiteYeb 最开始是为个人学习、看视频、做笔记、跑番茄钟、管理待办和调用本地 AI 准备的。现在它已经慢慢长成一个本地优先的 CoreAI 工作空间：前端是 React，后端是 FastAPI，数据主要落在 SQLite，本机和局域网都能用。

这个项目目前仍然偏个人使用，但我很欢迎开源社区里的朋友拿去研究、改造、提交想法。它不追求一上来就变成大而全的企业系统，更适合个人、家庭、小团队、工作室在可信局域网里用，或者在此基础上继续加固、加权限、加审计，改造成自己的内部工具。

## 适合谁

- 想把待办、日历、番茄钟、笔记、本地视频学习和 AI 助手放到一个工作台里的人。
- 有一堆本地课程/会议/学习视频，希望转录、总结、续播和管理的人。
- 想在局域网里给自己几台设备或小团队共用一个轻量工具的人。
- 想研究 React + FastAPI + SQLite + 本地/外部 LLM 工作流的人。

如果你要直接暴露到公网，请先认真做安全加固。当前定位更接近“个人和小团体内网工具”，不是开箱即用的公网 SaaS。

## 当前能力

- 工作台：左侧插件导航、顶部快捷入口、右侧灵境小助手、通知面板。
- 待办：优先级、截止日期、番茄计划、时间提醒。
- 日历：查看待办、提醒、番茄专注记录和普通事件。
- 番茄钟：专注/休息循环、背景音、统计、历史记录。
- 时间中心：模拟时钟、世界时钟、自定义时区、正计时、倒计时、闹钟、提醒、待办提醒。
- IT视频站：本地视频扫描、文件夹导航、继续观看、字幕、AI 总结、AI 任务中心。
- 字幕转录王：文件夹勾选、批量转写、AI 任务管理、队列控制、模型下载状态可视化。
- AI 助手：支持本地 LLM 和 OpenAI-compatible 外部 LLM，后续会接入更多页面。
- 设置：主题（含自动主题切换调度）、AI、转录、通知、数据管理等配置。Header 右上角可直接呼出主题调色板弹窗快速切换。

未来会继续接大量 AI 功能，前端页面也会尽量统一接入左侧插件系统，而不是散落在不同入口里。

## 2.91 做了什么

这一版重点围绕字幕转录、AI 任务中心和侧边栏体验继续打磨：

- 新增字幕转录王页面（TranscriberPage）：独立插件，支持左侧文件夹勾选、右侧批量转写预览与入队、AI 任务中心队列控制。
- AI 任务中心打磨：批量操作支持预览/应用当前设置/入队三按钮；右侧控制中心全部按钮接入（暂停队列/取消/恢复/清除/批处理）。
- 视频字幕手动纠错：播放视频时双击字幕文字区域弹出编辑弹窗，确认后永久保存到后端并同步更新 VTT 字幕文件。
- Whisper 模型下载状态可视化：前端状态升级为 `Record<string, {status, error}>`，下拉选项实时显示下载中/失败/完成/未安装，防重复点击，组件 mount 后自动轮询状态。
- 转录设置优化：Faster-Whisper 与 Whisper.cpp 双路线预设按钮，CUDA 自动检测修复，VAD 过滤开关错位修复，设置双向同步（转录王面板 ↔ 设置页）。
- 批量入队性能优化：后端删除循环内逐条 commit，统一事务提交；前端自动分块（100 个/批），合并预览结果，解决 600+ 视频 Failed to fetch 超时。
- 转录任务取消/暂停/恢复会真正终止 ffmpeg/whisper-cli 子进程，faster-whisper 迭代中可被中断。
- IT 视频站文件夹系统修复：breadcrumb 重复点击爆炸、CategoryTree React key 重复、切换文件夹后 children 不更新。
- 侧边栏拖拽排序和隐藏状态刷新后丢失修复：`reorderNav` 始终返回新数组引用触发 persist；`merge` 增加异常格式防御检查避免 hydration 崩溃。
- 自动主题切换（05-16 追加）：按时间表自动切换主题，支持多规则、星期/时间/主题配置、手动覆盖、精确时间调度（setTimeout 非轮询）。Header 右上角新增 Palette 图标按钮，点击弹出主题调色板弹窗，以三色竖条色块直观展示所有主题，一键切换。
- 全量测试覆盖 190/190 通过（Vitest）。

## 2.7.0 做了什么

这一版围绕日常真实使用体验继续打磨，重点修持久化、时区和交互细节：

- 修复主题和工作台插件布局刷新后丢失的问题：`idbStorage` 的 debounce 写入补了 `pagehide` 刷新机制，开发模式（未登录）也能正常保存主题。
- 修复左侧侧边栏图标拖拽排序和隐藏状态刷新后丢失：`uiStore` 的 `reorderNav` 始终返回新数组引用以触发 persist，`merge` 增加异常格式防御检查避免 hydration 崩溃。
- 修复时区偏移导致的刷新后时间错乱：日期时间工具统一输出本地时间字符串（不带 `Z`），避免 UTC 转换导致的 8 小时偏移。
- Todo 表单时间输入默认整点填充，结束时间自动 +1h，支持跨天。
- 日历2 支持拖拽事件项下边缘调整时长，15 分钟对齐，松开自动保存。
- 番茄钟"本轮"显示按关联任务的 `pomodoroRounds` 动态显示（如 2 个番茄的任务显示 0/2）。
- 番茄钟完成目标番茄数后自动勾选待办完成。
- 笔记编辑模式 Alt+Enter 正确换行，解决浏览器默认行为不一致导致无响应的问题。
- AI 设置页提示词模板支持完整管理：列出、切换、编辑名称和内容、新建、删除、重置默认。
- 后端补注册 `calendar_events` 路由，修复日历页面大量 405 Method Not Allowed 报错。
- 全量 ESLint 0 errors 0 warnings。
- 前端开发端口从 8000 改为 5002，避免和常见后端框架冲突。
- 修复 80 端口构建时 `dist/assets` 被 nginx 占用导致构建失败：`vite.config.ts` 临时添加 `emptyOutDir: false`。
- 修复 IT 视频站文件夹系统崩溃：`useMemo` 依赖改为真实状态值、breadcrumb 防重复入栈、key 加索引兜底、CategoryTree 渲染前去重。
- Whisper 模型下载状态可视化：状态从 per-click 字符串升级为 Record-based `downloadStates`，下拉选项显示下载中/失败/完成状态，按钮增加旋转图标和重试提示，防重复点击，刷新后仍可恢复下载状态。

## 2.6.0 做了什么

这一版主要修真实使用中暴露出来的状态和预览体验问题：

- 番茄钟运行状态改为本地即时持久化，重置、跳过、刷新后的状态边界更清楚。
- 番茄钟同步升级为混合模式：浏览器本地每秒计时，后台只保存关键事件和 15 秒运行快照，局域网多设备刷新后能接上当前状态。
- 番茄钟设置、完成历史和当前运行态拆成 `p2m-pomodoro-config-v2`、`p2m-pomodoro-history-v2`、`p2m-pomodoro-runtime-v2` 三类后端用户数据，不再用旧的大 JSON 当权威状态。
- `p2m-pomodoro-config-v2` 会保存完整番茄参数、环境音策略、当前选中背景音、各背景音音量和上次播放状态。
- Todo、日历1、日历2 统一使用后台 `schedule_items`，开始时间和截止时间都按分钟级保存；Todo 右侧专注按钮会按开始/截止时间自动计算番茄数。
- 日历2 支持同一时间段任务分列层叠显示，避免重叠事件互相盖住；拖动更新仍回写同一条排程数据。
- 番茄钟背景音按钮状态统一到 `ambientSound`：专注开始时会按保存的按钮状态自动播放默认背景音，重置或 Todo 覆盖启动会同步清理选择。
- 环境音会在用户数据恢复后优先预加载上次选择的声音，并给 `/sounds/` 音频文件加 7 天浏览器缓存。
- 主题刷新恢复改为读取 hydrated 后的 UI 状态，不再靠延迟 `setTimeout` 猜时机。
- 视频播放器雪碧图预览增加加载/失败状态，前端用背景定位读取帧，避免图片对象定位失效。
- 视频主列表支持桌面端 hover 后按需加载雪碧图预览，不进页面就批量请求。
- 雪碧图默认单帧从 `160x90` 提升到 `320x180`，并支持 `.env` 调整清晰度和采样间隔。
- 老的低清雪碧图会被识别为过期，下次访问自动重建。
- 补充 Vitest、Playwright 和后端 unittest，锁住番茄钟持久化、雪碧图质量和视频卡片按需预览。

## 运行方式

**全部跑在 Docker 里。** 不再是「本机 uvicorn + npm run dev」——
pgvector、Redis、ffmpeg 三件硬依赖只有容器里有。
细节和排障见 [docs/run.md](docs/run.md)。

### 启动

```bash
# Windows：双击 start.bat，选 [1] 或 [2]
# 命令行：
./start.sh            # 完整（含 AI worker）
./start.sh web        # 只要页面，不起 worker
./start.sh stop       # 全停（数据卷保留）
```

或者直接用 compose：

```bash
docker compose up -d                              # 完整
docker compose up -d postgres redis backend frontend   # 不用 AI 助手
```

访问 http://localhost

### 服务与依赖

| 容器 | 作用 | 不用 AI 助手时 |
|---|---|---|
| `siteyeb-pg` | PostgreSQL + pgvector | 必须 |
| `siteyeb-backend` | FastAPI + 缩略图/文件监听 | 必须 |
| `siteyeb-frontend` | nginx（静态页 + 反向代理） | 必须 |
| `siteyeb-redis` | RQ 队列 | 可不起，但 backend 依赖它，留着只占几 MB |
| `siteyeb-worker` | 转写 / 建块 / 向量化 | **可以不起** |

不起 worker 时：浏览、播放、搜索、笔记、待办、路径查看全部正常；
新发起的转写和向量化会堆在队列里没人消费。

### 前端开发（改 UI 时）

Vite 热更新仍然可用，只是后端跑在容器里：

```bash
npm install
npm run dev        # http://localhost:5002，API 代理到 http://127.0.0.1:80
```

## 端口说明

| 端口 | 用途 | 说明 |
| --- | --- | --- |
| 80 | 全部入口 | nginx：静态页面 + `/api` 反代到 backend |
| 5002 | 前端开发 | Vite 热更新，只在 `npm run dev` 时占用 |
| 5432 | PostgreSQL | 只绑 127.0.0.1，不对外 |
| 6379 | Redis | 只绑 127.0.0.1，不对外 |
| 1234 / 1235 | 嵌入模型 | 宿主机 LM Studio。容器内用 `host.docker.internal:1235` |
| 11434 | Ollama | 备选本地 LLM |

`backend` 和 `worker` **不暴露端口**，全部经 nginx 转发。

## 视频转录说明

视频转录目前有两条路线：

- CPU 路线：`faster-whisper`，相对通用，CPU 部分正常。
- 外部引擎路线：`whisper.cpp`，本机为了 A 卡做过 Windows 兼容层。

因为 A 卡/GPU 这块和本机环境绑定比较深，如果你不是类似环境，视频转录的 GPU 部分可能需要大改。CPU 转录逻辑更通用，适合先跑通流程。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 前端 | React 19、TypeScript 6、Vite 8 |
| UI | Tailwind CSS、lucide-react |
| 状态 | Zustand、IndexedDB/Dexie、后端 SQLite |
| 后端 | FastAPI、SQLAlchemy、SQLite、JWT |
| 视频/AI | ffmpeg、Faster-Whisper、whisper.cpp、LM Studio/OpenAI-compatible API |
| 测试 | Vitest、jsdom、Playwright |

## 项目结构

```text
SiteYeb/
  src/                  React 前端
    components/         页面、布局、通用组件
    stores/             Zustand 状态
    lib/                API、声音、主题、工具函数
    hooks/              跨模块同步和恢复逻辑
    plugins/            插件注册
    types/              TypeScript 类型
  backend/app/          FastAPI 后端
    routers/            API 路由
    services/           扫描、转录、AI、管理服务
    worker.py           AI 任务 worker
  docs/                 设计记录、踩坑记录、更新日志
  public/sounds/        本地提示音和背景音
```

## 测试和构建

```bash
npm test
npm run build
npm run test:e2e
cd backend && .venv311/Scripts/python -m compileall app
```

日常改前端时，至少跑：

```bash
npm test
npm run build
```

## 参与和改造

欢迎 issue、PR、二次开发和各种实验性想法。这个项目的方向是“先让个人工作流真的好用”，再逐步把 AI、视频学习、时间管理和插件系统打磨得更稳。

如果你准备给小团队使用，建议优先补：

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

打出容器状态、健康探针最后输出、PG 长事务/锁等待、worker 注册与队列积压、nginx 错误。

查日志：

```bash
bash scripts/logq.sh errors --since 1h   # 错误（含异常类型与 request_id）
bash scripts/logq.sh req <request_id>    # 一次请求/一个任务的完整日志
bash scripts/logq.sh stats --since 24h   # 按级别/logger/状态码聚合
```

## 文档

- [开发工作法（怎么在这个项目上安全改动）](docs/maintainability.md) ← 动手前先看
- [日志方案（落盘/轮转/查询/升级时机）](docs/logging.md)
- [怎么把服务跑起来（容器组合 / 端口 / 数据卷）](docs/run.md)
- [数据库迁移（Alembic 工作流、怎么加一版）](docs/migrations.md)
- [可迁移的经验（哪些 bug 不报错）](docs/lessons.md)
- [后台任务与重启续跑](docs/background-tasks.md)
- [存储与跨设备同步审计](docs/storage-sync-audit.md)
- [更新日志](docs/changelog.md)
- [2.91 技术改进报告](docs/2026-05-13-2.91-technical-report.md)
- [2.7 技术改进报告](docs/2026-05-12-2.7-technical-report.md)
- [2.6 技术改进报告](docs/2026-05-11-2.6-technical-report.md)
- [2.5 技术改进报告](docs/2026-05-11-2.5-technical-report.md)
- [今日踩坑与维护记录](docs/today-fixes-and-pitfalls.md)
- [待办、提醒时间和番茄快捷输入规则](docs/todo-reminder-input-rules.md)
- [主题导入导出说明](docs/theme-import-export.md)
- [后续改进 Todo](docs/next-improvement-todo.md)

## License

MIT
