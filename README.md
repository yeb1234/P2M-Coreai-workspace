# SiteYeb / P2M CoreAI Workspace

当前版本：2.7.0

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
- AI 助手：支持本地 LLM 和 OpenAI-compatible 外部 LLM，后续会接入更多页面。
- 设置：主题、AI、转录、通知、数据管理等配置。

未来会继续接大量 AI 功能，前端页面也会尽量统一接入左侧插件系统，而不是散落在不同入口里。

## 2.5.0 做了什么

这一版主要做稳定性、性能和结构整理：

- 插件页面懒加载，并在侧栏 hover / 移动端 touch 时预加载。
- 时间中心、Header 时钟和番茄相关状态减少重复定时器。
- 视频播放器拆分进度拖动、媒体事件、字幕、播放、设置等逻辑。
- 视频列表、导航卡片、分页、文件夹搜索做了 memo 和回调稳定化。
- 灵境小助手上下文改为状态驱动，不再固定轮询刷新。
- Todo 提醒和 Todo 到日历同步改为更清晰的计划/唤醒机制。
- 深色主题、布局截图和关键契约测试继续补齐。
- 文档补充个人使用、局域网使用、A 卡转录兼容层和后续改造建议。

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

### 日常使用

后端监听 80 端口，局域网内可以直接用机器 IP 访问：

```bash
cd backend
.venv311/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 80 --reload
```

- 本机访问：http://localhost
- 局域网访问：`http://你的电脑IP`

如果只改前端生产包，执行 `npm run build` 后刷新浏览器即可。

### 前端开发

前端测试和开发使用 8000 端口，支持 Vite 热更新：

```bash
npm install
npm run dev
```

- 前端开发地址：http://localhost:8000
- API 会代理到 80 端口后端

## 端口说明

| 端口 | 用途 | 说明 |
| --- | --- | --- |
| 80 | 后端 / 生产入口 | FastAPI，同时可提供构建后的前端；局域网直接访问这个端口 |
| 8000 | 前端开发 | Vite 热更新，适合调 UI |
| 1234 | 本地 LLM | LM Studio / OpenAI-compatible 常用端口 |
| 11434 | Ollama | Ollama 默认端口 |

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

## 文档

- [更新日志](docs/changelog.md)
- [2.5 技术改进报告](docs/2026-05-11-2.5-technical-report.md)
- [2.6 技术改进报告](docs/2026-05-11-2.6-technical-report.md)
- [2.6 计划](docs/2.6-roadmap.md)
- [今日踩坑与维护记录](docs/today-fixes-and-pitfalls.md)
- [待办、提醒时间和番茄快捷输入规则](docs/todo-reminder-input-rules.md)
- [主题导入导出说明](docs/theme-import-export.md)
- [后续改进 Todo](docs/next-improvement-todo.md)

## License

MIT
