# SiteYeb / P2M CoreAI 工作台

SiteYeb 是一个本地优先的个人工作台：前端使用 React，后端使用 FastAPI，集成待办、番茄钟、日历、笔记、本地视频学习、字幕转写、AI 总结和本地 LLM 助手。

## 当前重点功能

- 类 VS Code 的工作台布局：左侧导航、顶部操作、通知入口、可调宽 AI 侧栏。
- 本地多用户系统：每个用户使用独立的前端持久化数据。
- 视频站：文件夹导航、继续观看、最近观看、最新视频、自定义播放控件、字幕、AI 总结、列表自动播放。
- AI 助手：支持 LM Studio / OpenAI 兼容接口，默认本地地址为 `http://127.0.0.1:1234/v1`。
- 转写设置：Whisper 模型、语言、CPU 线程、计算类型、beam size、VAD、总结和字幕修正。
- 主题系统：支持 CSS 导出/导入，导出的 CSS 带中文注释，便于手工调整。
- 番茄钟：和待办、历史、日历、工作台摘要联动。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 前端 | React 19、TypeScript 6、Vite 8 |
| UI | Tailwind CSS、lucide-react |
| 状态 | Zustand persist、IndexedDB/Dexie |
| 后端 | FastAPI、SQLAlchemy、SQLite |
| 视频/AI | ffmpeg、Faster-Whisper、LM Studio/OpenAI 兼容接口 |
| 测试 | Vitest、jsdom |

## 项目结构

```text
SiteYeb/
  src/                  React 前端
    components/         页面、布局、通用组件
    stores/             Zustand 状态
    lib/                API、存储、主题、工具函数
    hooks/              跨模块同步和持久化恢复
    plugins/            工作台插件注册
    types/              TypeScript 类型
  backend/app/          FastAPI 后端
    routers/            API 路由
    services/           扫描、转写、字幕、总结
    worker.py           AI 任务 worker
  docs/                 设计记录和踩坑记录
```

以下运行时文件不提交：`.env`、SQLite 数据库、`output/`、`thumbnails/`、`sprites/`、`work/`、Python 虚拟环境。

## 启动方式

前端：

```bash
npm install
npm run dev
```

默认地址：

```text
http://localhost:5173
```

后端：

```bash
cd backend
.venv311/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 5200
```

本地 LLM 常用地址：

```text
http://127.0.0.1:1234/v1/chat/completions
```

## 测试和构建

```bash
npm run lint
npm test
npm run build
backend/.venv311/Scripts/python -m compileall backend/app
```

最近一次验证包含：

- ESLint 通过
- Vitest 通过
- 前端生产构建通过
- 后端 `compileall` 通过

## 视频站说明

- “继续观看”会打开最近一个未看完的视频。
- “最近观看”小卡片只预览 3 个，点击右侧数量会让下方主列表显示最近观看的 8 个，按从新到旧排序。
- “最新视频”同样只预览 3 个，点击右侧数量会让下方主列表显示最新入库或扫描的 8 个。
- 搜索、进入文件夹、点击面包屑会自动回到普通列表模式。
- 播放器会持久化音量、静音、字幕显示、字幕透明度、字幕大小、倍速和自动播放等参数。

## 性能与后台任务

- 启动扫描：数据库已有视频时应避免全量同步扫盘。
- 缩略图和雪碧图：应保持懒加载或后台队列化，避免页面打开时同步扫盘卡死。
- 后台 worker 默认不自动补生成缩略图；如需开启，设置 `THUMBNAIL_BACKGROUND_ENABLED=true`。
- 可用 `THUMBNAIL_BACKGROUND_IDLE_CYCLES` 调整空闲多少轮后补图，用 `THUMBNAIL_BACKGROUND_LIMIT` 控制每轮生成数量。
- Whisper CPU 线程数需要重启后端 worker 才会重新读取 `.env`；任务创建时传入的线程数会同时用于 ffmpeg 抽音频和 Faster-Whisper 转写。
- 测试环境中 jsdom 没有 IndexedDB 时会使用内存存储 fallback，避免测试被环境能力干扰。

## License

MIT
