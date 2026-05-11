# SiteYeb / P2M CoreAI 工作台

SiteYeb 是一个本地优先的个人工作台：前端使用 React，后端使用 FastAPI，集成待办、番茄钟、日历、笔记、本地视频学习、字幕转写、AI 总结和本地 LLM 助手。

## 当前重点功能

- 类 VS Code 的工作台布局：左侧导航、顶部操作、通知入口、可调宽 AI 侧栏。
- 本地多用户系统：每个用户使用独立的前端持久化数据。
- 视频站：文件夹导航、继续观看、最近观看、最新视频、自定义播放控件、字幕、AI 总结、播放列表自动连播。
- 灵境小助手：支持 LM Studio / OpenAI 兼容接口，默认本地地址为 `http://127.0.0.1:1234/v1`。
- 转写设置：Whisper 模型、语言、CPU 线程、计算类型、beam size、VAD、总结、字幕校对。
- 主题系统：支持 CSS 导出/导入，导出的 CSS 带中文注释，便于手工调整。
- 番茄钟：和待办、历史、日历、工作台摘要联动。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 前端 | React 19、TypeScript 6、Vite 8 |
| UI | Tailwind CSS、lucide-react |
| 状态 | Zustand persist、IndexedDB/Dexie |
| 后端 | FastAPI、SQLAlchemy、SQLite |
| 视频/AI | ffmpeg、Faster-Whisper、whisper.cpp 外部引擎、LM Studio/OpenAI 兼容 API |
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
    services/           扫描、转写、字幕、总结、LLM 客户端
    worker.py           AI 任务 worker
  docs/                 设计记录和踩坑记录
```

实现记录：

- [Codex 改进记录](docs/codex-improvements.md)
- [2026-05-10 改进与踩坑记录](docs/today-fixes-and-pitfalls.md)

以下运行时文件不提交：`.env`、SQLite 数据库、`output/`、`thumbnails/`、`sprites/`、`work/`、`tools/`、Python 虚拟环境。

`tools/` 是本机 Whisper 工具、模型和二进制文件目录，里面可能有数 GB 的模型文件，例如 `ggml-large-v3.bin`。不要把它加入 Git；如果系统里突然出现大量 `git.exe` 进程，优先检查是否误触发了 `git add tools/` 或把大模型文件加入暂存。

## 快速启动（一键启动）

Windows：

```bash
start.bat
```

Linux / macOS：

```bash
chmod +x start.sh
./start.sh
```

会同时启动前端开发服务 (8000) 和后端 / 生产入口 (80)。

## 手动启动

需要同时运行两个服务：

**终端 1 — 后端（FastAPI + AI Worker）**

```bash
cd backend
.venv311/Scripts/activate       # Windows
# source .venv311/bin/activate  # Linux/macOS
python -m uvicorn app.main:app --host 0.0.0.0 --port 80
```

**终端 2 — 前端（Vite 开发服务器）**

```bash
npm install
npm run dev
```

## 服务地址

| 服务 | 地址 | 说明 |
| --- | --- | --- |
| 前端开发 | http://localhost:8000 | Vite 开发服务器，API 自动代理到 80 |
| 后端 / 生产入口 | http://localhost | FastAPI，同时提供 API 和构建后的前端 |
| 本地 LLM | http://127.0.0.1:1234/v1 | LM Studio / OpenAI 兼容接口 |
| Ollama | http://localhost:11434 | Ollama 本地模型 |

## 环境变量（.env）

项目根目录的 `.env` 文件控制所有配置，主要项：

```bash
DATABASE_URL=sqlite:///C:/SiteYeb/learning_os.db   # SQLite 数据库路径
VIDEO_FOLDER=D:/ITJC                               # 视频文件夹路径
VITE_API_BASE_URL=                                 # 留空，前端使用同源或 Vite 代理

# Whisper 转写
WHISPER_ENGINE=whisper.cpp                          # whisper.cpp 或 faster-whisper
DEFAULT_WHISPER_MODEL=large-v3
DEFAULT_LANGUAGE=zh

# 本地 LLM
OPENAI_BASE_URL=http://localhost:1234/v1
OPENAI_API_KEY=lm-studio
OPENAI_MODEL=qwen3-4b

# Ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b-instruct
```

## Docker 部署

一键启动前后端：

```bash
docker-compose up -d
```

前端访问 http://localhost，后端通过 nginx 自动代理。

> **注意**：Docker 中 `whisper-cli.exe` 无法运行（Windows 二进制），
> 需要将 `.env` 中 `WHISPER_ENGINE` 改为 `faster-whisper`。
> 视频文件夹和 whisper 模型路径在 `docker-compose.yml` 的 `volumes` 中配置。

## 测试和构建

```bash
npm run lint
npm test
npm run build
backend/.venv311/Scripts/python -m compileall backend/app
```

当前已验证状态：

- `npm test` 通过：6 个测试文件，40 个测试。
- `npm run build` 通过。
- 现有测试主要在 `src/__tests__/`。

## 视频站说明

- “继续观看”会打开最近一个未看完的视频。
- “最近观看”支持三种排序：从新到旧、从旧到新、时长最长，每页 20 个，共 3 页。
- “最新视频”同样支持分页浏览。
- 文件夹列表支持勾选筛选：勾选子文件夹后只显示这些文件夹的视频（后端过滤，不会丢失分页数据）。
- 播放列表有两个模式：
  - **全部视频**：显示用户浏览上下文的所有视频（未勾选时为父文件夹全部后代，勾选后为勾选文件夹的视频）。
  - **当前文件夹**：只显示该视频所在的最内层文件夹的视频。
- 搜索、进入文件夹、点击面包屑会回到普通目录上下文。
- 播放器会持久化音量、静音、字幕显示、字幕透明度、字幕大小、倍速和自动播放。
- “生成字幕”默认只做转写和总结，不做 LLM 校对。
- “校对字幕”会使用 `large-v3` 重新生成字幕，并把字幕交给本地 LLM 校对。
- 批处理默认不校对；在 AI 任务中心打开”同时校对字幕”后，批处理会切到 `large-v3` 并启用校对。

## 性能与后台任务

- 启动扫描：数据库已有视频时避免全量同步扫盘。
- 缩略图和雪碧图保持懒加载或队列化，避免页面打开时同步批量生成。
- 后台 worker 默认不自动补生成缩略图；如需开启，设置 `THUMBNAIL_BACKGROUND_ENABLED=true`。
- `THUMBNAIL_BACKGROUND_IDLE_CYCLES` 控制空闲多少轮后补图。
- `THUMBNAIL_BACKGROUND_LIMIT` 控制每轮最多生成几个。
- Faster-Whisper CPU 线程数在任务创建时写入任务；`.env` 改动后需要重启后端 worker 才能重新读取。
- `whisper.cpp` 外部/GPU 引擎不使用 CPU 转写线程设置，GPU 是否生效取决于 `whisper-cli.exe` 本身和额外参数。

## 今日维护重点

- 清理了视频页右侧按钮布局，避免按钮把面板撑出窗口。
- AI 任务中心顶部工具栏改成轻量图标组。
- 修复了多处中文乱码，CSS 导出说明也恢复为干净中文。
- 字幕校对策略改为默认关闭，只有手动校对或批处理开关开启时运行。
- 文档补充了本地 LLM、Whisper、GPU、后台任务和编码踩坑。

## License

MIT
