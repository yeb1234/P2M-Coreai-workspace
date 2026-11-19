# P2 演示素材包

> 状态：现行（2026-11-16 最后整理）。这是演示素材，不是架构规范；参数与端口以 `docs/README.md` 为准。

这个目录只放“拿得出手、能打开、能被验证”的演示材料。目标不是把 29 个页面逐页讲一遍，而是用 8 分钟说清一件事：**P2 把 1.4 万条视频变成了可检索、可记忆、可规划、可恢复的学习系统。**

## 先打开哪个

| 文件 | 用途 | 什么时候用 |
|---|---|---|
| [architecture-demo.html](architecture-demo.html) | 单文件可交互架构演示页，带动画、明暗主题、视角切换和四张实拍截图 | 面试/路演开场，或作为讲解时的“地图” |
| [architecture-demo-walkthrough-final.mp4](assets/architecture-demo-walkthrough-final.mp4) | 24.8 秒自动巡览：总览 → 检索 → 记忆 → 任务 → 部署 → 成绩 → 证据 → 明暗切换 | 不方便现场操作时，直接播放这段录屏 |
| [01-video-library-status.mp4](assets/01-video-library-status.mp4) | 23.2 秒：真实视频库搜索 `00-0自我介绍`，展示“有字幕 / 缺总结”两个独立状态；AI 任务中心选“只补总结”并预览 | 讲“字幕和总结分开标记、补总结不重跑 Whisper” |
| [02-chat-rrf.mp4](assets/02-chat-rrf.mp4) | 19.2 秒：新建对话，问“RRF 融合重排怎么做”，回答正文出现课程链接，点回《…node_rrf…》真实视频 | 讲“系统从自己的库里检索出讲 RRF 的课” |
| [03-learning-path.mp4](assets/03-learning-path.mp4) | 15.1 秒：学习路径的累计观看、完成率、4/7 步和真实视频步骤，滚动到第 5–7 步 | 讲“学习路径绑定真实视频，不是编课程名” |
| [highlights.md](highlights.md) | 8 个能讲 60 秒的亮点，带证据、讲法和“不要说过头” | 准备自我介绍、简历项目描述、面试问答 |
| [demo-script.md](demo-script.md) | 8 分钟逐字稿 + 60 秒/3 分钟压缩版 + 录屏检查清单 | 实际录制或现场演示 |
| [evaluation.md](evaluation.md) | 本轮测试、构建、Lint、覆盖缺口的真实结果 | 被问“测试怎么样/还有什么没做” |
| [diagrams.md](diagrams.md) | 5 张 Mermaid 图，可直接贴进文档/幻灯片 | 需要把架构图放进 README 或 PPT 时 |
| [assets/](assets/) | 演示账号实拍截图（工作台、视频站、学习路径、聊天历史） | 演示页内嵌，或单独发给别人 |
| [../tencent-cloud-ready-demo.md](../tencent-cloud-ready-demo.md) | 腾讯云轻量假演示的资源、启动、数据边界 | 租服务器前看，或部署时照着做 |

## 演示边界（先看这段）

- 截图来自本机运行中的站点，使用 `demo` 演示账号；不是 PS，也不是设计稿。
- 页面上的数据是 **2026-11-16 快照**：`videos` 14,327、`content_chunks` 60,259、`subtitle_segments` 3,593,723。实时库变了就重拍/重统计。
- 本包附一段 24.8 秒的 HTML 架构页自动巡览录屏，**不是**真实站点操作流程的成片；另有三段 2026-11-16 从 `http://localhost` 真实前端录制的核心功能视频，不冒充生产环境。
- 腾讯云 demo 是“假演示”：预置视频、预生成字幕/转写结果、模拟任务进度，不声称真实 GPU 转写。
- 不要把 API Key、JWT Cookie、个人笔记、真实聊天记录录进镜头。

## 真实前端核心功能录屏（2026-11-16）

三段均为 `1600×1000`、无旁白/无字幕的原始界面录屏。录制账号是 `demo`，站点是本机 `http://localhost`；不是架构演示页，也不是腾讯云假演示。

| 文件 | 时长 | 镜头里的关键动作 | 对应亮点 |
|---|---:|---|---|
| [01-video-library-status.mp4](assets/01-video-library-status.mp4) | 23.2s | 搜索 `00-0自我介绍` → 打开真实视频 → “有字幕 / 缺总结”两个标签 → AI 任务中心选“只补总结”并预览 | 字幕与总结是两个独立状态；`summary_only` 直读现有字幕，不重跑 Whisper |
| [02-chat-rrf.mp4](assets/02-chat-rrf.mp4) | 19.2s | 新建对话 → 问“RRF 融合重排怎么做” → 回答正文出现课程链接 → 点回《…node_rrf_融合重排和算法说明》 | 三路 RRF 从自己的视频库里检索出讲 RRF 的课；正文内可点链接，不堆相关片段卡片 |
| [03-learning-path.mp4](assets/03-learning-path.mp4) | 15.1s | 学习路径统计 → 4/7 步完成 → 第 5–7 步与真实视频入口 | 学习路径绑定真实视频，不是模板课程名 |

录制脚本与原始 `.webm` 不留在演示包，避免把测试态和临时文件混进交付物。

## 三条演示动线

### 60 秒版（只讲一个故事）

1. 打开 `architecture-demo.html` 的“检索”视角。
2. 说一句：中文检索原来 0 命中，后来三路召回 + 加权 RRF，长句延迟从 1.2s 降到 157ms。
3. 补一句：查“RRF 融合重排”时，检索到的正是库里讲 RRF 的那门课。
4. 收尾：这不是功能堆叠，是把失败修到可验证。

### 5 分钟版

`工作台 → IT视频站 → 学习路径 → 聊天历史`。每页只指一个东西：

- 工作台右侧：小助手回答里的课程链接。
- 视频站：14,327 条视频和一键搜索。
- 学习路径：每一步绑定真实视频。
- 聊天历史：标题 + `#id` + 条数 + 时间，不是一排“学习对话”。

### 8 分钟版

按 [demo-script.md](demo-script.md) 走。结构是：失败 → 修复 → 证据 → 边界。

## 重新生成截图（可选）

截图用 Playwright 从运行中的站点抓，使用演示账号。需要重拍时：

1. 确认 `http://localhost:12302` 可访问，`demo` 账号可登录。
2. 打开工作台、IT视频站、学习路径，分别截取 1600×1000 视口。
3. 在聊天面板点“聊天历史”，截取弹层。
4. 覆盖 `assets/01-dashboard.png`、`02-video-library.png`、`03-learning-path.png`、`04-chat-history.png`。
5. 打开 `architecture-demo.html` 检查四张图没有裂图。

不要用真实账号的笔记页做截图；演示账号的 `demo` 数据更适合公开。

## 相关文档

- [docs/README.md](../README.md)：全项目文档索引与口径。
- [docs/project-story.html](../project-story.html)：更长的项目复盘页。
- [docs/demo-video-script.md](../demo-video-script.md)：旧版三镜头脚本，保留作对照。
- [docs/deploy-tencent.md](../deploy-tencent.md)：腾讯云覆盖层的详细说明。
