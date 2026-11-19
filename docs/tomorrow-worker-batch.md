# 2026-11-17 本机 worker 全天批处理

> 状态：2026-11-16 23:30 实测口径。代码工作区
> `C:\Users\yeb12\WorkBuddy\Worktrees\SiteYeb\p2u-3-0-langchain-529238b4`。
> 本文只讲“明天在本机跑什么、按什么顺序跑、哪些不要跑”。
> 2026-11-18 的腾讯云 demo 不依赖这份队列跑完。

## 0. 先看结论

1. **字幕和总结已经拆成两个独立状态。**
   - 有字幕：`subtitle_path` 或 `transcript_segments` 任一存在。
   - 有总结：`summary` 非空。
   - `subtitle_url` 只是 VTT 下载链接，不能拿它判断“有没有字幕”。
2. 已把 `subtitle_segments` 回填成 `transcription` / `transcript_segments`：
   **8,789 个视频现在都能被批量规则识别为“有字幕”**（回填前只有 17 个）。
3. 当前 **48 个有总结，8,741 个有字幕但缺总结**。
4. “只补总结”已走新分支：直接读现有字幕做总结，**不抽音频、不跑 Whisper**。
   实测任务 `20261116232000308113fbe977d9`：5 秒完成，日志只有 LLM 调用，没有
   `Extracting audio` / `transcribing`。
5. **全库向量化不用重建。** `content_chunks = 60,276`，`embedding IS NULL = 0`，
   已覆盖 8,789 个有字幕视频。5,538 个无字幕视频现在还没有块，等转写完成后
   `chunk_index` 会自动补；不需要 `build_content_chunks.py --rebuild`。
6. **一天跑不完所有缺口。**
   - 无字幕视频 5,538 个，约 1,250 小时音频；按日志 3.8× 实时约 329 CPU 小时，
     连续跑也要约 14 天。
   - 雪碧图当前 131 jpg / 127 meta（今天实测生成了 1 张），有 duration 的视频
     14,325 个；单张 5–20 秒，一天最多 2,000–4,000 张，不是全库。
   - 所以明天的定位是“**把最值钱的队列跑满一天**”，不是“清空所有缺口”。

## 1. 现在的判定逻辑

| 层 | 字段/表 | 作用 |
|---|---|---|
| 原始字幕 | `subtitle_segments` | 逐句字幕，3,594,833 条；历史导入数据都在这里 |
| 视频上的字幕缓存 | `videos.transcription` / `videos.transcript_segments` | 批量规则与“只补总结”读这里；本次已回填 |
| 字幕文件 | `videos.subtitle_path` | VTT 下载链接；没有它不代表没有字幕 |
| 总结 | `videos.summary` | 独立状态；有字幕也可以没有总结 |
| 任务标记 | `ai_jobs.summary_only` | `missing_summary` 批处理创建的任务为 true，worker 跳过 Whisper |

批处理模式：

| 模式 | 入选条件 | 是否重跑 Whisper |
|---|---|---|
| `missing_subtitles` | 没有 `subtitle_path` 且没有 `transcript_segments` | 会 |
| `missing_summary` | 有字幕且 `summary` 为空 | **不会**，走 `summary_only` |
| `unfinished` | 字幕或总结任一未完成 | 有字幕时走现有字幕分支，不重复转写 |
| `failed_only` | 最近一次任务失败 | 按失败任务原参数重跑 |
| `all` | 忽略活跃任务，清空 AI 输出 | 会；唯一强制重跑模式，明天不要点 |

前端展示也改成读后端返回的 `has_subtitles` / `has_summary`，不再用
`subtitle_url` 推断。历史导入的 8,772 个只有字幕表数据的视频，现在会显示
“有字幕 / 缺总结”，而不是“缺字幕”。

## 2. 当前数据基线

| 项 | 数值 |
|---|---:|
| 视频总数 | 14,327 |
| 有字幕视频 | 8,789 |
| 有总结视频 | 48 |
| 有字幕但缺总结 | 8,741 |
| 无字幕视频 | 5,538 |
| `transcription` 非空 | 8,789 |
| `content_chunks` | 60,276 |
| `content_chunks` 缺向量 | 0 |
| 有块的视频 | 8,789（与有字幕视频一致） |
| 雪碧图 | 131 jpg / 127 meta（今天实测 +1） |
| `ai_jobs` 当前 queued/running | 0 |

## 3. 明天的时间表

### 07:30–08:30 预检

```powershell
cd C:\Users\yeb12\WorkBuddy\Worktrees\SiteYeb\p2u-3-0-langchain-529238b4
docker compose ps
docker compose logs worker --tail=100
```

检查：

- `backend`、`worker`、`postgres`、`redis`、`frontend` 全部 Up/healthy；
- worker 日志没有 `name 'logger' is not defined`、没有连续 Traceback；
- `ai_jobs` 的 queued/running 为 0；
- LLM 通道可用：先跑一条 10 秒内的 `missing_summary` 单任务，确认日志是
  `LLM 调用成功`，不是 `Extracting audio`。

### 08:30–09:00 字幕状态确认

```powershell
scripts\run_backfill_subtitles.bat
```

应输出“待回填视频 0 个 / 可被批量规则识别的有字幕视频 8,789 个”。
如果还有剩余，先 `--apply` 补齐再开总结队列。

### 09:00–12:00 第一段总结队列

在视频库 → 任务中心：

1. 范围选“全部视频范围”；
2. 规则选“只补总结”；
3. 先 `dry_run` 预览，确认 `eligible ≈ 8,741`；
4. 上限填 `2000`，正式入队。

按实测 5 秒/条，2,000 条约 2.8 小时；如果外部 LLM 429 降级本地，
按 7–13 秒/条，2,000 条约 4–7 小时。**不要一次把 8,741 条全塞进队列**，
否则任务中心列表和状态轮询都会变重，出错也不容易分段重试。

优先顺序：先跑 Agent / LLM / FastAPI / Python 这些章节所在的文件夹
（当前文件夹 + 包含子文件夹），再跑“全部视频范围”。这些视频是后面腾讯云
demo 和面试叙事最可能用到的。

### 12:00–18:00 雪碧图（独立进程，不和 Whisper 同时跑）

```powershell
scripts\run_sprite_batch.bat --limit 1500
```

- 单张 5–20 秒，1,500 张约 2–8 小时；
- 可重复执行，已有图会跳过；
- 不要在转写任务正在跑的时候开，ffmpeg 会和 Whisper 抢 CPU；
- 如果中午发现总结队列还有很多，先让总结跑，雪碧图推到晚上。

### 18:00–23:00 第二段总结队列

回到任务中心，规则仍选“只补总结”，上限再填 `2000`。
两段合计 4,000 条；按 5 秒/条约 5.6 小时，按 10 秒/条约 11 小时。
如果 23:00 还没跑完，不要切到转写；让队列继续过夜，第二天早上看结果。

失败处理：只点“只重试失败”，不要点“全部重跑”。

### 23:00–07:00 转写（可选，只在总结队列已清空时）

只挑一个高价值文件夹，规则选“只处理无字幕”，上限 `100–200`。

- 5,538 个无字幕视频约 1,250 小时音频；按 3.8× 实时约 329 CPU 小时，
  不是一晚能清空的量；
- 单条 13 分钟视频理论 3.4 分钟，实际受 CPU/模型影响可能 8–15 分钟；
  100 条约 6–25 小时，建议先 100 条试；
- 转写完成后 `chunk_index` 会自动建块+向量，不需要手动跑全库向量化。

## 4. 全库向量化 bat

已准备：

```powershell
scripts\run_full_vectorize.bat
```

它只调用 `backfill_chunk_embeddings.py`，条件是 `embedding IS NULL`；
**不会 TRUNCATE `content_chunks`，不会重算已有向量**。今天实测输出：

```text
嵌入模型: bge-m3 dim=1024
没有待回填的块
```

这表示当前 60,276 个块已经 100% 有向量。明天只有在转写新增视频、或你手动
重建块之后，才会出现“待回填”；那时再跑这个 bat，或等 `chunk_index` 自动补。

不要为了“全库”去跑 `build_content_chunks.py --rebuild`：它会清空
`content_chunks`，是破坏性重建，和补缺不是一回事。

## 5. 明天不要做的事

- 不要点 `all` / “全部重跑”：会清空 AI 输出，8,741 条总结会重新排队。
- 不要一次入队 8,741 条总结：队列可跑，但任务中心状态轮询和失败排查会很难受。
- 不要在总结队列还在跑时开 Whisper 转写：一个 LLM-bound、一个 CPU-bound，
  会互相拖慢，日志也混在一起。
- 不要跑全库雪碧图：14,325 个视频，单张 5–20 秒，一天做不完。
- 不要重跑 `build_content_chunks.py --rebuild`；当前向量覆盖 100%，没有缺失。
- 不要把 `name 'logger' is not defined` 当成新问题：今天 worker 日志没有精确命中，
  `ai_jobs` 当前也没有活跃失败；如果明天再出现，先保留 job id + 日志时间再查。

## 6. 验收口径

每天收工时看这四个数：

```sql
-- 有字幕
select count(*) from videos where subtitle_path is not null
  or (transcript_segments is not null and length(transcript_segments) > 0);
-- 有总结
select count(*) from videos where summary is not null and length(summary) > 0;
-- 缺向量
select count(*) from content_chunks where embedding is null;
-- 队列
select status, count(*) from ai_jobs group by status;
```

通过线：

- 有字幕数保持 8,789（不能因为回填/任务把标记弄丢）；
- 有总结数从 48 往上走，失败任务不堆积；
- `embedding IS NULL` 保持 0；
- `queued` 不再无脑增长，`failed` 可解释、可重试；
- worker 没有反复重启，没有新的 `logger` 报错。

## 7. 腾讯云 demo（2026-11-18）

明天本机队列跑成什么样，都不影响后天腾讯云 demo 的定位：

- 6 条演示视频、预生成字幕/转译 JSON、模拟任务进度；
- 不调用真实 Whisper，不声称 GPU 转写，不声称生产环境；
- 本机只负责把演示素材和方案定稿，云主机按
  `docs/tencent-cloud-ready-demo.md` 部署；
- 如果明天总结只跑了一部分，腾讯云 demo 仍然用固定 6 条数据，不依赖 8,741 条。

## 8. 今天已改的文件

| 文件 | 作用 |
|---|---|
| `backend/scripts/backfill_subtitle_metadata.py` | 从 `subtitle_segments` 回填字幕缓存；幂等，可 dry-run |
| `backend/scripts/generate_sprites_batch.py` | 全库遍历雪碧图缺口，支持 limit / dry-run / 指定 id |
| `backend/app/services/ai_job_tasks.py` | `summary_only` 分支：有字幕直接总结，跳过 Whisper |
| `backend/app/models.py` + `migrations.py` | `ai_jobs.summary_only` 字段与迁移 |
| `backend/app/services/video_serialization.py` + `schemas.py` | 返回 `has_subtitles` / `has_summary` 两个独立状态 |
| `src/lib/videoApi.ts` + `src/lib/videoAiStatus.ts` | 前端按独立状态显示“有字幕/缺总结” |
| `src/components/video/VideoAiJobCenter.tsx` | “只补总结”说明改成不重跑 Whisper |
| `scripts/run_full_vectorize.bat` | 安全补缺，不重建 |
| `scripts/run_backfill_subtitles.bat` | 字幕回填 dry-run / apply |
| `scripts/run_sprite_batch.bat` | 雪碧图批量生成 |
