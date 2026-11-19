# 字幕差视频：首批强制重转写记录（2026-11-17）

## 本次执行结果

- 从 629 条严重候选中筛出 **201 个证据最强视频**，已全部创建强制重转写任务并插队到现有转写队列最前。
- 覆盖音频约 **208.6 小时**。
- 新任务参数统一为：`whisper_model=large-v3-turbo`、`whisper_engine=faster-whisper`、`compute_type=float16`、`device_type=cuda`、`language=zh`、`vad_filter=true`、`beam_size=3`、`best_of=5`、`temperature=0`，并显式设置 `do_summary=false`、关闭字幕 LLM 校对。
- 任务创建后，`ai_jobs` 从约 4,970 条 queued 增至 **5,153 条 queued**；201 条新任务位于队首，剩余旧队列在其后。
- 首个抽样视频 `43168` 已确认：`transcription` 为空、`subtitle_segments` 为 0、对应新 job 为 `queued`，参数与上表一致。

## 选择标准

本次只处理“高置信度字幕损坏”，不处理单纯口头语密度偏高：

1. `garbled_segments`：出现明显乱码/无意义符号/大段不可读文本；
2. `coverage_low` 或 `timestamps_overlap`：字幕覆盖不足或时间轴重叠；
3. `repeat_loop` 且 `repeat_run_max >= 500`：出现连续数百到上万段重复，基本不是正常口语重复。

未进入本次首批的 428 条严重记录：

- `repeat_50_499` 409 条：重复长度 50–499 段，部分可能是正常重复，先不盲目重跑；
- `invalid_only` 19 条：仅时间轴异常、没有乱码或循环证据，留待下一批；
- 其余含 `filler_high` 的警告本身不重转写，清洗层可处理。

## 安全措施

- 清空旧字幕前，已将 201 个视频的旧 `transcription`、`transcript_segments`、`summary`、`markdown_path`、`subtitle_path` 备份到：
  `docs/reports/subtitle_retranscribe_backup_2026-11-17.jsonl`（约 43 MB）。
- 旧 VTT / markdown 文件本身没有删除；强制重跑只清空数据库字段和 `SubtitleSegment` 行。
- 强制重跑同时清空这些视频的旧 AI 总结与旧 `AiJob` 历史；本次 `do_summary=false`，总结留到后续统一总结阶段重跑。
- 本次重跑名单：`docs/reports/subtitle_retranscribe_priority_2026-11-17.csv`。

## 可回滚边界

如果某个视频的新转写失败，旧文本在备份 JSONL 中仍可恢复；旧 VTT/markdown 文件也仍在原输出目录。不要把这份备份当成长期归档，后续确认新字幕稳定后可按需清理。
