# 下一阶段改进 TODO

这份清单用于承接 2026-05-11 之后的改进。目标不是继续堆功能，而是把已经复杂的核心流程变得可解释、可维护、可测试。

## 1. 视频站和 AI 任务稳定性

- [x] AI 任务中心显示本轮任务来源：当前文件夹、全部视频范围、搜索结果或手动单个视频。
- [x] AI 任务中心显示入队规则：继续未完成、只处理无字幕、只补总结、只重试失败、全部重跑。
- [x] AI 任务中心显示跳过原因统计：已完成、已有字幕、已有总结、正在运行、不是失败、无字幕、视频不存在。
- [x] 后端批处理 dry-run 返回更完整的 `skipped_items`，前端展示前几条样例。
- [x] 统一“视频 AI 完成度”口径：字幕、总结、本地 LLM、外部 LLM、任务状态使用同一套判断。
- [x] `unfinished` 模式只处理真实未完成视频，不把已完成视频重新放入队列。
- [x] `all` 模式才允许清空旧输出并重新入队。

## 2. 视频页拆分

- [x] 抽出 `useVideoPlayerMedia`：视频 URL、字幕 URL、字幕片段归一化和详情完整度。
- [x] 从 `VideoPage.tsx` 抽 `useVideoPlayback`：播放、暂停、进度、音量、画中画、全屏。
- [x] 抽 `useVideoSubtitles`：字幕显示、当前字幕行、透明度、大小、textTrack 兜底隐藏。
- [x] 抽 `useVideoSelection`：当前视频恢复、AI 推荐播放事件、待播放视频读取。
- [x] 抽 `useVideoPlayerSettings`：播放器设置读写和迁移。
- [x] 保持拆分期间行为不变，每一步都跑 `npm run build`。

## 3. 设置页重构

- [x] 从 `SettingsPage.tsx` 拆出 `AppearanceSettings`。
- [x] 拆出 `PrivacySettings`、`DataSettings`、`BackendHealthSettings`。
- [x] 拆出 `SettingsNav`，保留设置页主文件只负责路由和布局。
- [x] 把设置页按钮、分组标题、说明文本收敛到通用小组件。

## 4. 主题系统正规化

- [x] 主题卡片改成真实小预览：页面底、卡片、按钮、文字、边框。
- [ ] 继续把硬编码 `bg-white`、`bg-[#faf9f7]`、`text-[#1a1a1a]` 改为 CSS 变量或主题类。（已覆盖设置页和视频站关键卡片/控制条）
- [ ] 深色主题逐页检查，减少依赖 `[class*="..."]` 的兜底。（已补暗色主题层级契约和真实变量注入的 Playwright 截图规则）
- [x] 主题导出包含分组和预览说明。
- [x] CSS/JSON 导入导出规则文档更新：导出只负责变量，导入只使用 `vars`，运行时类和深色兜底留在 `src/index.css`。

## 5. 声音系统独立管理

- [x] 抽 `useAmbientSoundController` 管理背景音选择、播放、停止、音量和错误提示。
- [x] 背景音播放使用命令序号，避免快速切换时旧异步请求覆盖新状态。
- [x] 默认音量按素材独立配置，并让每个素材保留自己的调节值。
- [x] 音量条只使用一套坐标计算填充和滑块。
- [x] 手动/专注两种背景音模式写成状态机，并补 `ambientSoundRules` 单元测试。
- [x] 把交互音、番茄开始/休息/结束提示音收敛到 `soundController`，保留旧 helper 作为兼容入口。

## 6. 后端大文件拆分和自动化验证

- [x] 从 `backend/app/routers/videos.py` 抽列表序列化 helper。
- [x] 从 `backend/app/routers/admin.py` 抽出 assistant/transcription 设置读写服务，修正服务层反向依赖 router 的问题。
- [x] 从 `backend/app/routers/admin.py` 拆出 health 检查和 AI 队列管理服务，接口路径保持不变。
- [x] 从 `backend/app/routers/admin.py` 拆出 rescan、thumbnail、whisper model 查询服务。
- [x] 抽任务资格判断 helper，统一继续未完成、全部重跑、只失败和总结完成口径。
- [x] 增加 AI 批处理规则测试：继续未完成、全部重跑、只失败、外部 LLM 成功状态。
- [x] 增加 Playwright 截图测试：视频页列表、设置页、深色主题、右侧 AI 面板打开后的布局。
- [x] 继续补 Playwright 场景：进入具体视频播放页后的 AI 任务中心展开/收起、移动端设置页和视频页布局。
- [ ] 继续补 Playwright 场景：真实后端联调 smoke、右侧播放列表拖拽宽度、AI 任务中心批处理预览交互。

## 当前执行顺序

1. 先做 AI 任务中心解释和状态口径。
2. 再拆视频页播放相关 hook。
3. 接着拆设置页。
4. 然后继续主题系统和声音系统。
5. 最后补后端拆分和截图/规则测试。
