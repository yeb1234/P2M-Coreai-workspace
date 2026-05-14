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
- `src/components/settings/AppearanceSettings.tsx`
- `docs/theme-import-export.md`

改动：

- 重写 `themes.ts`，恢复主题名称、说明和 CSS 导出注释。
- CSS 导出文件包含每个变量的说明。
- 新增 JSON 主题包导出，包含 `kind/version/themeId/name/description/vars`。
- 导入逻辑统一收敛到 `parseThemeVarsText()`，支持 CSS `:root` 和 JSON `vars`。
- CSS 导入至少需要核心变量 `--bg-body`、`--bg-base`、`--bg-card`、`--text-primary`、`--accent`，避免普通 CSS 被误识别成主题。
- 导出的 CSS 只包含主题变量和说明，运行时工具类留在 `src/index.css`。
- 深色主题继续对旧页面里的浅色 Tailwind 类做兜底覆盖。
- 新一轮深色主题检查后，补充了暗色主题可用性规则：`body/base/card/elevated` 必须分层，主文字避免纯白，`accent-bg` 不能等于卡片色。
- Playwright 暗色截图不能只设置 `data-theme`，还必须写入主题变量；否则截图仍然是浅色变量，只是挂了暗色 theme id。
- 导入后的自定义主题只使用 `vars`，不会保留导出文件里的名称、说明和分组元信息。

维护原则：

- 页面新增硬编码颜色时，要同步考虑 `theme-surface`、`theme-elevated` 或 CSS 变量。
- 页面组件不要复制主题解析正则；导入只走 `parseThemeVarsText()`。
- 新增主题变量时，同步更新 `ThemeVars`、`THEME_VAR_COMMENTS`、默认主题和 `themeImportExport.test.ts`。
- CSS 导出面向手工调变量，JSON 导出面向备份/迁移。
- 暗色主题修改后要同时跑 `themeImportExport.test.ts`、`regressionContracts.test.ts` 和 Playwright 暗色截图。
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

# 2026-05-11 追加踩坑记录

今天主要集中在 AI 任务中心、外部 LLM、番茄钟声音、视频布局、主题系统和设置入口交互。很多问题不是单点 bug，而是“状态来源不清”和“宽度按视口判断”叠加出来的。

## AI 任务中心和批处理范围

现象：

- 已经完成的 3 个视频，在点击“继续未完成”后又被放进批处理队列。
- 577 个视频卡在任务中心里，用户很难判断这些任务到底从哪个范围读出来。
- “批处理当前文件夹”文案不够准确，实际可能是当前叶子文件夹，也可能是包含子文件夹的全部视频范围。

原因：

- 批处理模式、文件夹范围、任务完成状态是三套逻辑，前端文案没有把范围暴露出来。
- “继续未完成”和“全部重跑”必须严格区分：前者只能挑未成功的视频，后者才允许完成项重新入队。
- 本地 LLM 和外部 LLM 都可能完成总结，判断是否完成不能只看本地模型字段。

维护原则：

- 任务筛选先按数据库真实状态判断，再按用户选择的批处理模式决定是否入队。
- UI 文案必须显示范围，例如“当前文件夹”或“全部视频范围”。
- 总结完成状态要以“任意 LLM 总结成功”为准，不要把外部 LLM 成功的视频误判成未完成。

## 外部 LLM 和真实模型显示

现象：

- 用户已经设置“先外部，再本地”，右侧灵境小助手仍显示 `qwen3-4b`，看起来像只走本地。

原因：

- 右侧面板显示的是前端旧的 `model` 字段，不是后端真实运行时设置。

处理：

- 右侧面板打开时读取后端运行设置。
- 标题下方显示真实策略，例如：
  - `先外部 deepseek-v4-flash，后本地 qwen3-4b`
  - `只用外部 deepseek-v4-flash`
  - `先本地 qwen3-4b，后外部 deepseek-v4-flash`
- 设置页保存后派发事件，让右侧面板立即刷新。

维护原则：

- 和模型执行有关的显示，应以运行时配置为准，不要只读旧的前端持久化字段。
- 外部模型和本地模型要分别显示，避免用户误判请求链路。

## 番茄钟背景音

现象：

- `rain.ogg`、`cafe.ogg` 等声音在控制台报 `Empty src attribute` 或 media error。
- 咖啡馆背景音点开、关、再开后容易卡住，后续状态乱套。
- 音量条 0% 和 100% 显示不贴合，拖动位置和填充条不一致。
- 咖啡馆默认音量过大，壁炉和咖啡馆体感不一致。

原因：

- HTMLAudioElement 的加载和播放是异步的，快速切换时旧请求可能覆盖新状态。
- 背景音“手动播放”和“只在专注阶段播放”是两种模式，不能复用同一套简单开关逻辑。
- 音量感知不是线性的，素材本身响度也不同；不能只靠统一百分比。

维护原则：

- 背景音播放要有命令序号或当前请求引用，避免旧的 `play()`/`pause()` 回调覆盖新状态。
- “专注模式”下点击背景音只是选择将要使用的声音，不等于立即播放。
- 声音素材要提供合理默认音量；咖啡馆这类素材默认值应更低。
- 音量条应按控件实际宽度计算填充和滑块位置，不要让两者分别算。

2026-05-11 追加处理：

- 新增 `src/lib/ambientSoundRules.ts`，把手动/专注模式下的背景音开关规则写成纯函数。
- 新增 `src/hooks/useAmbientSoundController.ts`，集中管理背景音选择、播放、停止、错误提示和音量更新。
- 背景音音量改为按素材独立保存，初始值来自 `AMBIENT_SOUNDS`，例如咖啡馆 30%、壁炉 50%、雨声 30%。
- 音量条填充和滑块位置改为共用 `--ambient-volume-ratio`，避免 0%/100% 两端视觉不同步。
- `PomodoroTimer.tsx` 不再自己维护背景音命令序号，组件只负责按钮和展示。
- 补充 `src/__tests__/ambientSoundRules.test.ts`，覆盖专注前待播放、专注中切换、重复点击关闭、退出专注停止。

新的状态规则（2026-05-12 更新）：

- `config.ambientSound` 是唯一按钮状态：`none` 表示所有背景音按钮关闭，具体声音值表示对应按钮亮起。
- 快捷设置里的“默认背景音”和番茄钟面板下方的背景音按钮都读写同一个 `ambientSound` 字段，不再拆第二套开关。
- `p2m-pomodoro-config-v2` 同时保存番茄钟全部小参数、环境音策略、当前选中声音、每个环境音音量和 `ambientWasPlaying`，刷新和局域网多设备恢复都以这份后台配置为准。
- 手动控制下，用户选中背景音就立即播放，休息阶段也持续播放，直到用户手动关闭或重置。
- 随专注计时下，是否处于专注计时只看 `timer.status === 'running' && timer.phase === 'work'`。
- 随专注计时的非专注阶段点击背景音只保存选择并显示“待启动”，不立即播放；下一次 25 分钟专注开始时再播放。
- 专注计时中点击不同背景音立即切换；点击当前已选中的背景音会写回 `none` 并停止播放。
- 随专注计时进入休息阶段暂停声音但保留按钮亮起，下一轮专注自动恢复；重置、Todo 覆盖启动和手动关闭都写回 `none`。
- 番茄开始按钮仍会在用户点击手势里尝试播放选中的背景音，全局控制器再按 `running + work` 做兜底检测。
- 底层 `ambientPlayer.play()` 会复用同一个声音正在启动中的请求，避免开始按钮和全局检测同时触发时互相打断。
- 播放被浏览器拒绝时，控制器会把 `ambientSound` 写回 `none`、`ambientWasPlaying` 写回 `false`，让按钮状态和真实声音一致。

2026-05-12 追加处理：

- 环境音预加载改为恢复完用户数据后启动：先预加载 `ambientSound`，再低并发顺序预热其它环境音。
- `/sounds/*.ogg` 和 `/sounds/*.wav` 增加 7 天缓存头，局域网其它设备首次打开后能更快进入可播放状态。
- 补充 `ambientSoundRules`、`useAmbientSoundController`、`soundController`、`GlobalAmbientSoundController` 相关测试，锁住按钮状态、预加载和专注开始自动播放。

2026-05-11 声音入口继续收敛：

- `src/lib/sounds.ts` 新增 `soundController`，统一负责交互音、番茄提示音、通知音和 tick 音。
- `playInteractionSound()`、`playPomodoroCue()`、`playNotificationSound()`、`playBreakSound()`、`playTickSound()` 保留为兼容函数，但内部都转到 `soundController`。
- 补充 `src/__tests__/soundController.test.ts`，确认全局声音关闭时不会创建 Web Audio 音调或番茄媒体音频。

维护原则：

- 新增短交互音时优先加到 `INTERACTION_SOUND_NOTES`，不要在组件里临时创建 AudioContext。
- 新增番茄或通知类文件音效时优先加到 `POMODORO_CUES` 或后续同级配置表，不要在业务组件里散写 `new Audio()`。
- 业务组件可以暂时继续调用旧 helper；底层实现必须保持统一入口，方便后续做全局音量、静音、声音包切换。

## 前端布局和收缩错乱

现象：

- AI 任务中心收起时，箭头、标题、状态文案没有对齐。
- 右侧 AI 面板打开后，很多页面虽然视口仍然是桌面宽度，但实际内容容器已经变窄，固定 `lg:grid-cols-*` 会挤压。
- 视频页中间拖拽分隔线在绿色主题下太硬。

原因：

- 旧布局按 viewport breakpoint 判断，而不是按组件实际可用宽度判断。
- 部分按钮组固定两列或四列，窄容器里容易文字截断或错位。
- 分隔线使用整条实线和强主题色 hover，在浅绿主题中视觉过重。

处理：

- 新增 `auto-grid-cards`、`auto-grid-panels`、`auto-grid-wide`、`auto-grid-video`、`auto-grid-compact`，用 `auto-fit + minmax()` 适配实际容器宽度。
- AI 任务中心收起态改为统一 `items-center`，按钮和标题行使用稳定高度。
- 视频右栏拖拽手柄改为淡渐隐线，悬停时才轻微强调。

维护原则：

- 右侧 AI 面板、可拖拽侧栏存在时，优先使用容器自适应网格，少用固定 `lg:grid-cols-*`。
- 固定列数只适合日历周视图、播放器按钮这类语义结构固定的小控件。

## 主题系统

现象：

- `Primer 云白`、`编辑器晨白`、`木棉纸白` 初版区分度太低。
- `曜石暖橙` 和 `墨陶深棕` 初版也太像，都是黑灰橙。
- 深色主题容易漏出旧组件里的浅色背景块。

原因：

- 只是微调色温不够，主题需要从底色、强调色、边框、文字气质一起拉开。
- 老组件里仍有不少 Tailwind 写死色值，例如 `bg-white`、`bg-[#faf9f7]`。

处理：

- 自带主题和自定义风格分组展示。
- 自定义浅色方向拉开：
  - `木棉纸白`：暖纸 + 陶土橙。
  - `Primer 云白`：冷白 + GitHub 蓝灰。
  - `编辑器冰蓝`：浅蓝灰 + 紫蓝强调。
- 深色方向拉开：
  - `曜石暖橙`：黑灰底 + 琥珀橙，高对比。
  - `墨陶深棕`：暖棕陶底 + 柔和陶土色，低对比。
  - `Primer 暗幕`：GitHub 暗色工作台。
  - `反重力紫夜`：紫黑 AI IDE 风格。
- 新增共享暗色兜底，覆盖新增深色主题里的旧浅色类。

维护原则：

- 新增主题前先定义明确视觉方向，不要只改 accent。
- 深色主题必须同步检查硬编码浅色背景。
- 主题名要像主题名，不要叫“夜间模式”“早间模式”这种功能名。

## 设置入口折返

现象：

- 右上角全局设置按钮只能打开设置，不能再次点击收回。

处理：

- UI store 记录进入设置前的页面。
- 不在设置页时点击设置：进入设置。
- 已在设置页时再次点击：返回进入设置前的页面；没有记录则回工作台。
- 移动端顶部设置按钮同步同样逻辑。

维护原则：

- 顶部全局入口适合做 toggle，不要只做单向跳转。
- 如果入口会覆盖当前工作流，应记录来源页面，返回时恢复用户上下文。

## 提交和 PR 踩坑

现象：

- 本机没有 `gh` 命令。
- GitHub API 创建 PR 返回 `Requires authentication`。
- 工作区有 `learning_os.db.bak-*` 数据库备份文件，不能进提交。
- `prompts/__pycache__` 是 Python 缓存，也不能进提交。

处理：

- 先运行 `npm test` 和 `npm run build`。
- 提交前用 `git status --short --ignored` 检查暂存和忽略文件。
- 使用 pathspec 排除数据库备份和缓存目录。
- 分支推送成功后，用 GitHub 给出的 PR 链接手动创建 PR。

维护原则：

- 不提交 SQLite 数据库、数据库备份、Python 缓存、构建产物和本机工具目录。
- 如果没有 GitHub CLI 或 token，推送分支后保留 PR 创建链接即可。

## 后端设置层拆分

现象：

- `backend/app/services/assistant.py` 和 `backend/app/services/ai_jobs.py` 为了读取运行时设置，反向 import `app.routers.admin`。
- `admin.py` 同时包含接口、设置默认值、归一化、数据库读写、健康检查、队列管理，文件过重。

处理：

- 新增 `backend/app/services/admin_settings.py`。
- 把 assistant runtime settings、transcription settings、LLM 使用策略、Whisper 模型文件表、OpenAI base URL 归一化迁到 service。
- `admin.py` 继续保留原 API 路径，只负责收 payload、调用 service、返回 schema。
- `assistant.py` 和 `ai_jobs.py` 改为直接依赖 `admin_settings`，不再从 router 层读取设置。

维护原则：

- 业务服务不能依赖 router 文件；router 只做 HTTP 入口。
- 设置归一化只能维护在 `admin_settings.py`，避免前端保存、AI 任务、助手对话各自有一套默认值。
- 后续继续拆 `admin.py` 时，优先拆 health 检查和 AI 队列管理，接口路径保持 `/api/admin/...` 不变。

2026-05-11 继续处理：

- 新增 `backend/app/services/admin_health.py`，承接数据库、目录、ffmpeg、Whisper、LLM、AI 队列和视频库健康检查。
- 新增 `backend/app/services/admin_ai_queue.py`，承接队列状态、暂停/恢复、清理、取消、恢复失败/卡住任务、同步排队任务设置。
- `backend/app/routers/admin.py` 的对应接口改为委托 service，`/api/admin/health` 和 `/api/admin/ai-jobs/...` 路径不变。

维护原则：

- 队列状态修改统一走 `admin_ai_queue.py`，不要在 router 或前端对应接口里重复写数据库状态同步。
- 健康检查统一走 `admin_health.py`，避免同一项检查在设置页、启动脚本、调试接口里各写一份。
- 继续拆 admin 时，下一块适合处理 rescan、thumbnail、whisper model 查询。

2026-05-11 admin 路由继续瘦身：

- 新增 `backend/app/services/admin_library.py`，承接视频库重新扫描、批量补缩略图、Whisper 模型列表查询。
- `backend/app/routers/admin.py` 现在基本只保留 `/api/admin/...` 路由声明、schema 转换和 service 委托。
- `generate-thumbnails` 仍然保持后台线程补图行为，但线程和数据库会话创建放进 service，避免 router 里混业务流程。

维护原则：

- `admin.py` 后续新增接口时，先判断属于 settings、health、ai_queue、library 哪一类；业务逻辑放对应 service。
- 如果要新增管理域，优先新建 `backend/app/services/admin_*.py`，不要把 router 文件重新堆大。

## Playwright 布局回归

处理：

- 安装 `@playwright/test`，新增 `playwright.config.ts`。
- 新增 `npm run test:e2e`，使用 Vite dev server 自动启动本地页面。
- 新增 `tests/e2e/layout.spec.ts`，覆盖：
  - 设置页打开右侧灵境小助手后无横向溢出。
  - 视频站列表页自适应网格无横向溢出。
  - `primer-dark` 深色主题下设置页保持可读。
- 每个场景覆盖 `1440x900` 和 `1024x768` 两个桌面宽度，并生成截图基准。
- 新增 `tests/contracts/regressionContracts.test.ts`，锁住自适应网格、主区 padding、背景音音量条比例变量、admin router 瘦身这些低成本契约。

维护原则：

- 修改布局、主题、右侧 AI 面板、视频站、设置页前后，都跑 `npm run test:e2e`。
- 更新截图基准只在确认视觉变化是有意的情况下执行 `npx playwright test --update-snapshots`。
- Playwright 测试会走真实注册流程，不依赖内部 Zustand store 注入，避免测试和真实入口脱节。

2026-05-11 继续补充：

- Playwright 增加 Chromium mobile 项目，用 Pixel 7 视口覆盖移动端。
- e2e 改为 mock `/api/videos`、`/api/ai-jobs`、`/api/admin/assistant-settings` 等接口，避免依赖本机视频库和真实后端账号。
- 新增具体视频页截图：AI 任务中心展开、AI 任务中心收起。
- 新增移动端截图：设置页、视频页列表。
- 测试里不写真实用户名和密码；真实账号只用于本机手动联调，不能进入仓库。

维护原则：

- 默认 e2e 走 mock API，保证截图稳定。
- 真实后端联调应该另开 smoke 测试，并通过环境变量提供账号，不写入测试源码。
- 具体视频页测试优先断言布局关键区域，例如播放器、AI 总结、AI 任务中心、无横向溢出；本地媒体文件是否能播放不要作为布局测试前置条件。

## 2.5 性能和结构收尾

现象：

- 多个页面各自监听 `matchMedia` 或读取 `window.innerWidth`，窗口变化逻辑分散。
- 日历月视图、周视图、详情弹层重复做事件过滤和待办分组。
- 视频播放器页面仍然把进度拖动、触摸拖动、悬停预览、媒体加载和错误处理堆在 JSX 附近。
- 灵境小助手为了刷新当前页面上下文，每 1.5 秒固定扫一次状态。
- Todo 到日历同步逻辑直接写在跨模块 effect 里，后续查重复事件或串数据会很难。
- 播放列表没有真实总时长时，用 `watch_progress + 60` 凑进度比例，视觉上像真实进度但不准确。

处理：

- 新增 `useMediaQuery`、`useIsMobile`、`useWindowWidth`，把媒体查询监听集中到一个 hook。
- 新增 `calendarDerivedData.ts`，集中处理日历事件过滤、待办按日期分组、番茄热力和周/月事件选择。
- 新增 `notificationPanelPosition.ts` 和 `notificationTime.ts`，通知面板定位和时间文案都变成可测纯逻辑。
- 新增 `useVideoProgressScrubber`，统一视频进度条鼠标、触摸、拖动和悬停预览计算。
- 新增 `useVideoElementEvents`，统一视频加载、播放错误、音量同步和续播逻辑。
- 新增 `getWatchProgressPercent` 和 `formatWatchProgress`，视频列表只在有真实总时长时显示真实进度。
- 新增 `useAssistantPageContext`，灵境小助手上下文改为订阅页面、视频、笔记变化。
- 新增 `todoCalendarSyncPlan.ts`，Todo 到日历同步先生成 add/update/delete 计划，再执行 store 写入。
- 补充 `notificationPanelPosition`、`notificationTime`、`videoFormat`、`todoCalendarSyncPlan` 单元测试。
- 扩展 `regressionContracts.test.ts`，锁住懒加载、共享时钟、媒体查询、通知定位、视频进度、AI 上下文、Todo 日历同步这些结构边界。

维护原则：

- 只有真正需要时间推进的功能才使用固定 tick，例如正在运行的番茄钟。
- 页面上下文、列表过滤、日历同步、通知定位这类逻辑优先做成状态驱动或纯函数。
- 如果 UI 里出现“看起来能用但数据不完整”的展示，比如没有总时长却画进度条，应宁可不展示，也不要显示猜测值。
- 每次拆大组件后至少跑 `npm test`、`npm run build`；影响布局时再跑 Playwright 对应场景。

本轮验证：

- `npm test`：16 个测试文件，90 个测试通过。
- `npm run build`：通过。
- `npx playwright test tests/e2e/layout.spec.ts --project=chromium-desktop`：15 个通过，1 个移动端用例在桌面项目中跳过。

# 2026-05-11 2.6 追加：番茄钟持久化与雪碧图质量

## 番茄钟重置后刷新残留

现象：

- 点击“重置”或“跳过”后界面已经回到初始态。
- 立即刷新浏览器，旧的专注倒计时又恢复。

原因：

- 番茄钟运行态写入 IndexedDB 原本走 `localOnlyStorage` 的延迟写入。
- 用户立即刷新时，新状态可能还没落盘，恢复逻辑读到了旧 timer。
- `resetTimer` 和部分 `completePhase` 兜底分支没有统一清 `_lastTickTimestamp`。

处理：

- `p2m-pomodoro-storage` 改为本地即时写入。
- `resetTimer` 删除当前未完成 session，并清理 `_lastTickTimestamp`。
- `completePhase` 兜底停止分支写回完整初始 work 时长，并清理 `_lastTickTimestamp`。
- 扩展 `pomodoroStore.test.ts`，覆盖 running、paused、expired running、reset、skip 和旧版本迁移。

维护原则：

- 番茄钟 running timer 是本地运行态，可以刷新恢复，但不能跨设备强同步。
- completed session 是历史，后续如果要跨设备同步，只同步 completed，不同步 running timer。
- 运行态存储不能走延迟写入，否则重置、跳过、刷新会出现旧状态回流。

## 主题刷新恢复

现象：

- 切换主题后刷新，可能回到默认皮肤。

原因：

- 主题应用时机依赖延迟执行，可能早于 UI store hydrate。

处理：

- 新增 `useApplyStoredTheme`。
- `App.tsx` 在 `initialized && Boolean(currentUser)` 后应用 `themeId/customTheme`。
- 契约测试禁止回到 `setTimeout` 应用主题。

维护原则：

- 持久化 UI 状态必须等 hydrate 后再应用。
- 不要用固定延迟猜异步恢复时机。

## 雪碧图预览和清晰度

现象：

- 播放器进度条雪碧图有时无反馈。
- 视频主界面没有 hover 动态缩略预览。
- 现有雪碧图很糊。

原因：

- 后端雪碧图元数据在 CORS 下没有暴露，前端读不到 `X-Sprite-Meta`。
- 前端原来用 `<img objectPosition>` 定位帧，不如背景定位稳定。
- 后端单帧写死 `160x90`，在当前 UI 中被放大后必然糊。

处理：

- 后端 CORS 暴露 `X-Sprite-Meta`。
- 新增 `useSpriteMeta`，统一读取雪碧图元数据。
- 播放器预览改为 `backgroundImage/backgroundPosition`。
- 视频主列表 hover 450ms 后才请求雪碧图，移动端禁用。
- 后端雪碧图默认提升为 `320x180`。
- 新增 `.env` 配置：`SPRITE_FRAME_WIDTH`、`SPRITE_FRAME_INTERVAL`、`SPRITE_COLUMNS`、`SPRITE_JPEG_QUALITY`。
- 旧低清雪碧图 meta 会被视为过期，下次访问自动重建。

维护原则：

- 雪碧图不能列表首屏批量请求，必须 hover 后按需加载。
- ffmpeg 类生成任务要允许失败回退，不能阻塞主 UI。
- 清晰度调高会增加生成耗时和文件体积，后续应做媒体素材队列和质量档位 UI。

本轮验证：

- `npm run build`：通过。
- `npm test`：104 个测试通过。
- `python -m unittest discover -s backend/tests`：8 个后端测试通过。

# 2026-05-11 追加：待办提醒和番茄快捷输入规则

## 背景

待办已经有截止日期、提醒时间、日历同步、时间中心展示和番茄计划，但输入语义容易混在一起。尤其是“下午4点”“明天”“后天”和番茄快捷符这类自然表达，如果不先固定规则，后续实现时很容易出现同一个输入在不同入口表现不一致。

## 本次整理

- 新增 `docs/todo-reminder-input-rules.md`。
- 明确 `下午4点` 表示当天下午 4 点。
- 明确 `明天`、`后天` 是相对当前日期的触发词。
- 明确 `/t1` 表示 1 个番茄，不是 1 轮。
- 明确待办的 `dueDate` 和 `reminderAt` 分工：
  - `dueDate` 负责截止日期和日历截止事件。
  - `reminderAt` 负责具体提醒、通知、时间中心和日历提醒事件。

## 实现边界

当前代码里的快速输入框已经支持颜色快捷符 `/g`、`/p`、`/y`、`/b`，但自然语言提醒时间和 `/tN` 应该先抽成统一解析函数，再让快速输入和编辑弹窗复用。不要在两个组件里各写一套字符串截取逻辑。

## 后续建议

- 新增 `parseTodoQuickInput(text, now)`。
- 覆盖测试：`下午4点`、`明天上午9点`、`后天下午3点`、`/t1`、颜色快捷符组合。
- UI 提示文案要写清楚 `/t1 = 1 个番茄`，避免误解为 1 轮。

# 2026-05-11 追加：番茄钟状态回流和提醒弹窗

## 番茄钟配置不应重置专注轮次

现象：

- 用户已经开始专注后，只是切换背景音设置或保存番茄钟配置，当前专注剩余时间却会被重新计算。
- “手动控制/随专注播放”这类背景音设置本来只应该影响播放策略，不应该重开这一轮专注。

原因：

- `pomodoroStore.updateConfig()` 之前只要保存配置，就会顺带重算当前阶段的 `timeRemaining`。
- 背景音模式属于播放配置，不属于计时参数，但旧逻辑没有区分这两类字段。

处理：

- `updateConfig()` 现在只在当前阶段对应的时长真的变化时，才重新计算 `timeRemaining`。
- 仅修改 `ambientPlaybackMode` 等背景音设置时，保留当前专注剩余时间和运行状态。
- 增加回归测试，覆盖“保存完整配置但只改背景音模式”的场景。

维护原则：

- 番茄钟状态要分成运行态和配置态。
- 改音效、改播放模式、改展示文案，不能默认影响正在跑的倒计时。
- 后续任何会动 `timeRemaining` 的改动，都要先说明它改变的是 work/shortBreak/longBreak 哪个真正的计时参数。

## 待办提醒弹窗

现象：

- 待办到了提醒时间后，用户需要在当前页面直接看到提醒，而不是只在待办页或通知列表里找到状态变化。

处理：

- 新增全局 `TodoReminderPopup`，由应用布局挂载。
- 提醒调度继续由跨模块同步逻辑负责，命中后写入通知状态，再由弹窗展示待办标题。
- 弹窗不依赖当前所在页面，视频页、时间中心、设置页都可以收到到点提醒。

维护原则：

- 提醒是全局能力，不要绑死在待办页面。
- 触发链路保持一条：解析提醒时间 -> 保存 `reminderAt` -> 调度到点提醒 -> 写通知 -> 弹窗展示。
- 先保证到点“看得见”，后续再扩展跳转待办、稍后提醒、完成待办等操作。

# 2026-05-12 追加：排程统一、日历2 重叠和番茄钟 v2 同步

## Todo、日历1、日历2 的主数据源

本轮把 Todo、日历1、日历2 的时间联动统一到后台 `schedule_items`。

维护原则：

- `schedule_items` 是排程主表，开始时间 `startAt` 和截止时间 `dueAt` 都按分钟级保存。
- Todo、日历1、日历2 都应该从同一条排程数据派生展示。
- 不要为了日历2 再做一份单独任务状态，否则很容易回到“一个入口改了，另一个入口没变”的问题。
- 数据库可以清空重做，但清空后也应该按 `schedule_items` 这个新结构恢复，不要兼容旧同步链路。

## 日历2 拖动变两条

现象：

- 日历2 里拖动任务后，原任务还在，新位置又多出一条。
- 或者拖动后位置不准，和真实开始/截止时间对不上。

原因：

- 拖动逻辑如果把 drop 当成新建，就会复制事件。
- 拖动时如果没有统一做分钟吸附和时间换算，视觉位置会和保存时间偏移。

维护原则：

- 日历2 拖动已有任务时必须更新原 `schedule_items.id`，不能新建。
- 外部拖入和内部移动要区分数据类型。
- 拖动落点先换算为分钟，再生成新的 `startAt` / `dueAt`。
- 重叠分列只是日历2 的展示逻辑，不能改变真实排程数据。

## 日历2 同时间段任务显示

现象：

- 同一时间有任务1和任务2时，任务2 会完全盖住任务1。

处理：

- 日历2 内部按同一天的时间交集计算冲突组。
- 冲突组内给每条事件分配列号和列总数。
- 每条事件只占自己的列宽，并保留间距。

维护原则：

- 这套冲突显示只用于日历2。
- 日历1 暂不引入，以免影响已有月/周视图。
- 计算冲突时用真实开始/截止时间，不要用 DOM 位置反推。

## Todo 右侧专注按钮

新规则：

- Todo 不再需要额外勾选番茄钟时间。
- 只要任务有开始时间和截止时间，Todo 条右侧就可以显示专注箭头。
- 点击后按时间段和当前番茄配置自动估算番茄数。

维护原则：

- 估算按完整 `work + shortBreak` 周期向下取整。
- 默认 `25 + 5` 分钟时，2 小时等于 4 个番茄。
- 如果是 `35 + 5` 分钟，2 小时等于 3 个番茄。
- 估算结果至少为 1 个番茄，但前提是开始/截止时间有效。
- 优先保证 focus 轮次能跑完，不强行塞入跑不完的半轮。

## 番茄钟 v2 远程同步

新规则：

- 浏览器本地每秒倒计时。
- 后台只写关键事件和轻量快照。
- 运行中每 15 秒写一次 heartbeat。
- 页面隐藏、刷新、关闭前补写一次。

后台 `user_data` 新键：

- `p2m-pomodoro-config-v2`：设置。
- `p2m-pomodoro-history-v2`：完成历史。
- `p2m-pomodoro-runtime-v2`：当前运行态快照。

维护原则：

- 不要把 `usePomodoroStore` 切回自动远程持久化，否则每秒 tick 可能打后台。
- 旧 `p2m-pomodoro-storage` 和旧 `p2m-pomodoro-runtime` 只能当迁移前残留，不能作为权威数据。
- runtime 只保存可推算状态，不保存不可恢复的浏览器声音对象。
- 所有客户端都关闭且当前阶段过期时，不能自动补记完成番茄。

## 多设备合并规则

当前口径：

- runtime：`updatedAt` 最新者为准。
- config：`updatedAt` 最新者为准。
- history：按 session id 合并。

踩坑点：

- 清空本地历史后，如果不比较远程 history 的 `updatedAt`，旧远程历史会在下次启动时又合回来。
- 两台设备同时操作时暂时没有显式“接管”提示，后续可以补 UI；当前先保持最新更新时间胜出。

## Todo 覆盖启动和环境音图标

现象：

- Todo 覆盖重新开始番茄钟时，声音已经停了，但背景音图标仍显示选中。

原因：

- 覆盖启动绕过了统一的环境音重置路径。

处理：

- Todo 覆盖启动前调用 `resetAmbientSoundSelection()`。
- 同时把番茄 store 里的 ambient sound 更新为 `none`。
- 必要时同步写入 config v2，避免刷新后图标又回到旧选择。

维护原则：

- 计时器重置、Todo 覆盖启动、手动关闭环境音都应该走同一套“选择态清理”逻辑。
- 不要只停止 audio 播放而不改 store 状态，否则 UI 图标一定会和真实声音不一致。

## Playwright 截图基线

本轮验证里 `npm run test` 和 `npm run build` 已通过。

完整 Playwright 布局截图套件当前仍有既有快照差异和缺失基线。不要顺手更新截图文件，除非这次任务明确要刷新视觉基线。

---

# 2026-05-14 追加：侧边栏图标顺序与隐藏状态持久化

## 现象

- 左侧侧边栏拖拽调整图标顺序后刷新，顺序回到默认。
- 点击图标上的"隐藏"后刷新，被隐藏的图标又全部显示出来。

## 根因分析

涉及文件：

- `src/stores/uiStore.ts`
- `src/components/layout/Sidebar.tsx`
- `src/lib/idbStorage.ts`

### 根因 1：reorderNav 返回原引用

- `reorderNav` 在 `fromIdx === toIdx`（拖放到同一位置）时直接 `return { navOrder: order }`，但 `order` 是 `state.navOrder` 的浅拷贝 `[...state.navOrder]`，而 `fromIdx === toIdx` 时 `order` 没有任何改动。
- Zustand 的 `set` 如果返回的 state 引用与当前相同，不会触发订阅，也不会触发 `persist` middleware 的 `setItem`。
- 更隐蔽的是，即使实际移动了位置，如果拖拽结束后的 `fromIdx === toIdx`，同样不会保存。

修复：

- `fromIdx === toIdx` 时仍然返回 `{ navOrder: order }`，其中 `order` 是新的数组引用，确保 persist 被触发。

### 根因 2：merge 缺少异常格式防御

- Zustand v5 的 `persist` middleware 在 rehydration 时调用自定义 `merge(persisted, current)`。
- 如果 storage 返回 `null`、`undefined` 或非对象值，`storageValue.state` 读取会抛异常或产生非法合并结果。
- 原实现只检查了 `!persisted`，没检查 `typeof persisted !== 'object'`。

修复：

- `merge` 开头增加双重检查：`!persisted || typeof persisted !== 'object'` 时直接返回 `current`。
- 提取 `saved` 后再检查 `!saved || typeof saved !== 'object'`，异常时安全回退。
- DEV 模式下增加 `console.log('[uiStore merge] ...')`，浏览器端可实时查看 hydration 数据。

### 根因 3：hideNav / showNav 的状态变更链路

- `hideNav` 和 `showNav` 本身逻辑正确，将 `id` 加入或移出 `hiddenNavItems`。
- 但如果 `merge` 崩溃，整个 rehydration 失败，刷新后 `hiddenNavItems` 回到初始空数组。

## 新增测试

- `src/__tests__/uiStore.test.ts`：
  - `preserves navOrder after reordering`
  - `preserves hiddenNavItems after hiding`
  - `preserves both order and hidden state together`

## 验证

- `npm test`：25 files / 190 tests 全部通过。
- `npx tsc --noEmit`：0 errors。

## 维护原则

- Zustand persist 的 `merge` 必须对 `persisted` 做防御检查：它可能是 `null`、`undefined`、字符串、数字或 `{}`。
- 任何改变数组的 store action，返回的新数组引用必须明确创建（`[...arr]`、`arr.filter(...)` 等），不能依赖旧引用。
- 侧边栏的 `navOrder` 和 `hiddenNavItems` 都属于用户偏好，应随 `uiStore` 一起持久化；不要把它们拆到独立 storage 里。

---

# 2026-05-14 追加：IT 视频站文件夹系统崩溃

## 现象

- 用户点击"前端"文件夹后界面没反应，以为没点中，连续点击多次。
- 最终 breadcrumb 变成 `[全部视频, 前端, 前端, 前端, ...]`，渲染时 key 重复导致 React 崩溃。
- 报错信息类似 "Multiple elements with the same key..."

## 根因分析

涉及文件：

- `src/components/video/VideoList.tsx`
- `src/stores/videoStore.ts`
- `src/components/transcriber/CategoryTree.tsx`

### 根因 1：useMemo 依赖是函数引用

- `const children = useMemo(() => getCurrentChildren(), [getCurrentChildren])`
- 依赖项是 `getCurrentChildren` 函数引用（Zustand store 中的函数引用永远不会变化）。
- `currentCategoryId` 变化后 `children` 从不重新计算，界面永远卡在根目录。
- 用户连续点击，每次点击都触发 `enterCategory`，但 children 没更新，用户以为操作失败。

修复：

- `useMemo` 依赖从 `[getCurrentChildren]` 改为 `[categoryTree, currentCategoryId]`，确保切换文件夹后 children 正确更新。

### 根因 2：breadcrumb 重复入栈

- `enterCategory` 向 breadcrumb 追加目标 id，没有判断是否已经是最后一项。
- 用户连续点击同一文件夹，breadcrumb 变成 `[全部视频, 前端, 前端, 前端, ...]`。

修复：

- 追加 breadcrumb 前先判断，如果目标 id 已经是当前最后一项，直接 return。

### 根因 3：key 重复导致 React 崩溃

- breadcrumb 渲染 key 是 `b.id ?? 'root'`，重复 id 导致 key 冲突。
- CategoryTree 如果后端返回了重复节点（网络重试或数据异常），同样会 key 重复。

修复：

- breadcrumb key 改为 `` `${b.id ?? 'root'}-${i}` ``，即使出现极端情况也不会因 key 重复崩溃。
- `CategoryTree.tsx` 新增 `deduplicateTree()` 函数，渲染前递归去重树节点。

## 维护原则

- `useMemo` 的依赖项必须是**会变化的数据**，不能是 store 中稳定的函数引用。
- 任何 push/append 操作前都要考虑是否需要去重或防重入。
- React list key 在极端情况下也应保证唯一性，可以加上索引做兜底。

---

# 2026-05-14 追加：Whisper 模型下载状态可视化改进

## 现象

- 设置页和转写面板的 Whisper 模型下载按钮，点完没有进度反馈，用户不知道下载是否在进行。
- 多点几次按钮，前端状态混乱（"卡死"），因为多个下载请求并发触发。
- 刷新页面后，下载中的状态丢失，按钮又变回"立即下载"。

## 根因分析

涉及文件：

- `src/components/settings/TranscriptionSettingsSection.tsx`
- `src/components/transcriber/TranscriptionSettingsPanel.tsx`

### 根因 1：状态粒度过粗

- 原来用 `downloadingModel: string | null` 和 `downloadError: string` 两个独立 state。
- 只能记录"当前正在下载的模型"，不能记录多个模型的状态，也不能记录已完成/失败的状态。
- 刷新后 state 重置，所有下载状态全部丢失。

修复：

- 替换为 `downloadStates: Record<string, { status: string; error?: string }>`。
- 每个模型独立一条记录，支持同时追踪多个模型的下载状态。

### 根因 2：没有初始化查询

- 组件 mount 时只请求模型列表，不查询后端下载任务状态。
- 如果用户刷新页面时后台正在下载，前端完全不知情。

修复：

- mount / 重新扫描后，遍历所有 `auto_downloadable` 模型，批量调用 `fetchDownloadStatus()` 初始化状态。
- `Promise.allSettled` 处理，单个查询失败不影响其他模型。

### 根因 3：轮询范围太窄

- 原来只在 `downloadingModel` 非空时轮询，且只查询那一个模型。
- 如果下载完成后再启动新下载，轮询不会自动恢复。

修复：

- 用 `hasActiveDownload = Object.values(downloadStates).some(s => s.status === 'started' || s.status === 'running')` 判断是否需要轮询。
- 轮询时批量查询所有 `auto_downloadable` 模型，每 3 秒一次。
- `completed` 时自动调用 `fetchWhisperModels()` 刷新模型列表，`failed` 时保留错误信息。

### 根因 4：前端没有防重入

- 下载按钮的 `onClick` 没有检查当前是否正在下载，直接调用 API。
- 后端虽然有 `_DOWNLOAD_JOBS` 防重入，但前端状态会被覆盖。

修复：

- `disabled` 和 `onClick` 开头都检查 `downloadStates[modelId]`，如果是 `started`/`running` 直接 return。
- 点击后立即在本地设置 `status: 'started'`，不用等后端响应，UI 立刻反馈。

## 按钮状态设计

| 状态 | 显示 | 颜色 | 可点击 |
|------|------|------|--------|
| 未下载 | 立即下载 | 主题 accent 色 | 是 |
| 下载中 | Loader2 旋转图标 + "下载中..." | 灰色 | 否（disabled） |
| 下载失败 | "下载失败，点击重试" | 红色 (#dc3545) | 是 |
| 下载完成 | 默认"下载完成"，hover 显示"重新下载" | accent 色 | 是 |

## 下拉选项状态后缀

每个 `<option>` 除了模型名称和描述，还根据 `downloadStates` 显示：

- `模型名 - 下载中...`
- `模型名 - 下载失败`
- `模型名 - 下载完成`
- `模型名 - 未安装`

## 维护原则

- 异步操作的状态不要用单个字符串/null 来记，用 Record 给每个实体独立状态。
- 前端 mount 时主动向后端查询正在进行的任务，刷新后也能恢复状态。
- 轮询的触发条件应该是"有没有活跃任务"，而不是"用户有没有点过按钮"。
- 按钮的 `disabled`、`onClick` 和显示文案必须基于同一套状态，避免"disable 但还能点"或"点了没反馈"。
- 后端已有防重入时，前端也要做同样的检查，减少无效请求。
