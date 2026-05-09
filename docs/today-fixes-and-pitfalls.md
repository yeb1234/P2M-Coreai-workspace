# 2026-05-10 改进与踩坑记录

## 视频站

- “最近观看”和“最新视频”都改成“卡片预览 3 条，主列表展示 8 条”的模式。
- 点击“最近观看”的数量按钮时，下方视频网格显示最近观看的 8 条，顺序为从新到旧。
- 点击“最新视频”的数量按钮时，下方视频网格显示最新入库或扫描的 8 条。
- 搜索、进入文件夹、点击面包屑会退出历史/最新模式，避免列表上下文混乱。
- 小卡片不再直接展开到 8 条，减少导航区域高度跳动。
- 视频页开始模块化：列表页、列表导航、主网格、播放列表面板、AI 总结面板、播放器覆盖层、控制条、雪碧图预览、滑条、播放器设置和播放器适配函数已经拆出独立文件。
- 播放器外层增加错误边界，避免某个视频或字幕状态异常时把整个视频站打崩。

## 播放器和字幕

- 播放器参数从 localStorage 初始化后再进入 React state，避免 render 阶段读 ref 引起 hooks/lint 问题。
- 字幕继续使用自定义 overlay，避免原生 track 和自定义字幕重复显示。
- 字幕校对 prompt 改回 UTF-8 中文，并在生成前要求模型根据上下文修正识别错误，例如 Git 场景里把 Gate 修成 Git。
- 仍需继续关注不同字幕来源的兼容性，以及视频首次加载时字幕详情是否已经补齐。

## AI / 转写 / CPU

- Whisper 参数已经放到转写设置里，包括模型、语言、线程、计算类型、beam size、best of、temperature、VAD、总结和字幕修正。
- CPU 线程控制必须实际传入 Faster-Whisper / CTranslate2 才生效；单纯改 `.env` 后如果 worker 未重启，看起来会像“永远 100%”。
- ffmpeg 抽音频现在也使用任务自己的 `cpu_threads`，不再只读全局默认值。
- AI 任务创建参数集中到 `AiJobOptions`，避免新建任务和复用排队任务两边逻辑漂移。
- 后端新增统一 LLM client：Ollama 和 OpenAI-compatible/LM Studio 请求从业务服务里抽出，AI 助手、总结、字幕校对开始复用同一层 HTTP 适配。

## 后台缩略图

- 用户担心开机自动扫缩略图导致网站卡死，这个风险是真实的：ffmpeg 批量读取视频会明显占用磁盘和 CPU。
- 后台 worker 默认关闭闲时补缩略图，需要显式设置 `THUMBNAIL_BACKGROUND_ENABLED=true`。
- 如果开启后台补图，可以用 `THUMBNAIL_BACKGROUND_IDLE_CYCLES` 控制空闲多少轮后执行，用 `THUMBNAIL_BACKGROUND_LIMIT` 控制每轮最多生成几个。
- 首页和列表图片继续使用懒加载，首屏不应同步批量生成缩略图或雪碧图。

## 测试环境

- Vitest/jsdom 默认没有 IndexedDB，Dexie 会报 `MissingAPIError IndexedDB API missing`。
- 现在 `idbStorage` 在无 IndexedDB 环境使用内存 Map fallback，浏览器环境仍使用 Dexie。
- 修复后 `npm test` 不再出现大量 unhandled rejection。

## 编码

- 中文文件统一按 UTF-8 保存。
- PowerShell 控制台可能把 UTF-8 中文显示成乱码，不能只凭终端视觉判断文件坏了；需要用 UTF-8 读取和关键字符检查确认。

## 验证

```bash
npm run lint
npm test
npm run build
backend/.venv311/Scripts/python -m compileall backend/app
```
