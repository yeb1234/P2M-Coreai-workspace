# 2026-05-10 改进与踩坑记录

本文记录今天对 SiteYeb / P2M CoreAI 工作台的主要改进、涉及技术、踩坑点和后续维护原则。

## 视频站交互

### 右侧播放列表面板

涉及文件：

- `src/components/video/VideoPlaylistPanel.tsx`
- `src/components/video/VideoPage.tsx`

改动：

- 右侧“学习操作”标题删除，操作区改为紧凑按钮排布。
- “生成字幕”和“校对字幕”分离：
  - “生成字幕”默认只做转写和总结，不做 LLM 校对。
  - “校对字幕”强制使用 `large-v3`，并开启本地 LLM 校对。
- “自动连播”从操作按钮区移到“文件夹视频”标题右侧，用小 checkbox 控制。
- 面板容器增加 `min-w-0` 和 `maxWidth: 100%`，避免按钮撑出可调宽侧栏。
- 按钮文案改短，例如“生成字幕”“校对字幕”，避免窄面板溢出。

维护原则：

- 右侧栏里的按钮必须能在 320px 左右宽度正常显示。
- 新增按钮时优先用 icon + 短文案；长说明放 `title`。
- 固定宽度面板内不要使用不可换行的大按钮组。

### AI 任务中心

涉及文件：

- `src/components/video/VideoAiJobCenter.tsx`
- `src/components/video/VideoPage.tsx`
- `src/lib/videoApi.ts`

改动：

- 顶部工具栏改为轻量图标组，不再使用两个突兀的按钮盒。
- 任务操作按功能分组：
  - 继续/暂停/刷新。
  - 同步设置/清除已完成/清除全部。
- 批处理增加“同时校对字幕”开关，默认关闭。
- 批处理开关开启后，前端入队参数会切换为：
  - `whisper_model: "large-v3"`
  - `subtitle_correction_enabled: true`
  - `subtitle_correction_scope: "full"`
- 批处理开关关闭时：
  - `subtitle_correction_enabled: false`
  - `subtitle_correction_scope: "off"`

维护原则：

- AI 任务中心的按钮只显示图标，说明放 tooltip。
- 批处理参数变化时必须清空旧预估结果，避免拿旧参数入队。
- 已排队任务保存的是当时的快照；设置页改动不会自动影响旧任务，必要时使用“同步排队任务设置”。

## 字幕转写与校对

涉及文件：

- `src/stores/transcriptionStore.ts`
- `src/components/settings/SettingsPage.tsx`
- `backend/app/services/ai_jobs.py`
- `backend/app/services/subtitle_corrector.py`
- `backend/app/routers/ai_jobs.py`
- `backend/app/routers/admin.py`
- `backend/app/database.py`
- `backend/app/schemas.py`

最终策略：

- 默认不校对。
- 普通生成任务只负责转写和总结。
- 手动点击“校对字幕”时才启用校对。
- 批处理默认不校对，只有打开“同时校对字幕”才校对。
- 校对范围不再区分“英文片段/自动/全量”，开启校对就是全量校对。

关键参数：

```ts
subtitle_correction_enabled: boolean
subtitle_correction_scope: "full" | "off"
subtitle_correction_prompt: string
```

后端行为：

- `subtitle_correction_enabled === false` 时跳过 LLM 校对。
- `subtitle_correction_scope === "off"` 时跳过。
- 其他情况按全量字幕段调用 LM Studio/OpenAI 兼容接口。
- `subtitle_corrector.py` 保持时间轴不变，只允许改每条 segment 的 `text`。

提示词原则：

- 要求 `/no_thinking`。
- 要求只返回 JSON 数组。
- 不允许总结、扩写、翻译、合并、拆分或修改时间轴。

## Whisper / CPU / GPU

涉及文件：

- `backend/app/services/transcribe_whisper.py`
- `backend/app/services/ffmpeg_audio.py`
- `backend/app/database.py`
- `src/stores/transcriptionStore.ts`
- `src/components/settings/SettingsPage.tsx`

模式区分：

- `faster-whisper`
  - 使用 CPU 路线。
  - `cpu_threads` 会传入转写任务。
  - ffmpeg 提取音频也使用任务自己的线程数。
- `whisper.cpp`
  - 外部引擎路线。
  - 不读取 CPU 转写线程设置。
  - GPU 是否生效取决于 `whisper-cli.exe` 的构建版本和参数，例如 Vulkan/HIP/ROCm。

默认策略：

- 默认线程数改为 12。
- 高性能预设走 `whisper.cpp + large-v3`。
- 低占用预设走 `faster-whisper CPU`，低搜索参数，并关闭校对。

维护原则：

- `.env` 改动后必须重启后端 worker。
- 任务创建时会保存当时的转写参数；已排队任务不会自动读取新设置。
- 如果 GPU 模式仍然跑满 CPU，优先检查 `whisper-cli.exe` 是否真的支持 GPU 后端，而不是只看网页设置。

## 本地 LLM 与接口

涉及文件：

- `backend/app/services/llm_client.py`
- `backend/app/services/assistant.py`
- `backend/app/services/ollama_summarize.py`
- `backend/app/services/subtitle_corrector.py`
- `src/components/layout/AIChatPanel.tsx`
- `src/components/settings/SettingsPage.tsx`

接口策略：

- LM Studio 使用 OpenAI-compatible API。
- 默认 base URL：

```text
http://127.0.0.1:1234/v1
```

- AI 助手、视频总结、字幕校对复用统一 LLM client。
- 模型列表不再定时 15 秒扫描；应该在打开设置/窗口时按需请求。

维护原则：

- 不要在多个业务文件里重复写 streaming、timeout、错误解析。
- 本地模型名可能出现 alias，例如 LM Studio 中同一个模型可能有多个可用名称，前端只负责展示后端扫描结果。

## 后台任务与性能

涉及文件：

- `backend/app/main.py`
- `backend/app/worker.py`
- `backend/app/services/file_scanner.py`
- `backend/app/services/sprite.py`
- `backend/app/routers/admin.py`
- `backend/app/routers/videos.py`

已做策略：

- 启动扫描：数据库已有视频时跳过全量扫描，避免开机卡顿。
- 缩略图后台补图默认关闭。
- 通过环境变量控制后台补图：

```env
THUMBNAIL_BACKGROUND_ENABLED=false
THUMBNAIL_BACKGROUND_IDLE_CYCLES=10
THUMBNAIL_BACKGROUND_LIMIT=1
```

- 雪碧图保持按需生成，不在首页打开时批量生成。
- AI 任务支持恢复卡住任务、暂停队列、恢复队列、清除已完成和清除全部。

维护原则：

- ffmpeg 扫描类工作不能挂在页面首屏同步路径上。
- 缩略图和雪碧图都应该懒加载、队列化或显式触发。
- 大目录下批处理必须有数量上限、预估和确认。

## 主题与 CSS 导出

涉及文件：

- `src/lib/themes.ts`
- `src/index.css`
- `src/components/settings/SettingsPage.tsx`

改动：

- 重写 `themes.ts`，恢复主题名称、说明和 CSS 导出注释。
- CSS 导出文件包含每个变量的说明。
- 深色主题继续对旧页面里的浅色 Tailwind 类做兜底覆盖。

维护原则：

- 页面新增硬编码颜色时，要同步考虑 `theme-surface`、`theme-elevated` 或 CSS 变量。
- 如果深色模式出现亮块，优先搜索：
  - `bg-white`
  - `bg-[#faf9f7]`
  - `bg-[#f3f2ef]`
  - `text-[#1a1a1a]`

## 编码踩坑

今天最大踩坑是中文编码污染。

现象：

- 部分 TSX 文案变成 `????`。
- 部分文件变成 mojibake，例如中文显示成 `瀛︿範`。
- 个别替换脚本还把 JSX 的 `title` 引号破坏，导致文件结构变脏。

原因：

- 在 Windows PowerShell 管道或 Node 脚本中直接写中文时，当前终端编码可能把 UTF-8 中文降级成问号。
- `Get-Content` 显示乱码不一定代表文件坏，但写入后的 `????` 一定是内容已经丢失。

安全做法：

- 人工编辑优先使用 `apply_patch`。
- 如果必须脚本写入中文，优先使用 Unicode escape，避免让 shell 直接处理中文。
- 写完后用 `rg "\?\?\?"` 扫描可疑问号。
- 用 `npx tsc -b --pretty false` 检查 JSX 是否被破坏。
- 最后跑 `npm run build`。

## Git 进程堆积

现象：

- Windows 任务管理器里出现大量 `git.exe`。
- 命令行显示它们都在执行类似 `git add ... tools/models/whisper/ggml-large-v3.bin ...`。
- Git 状态和暂存操作变慢，甚至反复卡住。

原因：

- `tools/` 目录里放了本机 Whisper 工具、DLL、EXE 和模型文件。
- 模型文件很大，例如 `ggml-large-v3.bin` 约 3GB。
- 某次暂存操作误把 `tools/` 也纳入，Git 反复尝试处理大文件，导致进程堆积。

处理：

```powershell
Get-CimInstance Win32_Process -Filter "name = 'git.exe'" |
  Select-Object ProcessId,ParentProcessId,CommandLine

Get-Process git -ErrorAction SilentlyContinue |
  Stop-Process -Force
```

长期规则：

- `.gitignore` 必须排除 `tools/`。
- 不提交 Whisper 模型、外部二进制工具和本机下载缓存。
- 如果需要记录工具版本，在文档里写下载来源和文件名，不把大文件放进仓库。

## 今日验证

已执行：

```bash
npx tsc -b --pretty false
npm run build
python -m compileall backend/app
```

最近一次前端构建通过。后端 compileall 在后端文件改动后也通过。

## 后续建议

- 继续把 `VideoPage.tsx` 里的播放状态机拆成更小 hook。
- 把 AI 任务中心的按钮组抽成通用 `IconToolbar`，以后设置页和视频页复用。
- 后端 `videos.py` 里列表序列化和分类路径查询可以继续抽 helper，减少重复查询代码。
- 增加浏览器截图回归检查，重点覆盖视频右侧栏、AI 任务中心、深色模式和设置页。
