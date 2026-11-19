# 数据库索引与连接池收敛记录（2026-11-17）

## 结论

本轮只执行了审计里**确定安全**的三项索引删除，没有动 `ix_subtitle_segments_text_trgm`，也没有动 `ix_subtitle_segments_video_id`。

| 索引 | 大小 | 删除前 idx_scan | 处理 |
|---|---:|---:|---|
| `ix_subtitle_segments_id` | 155 MB | 0 | 已删除 |
| `ix_videos_id` | 648 kB | 3,974,508 | 已删除，主键索引可替代 |
| `ix_videos_favorite` | 248 kB | 0 | 已删除，保留在用的 `ix_videos_is_favorite` |

释放空间约 **155.9 MB**（按表内索引大小计，不含膨胀/碎片收益）。

## 为什么保留两个大索引

### `ix_subtitle_segments_text_trgm`（306 MB，idx_scan=4）

`backend/app/routers/videos.py` 的 `/segments/search` 在 `hybrid_search` 失败后会走：

```python
SubtitleSegment.text.contains(keyword)
```

这条路径依赖 GIN/trgm 索引。删掉它，降级路径会在 321 万行字幕上顺序扫描，恰好是 embedding/检索服务不可用时最需要兜底的时刻。

如果以后要释放这 306 MB，正确做法是先改兜底查询（例如查 `content_chunks` 的 trgm 索引，或把 `/segments/search` 改成只走 hybrid search），而不是直接 `DROP INDEX`。

### `ix_subtitle_segments_video_id`（49 MB，idx_scan=5,332,430）

复合索引 `ix_subtitle_segments_video_index (video_id, segment_index)` 能覆盖前缀，但这条单列索引仍有 533 万次扫描，是热索引。没有 `EXPLAIN` 证明复合索引能完全替代前，不动。

## 迁移与启动重建

- Alembic 迁移：`backend/alembic/versions/2026_11_17_1950-a1b2c3d4e5f6_cleanup_redundant_indexes.py`
- 当前 head：`a1b2c3d4e5f6`
- `backend/app/migrations.py` 已移除 `CREATE INDEX IF NOT EXISTS ix_videos_favorite`，否则 backend 每次启动会把刚删掉的索引重新建回来。
- `models.Video.id` 与 `models.SubtitleSegment.id` 去掉了冗余的 `index=True`；主键本身已有唯一索引。
- `models.SubtitleSegment.video_id` 的 `index=True` 保留，对应仍在用的 `ix_subtitle_segments_video_id`。

## 连接池

`docker-compose.yml` 已按角色拆开：

| 进程 | pool_size | max_overflow | 最大连接 |
|---|---:|---:|---:|
| backend | 10 | 10 | 20 |
| worker / worker2（extends worker） | 4 | 4 | 8 |

worker / worker2 当前没有重启，配置在下次重启时生效，避免打断正在跑的转写。

**注意：backend 这次只做了 `docker restart`，没有重建容器，所以运行中的 backend 仍是旧环境变量 `10/20`；`docker-compose.yml` 的 `10/10` 要等下一次 `docker compose up -d` 重建容器才会生效。** backend 没有把代码目录 bind mount 到 `/app`，本轮治理代码是 `docker cp` 进容器层的，直接重建会丢掉这些手工同步文件，因此本轮不为了连接池去重建 backend。

## 验证

```sql
SELECT version_num FROM alembic_version;
-- a1b2c3d4e5f6

SELECT indexname FROM pg_indexes
WHERE tablename IN ('videos','subtitle_segments')
  AND indexname IN ('ix_videos_id','ix_subtitle_segments_id','ix_videos_favorite');
-- 0 rows

SELECT c.relname, i.indisvalid
FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
WHERE c.relname IN ('ix_subtitle_segments_text_trgm','ix_subtitle_segments_video_id');
-- 两个保留索引仍 valid
```

backend 重启后 `Up (healthy)`，`/health` 200。

## 未执行

- 连接池改动未对 worker / worker2 生效（等它们空闲时再重启）。
- 用户画像 `recompute_profile` 的 Redis 5 分钟缓存未做。
- `background_tasks` / `ai_jobs` 保留策略未做。
- 批处理后的 `ANALYZE content_chunks / subtitle_segments / videos` 未在本轮执行；当前 autoanalyze 时间见审计记录，批处理结束后应单独跑一次。
