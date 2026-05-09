# Codex 改进记录

本文档记录本轮 Codex 对 SiteYeb / P2M CoreAI 工作台做的主要改进点，方便后续继续接手、回滚或扩展。

## 总体目标

这轮优化的核心不是单点修 bug，而是把前面反复出现的问题收束到更稳的结构里：

- 视频站从“大组件堆状态”转向可维护的模块化结构。
- 本地 LLM、字幕校对、AI 总结使用统一接口，减少重复 HTTP 逻辑。
- 转写和缩略图这类重任务变得可控，避免开机或进入页面时把 CPU、磁盘打满。
- 中文编码统一按 UTF-8 处理，避免 prompt、文档、前端文案继续出现乱码。

## 视频站前端

### 组件拆分

`VideoPage.tsx` 原来承担了太多职责：列表、播放、字幕、AI 总结、播放列表、快捷键、布局拖拽、播放器参数持久化都混在一起。现在已拆出：

- `VideoList.tsx`：视频站列表页入口。
- `VideoListSections.tsx`：继续观看、最近观看、最新视频等列表区块。
- `VideoPlayerControls.tsx`：播放器内嵌控制条。
- `VideoPlaylistPanel.tsx`：右侧播放列表。
- `VideoAiSummaryPanel.tsx`：AI 总结面板。
- `VideoOverlays.tsx`：字幕等播放器覆盖层。
- `SpritePreview.tsx`：雪碧图预览。
- `VideoSlider.tsx`：播放器滑条。
- `VideoErrorBoundary.tsx`：视频模块错误边界。
- `usePlaylistResize.ts`：播放列表宽度拖拽。
- `useVideoKeyboardShortcuts.ts`：播放器快捷键。
- `videoPlayerSettings.ts`：播放器设置读写。
- `videoPlayerAdapters.ts`：接口数据到 UI 数据的适配。
- `videoPlayerUtils.ts` / `videoFormat.ts`：通用工具函数。

这样后续再改字幕、播放控制、列表展示或右侧 AI 面板时，不需要每次都进入一个超长文件里找状态来源。

### 稳定性

- 视频播放器外层增加错误边界，避免某个视频、字幕或播放器状态异常时把整个视频站页面打崩。
- 播放器设置从 localStorage 恢复后再进入 React state，减少 render 阶段副作用和无限更新风险。
- 字幕显示继续使用自定义 overlay，避免浏览器原生 track 和自定义字幕重复显示。

### 列表体验

- “最近观看”和“最新视频”统一成小卡片预览 3 条。
- 点击右侧数量后，下方主列表展示对应的 8 条视频。
- 搜索、进入文件夹、点击面包屑会回到普通目录上下文，避免“当前列表”来源混乱。

## AI / LLM 接口

新增 `backend/app/services/llm_client.py`，把本地 AI 请求抽成两类客户端：

- `OllamaClient`：用于 Ollama 风格接口。
- `OpenAICompatibleClient`：用于 LM Studio / OpenAI 兼容接口。

目前复用到：

- `assistant.py`：AI 助手聊天。
- `ollama_summarize.py`：视频总结。
- `subtitle_corrector.py`：字幕校对。

这让后续接 LM Studio、Ollama、OpenAI-compatible endpoint 时只需要维护一层 HTTP 行为，不必在每个业务文件里重复写请求、超时、错误解析。

## 字幕与转写

### 字幕校对

- 字幕校对 prompt 已改回 UTF-8 中文。
- 新增“根据上下文修正文章内容”的要求，适合修正语音识别里常见的技术词错误，例如 Git 场景中把 Gate 纠正为 Git。
- 校对仍要求保持字幕时间轴不变，只修正每条字幕 text，避免破坏播放同步。

### Whisper 参数

转写任务支持这些参数：

- `whisper_model`
- `language`
- `cpu_threads`
- `compute_type`
- `beam_size`
- `best_of`
- `temperature`
- `vad_filter`
- `subtitle_correction_enabled`

后端通过 `AiJobOptions` 统一归一化任务参数，新建任务和复用排队任务都走同一套逻辑，避免设置页参数一边生效、一边失效。

## CPU 与后台性能

### CPU 线程控制

之前用户反馈 `.env` 里改 4 线程不明显。现在做了两点：

- Faster-Whisper 继续使用任务里的 `cpu_threads`。
- ffmpeg 抽音频也改为使用同一个 `cpu_threads`，不再只读全局默认值。

注意：`.env` 修改后必须重启后端 worker，已运行的进程不会自动重新读取环境变量。

### 缩略图后台任务

用户担心开机自动扫缩略图把网站卡住，这个风险已经收敛：

- 后台 worker 默认不再自动补生成缩略图。
- 需要开启时设置 `THUMBNAIL_BACKGROUND_ENABLED=true`。
- `THUMBNAIL_BACKGROUND_IDLE_CYCLES` 控制空闲多少轮后补图。
- `THUMBNAIL_BACKGROUND_LIMIT` 控制每轮最多生成几个缩略图。

默认关闭是保守选择，因为 ffmpeg 批量读视频对机械硬盘、移动硬盘、大目录都很不友好。

## 文档与编码

- `README.md` 保留英文说明。
- `README_cn.md` 更新中文说明。
- `docs/today-fixes-and-pitfalls.md` 记录当天踩坑点。
- 本文档记录 Codex 本轮架构和性能改进点。

中文文件统一按 UTF-8 保存。PowerShell 控制台可能把 UTF-8 中文显示成乱码，判断文件是否真乱码时不要只看终端视觉结果，应使用 UTF-8 读取或实际浏览器/编辑器确认。

## 验证结果

本轮改动后已通过：

```bash
npm run lint
npm test
npm run build
backend/.venv311/Scripts/python -m compileall backend/app
```

最近一次结果：

- ESLint 通过。
- Vitest 5 个文件、31 个测试通过。
- 前端生产构建通过。
- 后端 compileall 通过。

## 后续建议

- 继续把 `VideoPlayerView` 的播放状态机拆成 hook，降低播放器主视图复杂度。
- 给 AI job 增加更明确的队列状态查询接口，前端可以更及时刷新“字幕生成完成 / 总结完成”。
- 缩略图和雪碧图可以进一步做显式队列页，用户能暂停、恢复、限速。
- 字幕来源可以加兼容层，统一处理自动生成 VTT、数据库字幕段、外部字幕文件三类来源。
- 深色主题还可以继续按页面做视觉 QA，重点检查对比度、hover 状态和历史数据颜色。
