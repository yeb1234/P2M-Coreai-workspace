# Codex 改进记录

本文记录当前这一轮对 SiteYeb / P2M CoreAI 工作台做过的架构、性能、接口和 UI 改进，方便后续继续接手。

## 总体目标

这轮优化不是单点修 bug，而是把反复出现的问题收敛到更稳定的结构里：

- 视频站从“超大组件堆状态”转向模块化结构。
- 本地 LLM、字幕校对、AI 总结使用统一接口层。
- 转写、缩略图、雪碧图这类重任务变得可控，避免开机或进入页面时打满 CPU/磁盘。
- 中文编码统一按 UTF-8 处理，避免 prompt、文档、前端文案继续出现乱码。
- 右侧栏和 AI 任务中心采用更紧凑的工具布局，避免按钮溢出。

## 前端模块化

视频站相关职责已拆分到多个文件：

- `VideoList.tsx`：视频站列表页入口。
- `VideoListSections.tsx`：继续观看、最近观看、最新视频等列表区块。
- `VideoPage.tsx`：播放器页面主编排。
- `VideoPlayerControls.tsx`：播放器内嵌控制条。
- `VideoPlaylistPanel.tsx`：右侧播放列表和动作按钮。
- `VideoAiJobCenter.tsx`：AI 任务中心、批处理、队列操作。
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

后续建议：

- 继续把 `VideoPage.tsx` 里的播放状态机拆到 hook。
- 把 AI 任务中心图标工具条抽成通用 `IconToolbar`。
- 把批处理预估和入队逻辑封装成独立 hook，降低主组件复杂度。

## AI / LLM 接口

新增统一 LLM 客户端层：

- `backend/app/services/llm_client.py`

复用位置：

- `assistant.py`：AI 助手聊天。
- `ollama_summarize.py`：视频总结。
- `subtitle_corrector.py`：字幕校对。

接口策略：

- Ollama 和 OpenAI-compatible/LM Studio 分别封装。
- LM Studio 默认地址为 `http://127.0.0.1:1234/v1`。
- 业务代码不再重复处理 HTTP 请求、超时、错误解析。

## 字幕校对策略

当前策略：

- 默认不校对。
- 普通“生成字幕”只做转写和总结。
- 手动“校对字幕”强制 `large-v3`，并开启本地 LLM 校对。
- 批处理默认不校对；打开“同时校对字幕”后，批处理切到 `large-v3` 并启用校对。
- 校对范围不再区分英文/术语/自动，开启就是全量校对。

关键字段：

```text
subtitle_correction_enabled
subtitle_correction_scope
subtitle_correction_prompt
```

后端行为：

- `subtitle_correction_enabled=false` 或 `subtitle_correction_scope=off` 时跳过。
- 其他情况走全量校对。
- 校对只修改字幕文本，不改时间轴，不合并或拆分字幕。

## Whisper / GPU / CPU

支持两条转写路线：

- `faster-whisper`
  - CPU 路线。
  - 使用任务里的 `cpu_threads`。
  - ffmpeg 提取音频也使用同一个线程数。
- `whisper.cpp`
  - 外部引擎路线。
  - 不使用 CPU 转写线程设置。
  - 是否用上 AMD 7800 XT 取决于 `whisper-cli.exe` 是否是 Vulkan/HIP/ROCm 等 GPU 后端版本。

设置原则：

- 默认线程数为 12。
- 高性能预设：`whisper.cpp + large-v3`。
- 低占用预设：`faster-whisper CPU`，低搜索参数，关闭校对。
- `.env` 修改后必须重启后端 worker。
- 已排队任务保存的是创建时参数快照，不会自动读取新设置。

## 后台任务与性能

已做策略：

- 启动扫描会在数据库已有视频时跳过全量扫描。
- 后台缩略图补图默认关闭。
- 雪碧图按需生成。
- AI 任务队列支持暂停、恢复、恢复卡住任务、清除已完成、清除全部。
- 批处理有预估、数量上限、确认入队。

关键环境变量：

```env
THUMBNAIL_BACKGROUND_ENABLED=false
THUMBNAIL_BACKGROUND_IDLE_CYCLES=10
THUMBNAIL_BACKGROUND_LIMIT=1
```

后续性能建议：

- 缩略图/雪碧图可以做单独任务中心，显示队列、限速、暂停和失败重试。
- 对超大视频目录继续考虑虚拟列表或分页预取，避免未来单页可见项继续增加。
- 对真实后端联调补单独 smoke 测试，和 mock 布局回归测试分开。

2026-05-11 继续处理：

- 页面路由懒加载，并在侧栏 hover、移动端 touch 时预加载目标页面。
- Header 时钟、时间中心共享 `useClockNow`，避免多个 1 秒定时器重复运行。
- AI 任务中心轮询改为页面可见时 3 秒、后台 10 秒，并避免后台刷新当前视频详情。
- 灵境小助手上下文改为 `useAssistantPageContext`，订阅 activeView、当前视频、当前笔记变化，不再 1.5 秒固定刷新。
- Todo 提醒按最近提醒时间设定下一次唤醒；没有待提醒任务时不保留固定轮询。
- Todo 到日历同步拆为 `todoCalendarSyncPlan`，先计算 add/update/delete，再执行 store 写入。
- 视频播放器拆出 `useVideoProgressScrubber` 和 `useVideoElementEvents`，减少 `VideoPage.tsx` 的事件逻辑。
- 视频列表观看进度统一通过 `videoFormat.ts`，播放列表没有真实总时长时不再显示估算进度条。
- 通知面板定位和时间文案拆成纯 helper，并补单测。

维护原则：

- 固定轮询只保留真正需要时间推进的地方，例如正在运行的番茄钟 tick。
- 页面上下文、列表过滤、日历同步这类逻辑优先订阅状态变化或做计划函数，不要用定时器扫。
- 新拆出的纯函数要补直接单测；组件结构约束用契约测试锁住。

## 主题与样式

已改进：

- `themes.ts` 重写为干净 UTF-8 中文说明。
- CSS 导出包含变量注释和排查提示。
- 新增/保留夜间模式、蓝夜模式等深色方案。
- 视频右侧栏按钮改为紧凑布局，避免撑出可调宽侧栏。
- AI 任务中心工具栏改成轻量图标组。

维护原则：

- 页面内新增硬编码颜色时要同步检查深色模式。
- 可复用面板优先使用 `theme-surface` / `theme-elevated`。
- 避免在窄侧栏里放大号固定宽按钮。

## 编码与文档

今天发现 PowerShell/脚本写中文容易造成编码污染：

- 中文可能被写成 `????`。
- 文件可能出现 mojibake，例如 `瀛︿範`。
- JSX 的 `title` 引号可能被错误替换，导致结构损坏。

安全约定：

- 手工改文件优先用 `apply_patch`。
- 需要脚本写中文时，使用 Unicode escape 或确认写入链路为 UTF-8。
- 改完跑：

```bash
rg "\?\?\?" src backend docs
npx tsc -b --pretty false
npm run build
python -m compileall backend/app
```

## 验证记录

最近执行并通过：

```bash
npx tsc -b --pretty false
npm run build
python -m compileall backend/app
```

备注：`rg` 扫到的 TypeScript `??` 是空值合并运算符，不代表乱码；真正要关注的是连续问号文案、mojibake 字符串和浏览器里的可见乱码。
