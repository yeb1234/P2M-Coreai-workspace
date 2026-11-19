# 多用户 P1/P2 修复记录（2026-11-17）

## 结论

上一份评审报告里的 **P1 5 项、P2 5 项已全部落地**，P0 的 `demo` 管理员按用户要求保留，P3 本轮未动。
代码已同步到 `p2-siteyeb-backend-1`，数据库迁移已执行，backend 重启后 healthy；worker / worker2 未重启。

| 级别 | 问题 | 状态 | 落点 |
| --- | --- | --- | --- |
| P1-1 | `recommend_next_videos` 跨用户使用观看历史、目标和画像 | 已修复 | `agents/tools.py`：入口强制 `_uid()`；观看、目标、画像全部按当前用户过滤；兜底排序不再用全局收藏 |
| P1-2 | 无主 `AgentRun` / `LearningPath` 普通成员可读 | 已修复 | `routers/learning.py`、`routers/assistant.py`：无主数据仅 admin；有主数据仅本人，admin 不绕过；启动迁移已回填空归属 |
| P1-3 | 私有笔记删除只删 DB，磁盘文件残留 | 已修复 | `services/user_data_cleanup.py` + `routers/notes.py`：删除后清 `work_dir` 和旧 `output_dir` 文件；删用户时清整目录 |
| P1-4 | 匿名搜索 / 片段搜索可触发 LLM rerank 且无配额 | 已修复 | `routers/search.py`、`routers/videos.py`：匿名强制 `use_rerank=False`；登录用户经 `search_limiter` + `search_quota`；失败退款 |
| P1-5 | 收藏是 `videos.is_favorite` 全局字段 | 已修复 | 新增 `user_video_favorites` 复合主键表；序列化、播放列表、收藏接口全部按当前用户读写；旧列保留但废弃 |
| P2-1 | 普通成员可通过进度上报改共享视频 `duration` | 已修复 | `routers/videos.py`：删除 `save_watch_history` 里的 `video.duration` 回写 |
| P2-2 | admin 读任意会话 / AgentRun，但不能读 private 笔记 | 已修复 | 统一为运维角色：有主会话 / run / path 只允许本人；无主 legacy 仅 admin；private 笔记仍仅本人 |
| P2-3 | 可空归属 + 迁移不完整 | 已修复 | 模型层 `LearningGoal/LearningPath/AgentRun.user_id` 非空；迁移回填 `agent_runs/chat_sessions/memory_items` 并 `SET NOT NULL` |
| P2-4 | 配额先扣后判、`refund()` 无调用方 | 已修复 | plan 后移 consume 并在失败时 refund；chat sync/stream、搜索 rerank、ai-daily 均补 refund；新增 search / ai-daily 配额与限流 |
| P2-5 | 画像摘要仍写“全库笔记” | 已修复 | `services/profile.py` 改为“你已记录 N 篇私人笔记” |

## 数据库变更

- 新表 `user_video_favorites(user_id, video_id, favorited_at)`，复合主键 + `video_id` 索引。
- Alembic 新 revision `b5c6d7e8f9a0`，`down_revision = a1b2c3d4e5f6`，当前库已到 head。
- 启动迁移回填空归属后收紧约束：
  - `agent_runs.user_id`：12 条空 → 全部归到用户 1；当前 `NULL=0`，`NOT NULL` 生效；
  - `learning_paths.user_id` / `learning_goals.user_id`：当前 `NULL=0`，`NOT NULL` 生效；
  - `chat_sessions` / `memory_items` 仍保留 nullable，但读侧不再把空归属当公共数据。

## 验证

- 容器内 `python -m compileall app`：通过。
- `python -m pytest tests -q`：**40 passed**。
- 线上烟测（backend 容器内）：
  - 匿名 `/api/search/hybrid?rerank=true` 返回 200，`rerank_used=false`；
  - 用户 47 收藏视频 36061，用户 32 读取仍为未收藏；用户 47 读取为已收藏；测试后已取消，收藏表 0 行；
  - 用户 1 的 plan run：本人 200，另一个 admin 404；
  - 用户 1 的 chat session：本人 200，另一个 admin 404；
  - 匿名 `/api/videos/search/segments` 返回 200；
  - 临时私有笔记“创建 → 更新落盘 → 删除”：文件已随删除清理，note 行已删。
- `p2-siteyeb-backend-1`：healthy；`worker-1` / `worker2-1` 保持运行，未重启。

## 边界说明

- 本轮没有改 P0 的 `demo` 管理员，也没有改 `docs/demo-video-script.md` 的固定口令。
- 本轮没有做 P3：长度/存储上限、`page_size` 收口、sprite 匿名 ffmpeg、logout 撤销 JWT、固定测试账号清理。
- `AgentRun` 的长期保留策略（30/90 天）仍是产品决策，不在本轮 P1/P2 代码内。
- 修复搜索时顺带修了一个既有 Pydantic 校验问题：`HybridSearchOut.timings` 原来只接受 `float`，而 `embed_cache` 返回 `"hit"/"miss"`，匿名首次搜索会 500；已改为 `float | str` 并通过烟测。
