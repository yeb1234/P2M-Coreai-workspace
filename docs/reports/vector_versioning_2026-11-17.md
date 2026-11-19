# 向量版本化（1.X.X 三段式）

日期：2026-11-17  
当前生产版本：`1.1.0`  
当前存量基线：`1.0.0`  
当前 `content_chunks`：61,715 块；其中 61,713 块 `1.0.0`，2 块 `1.1.0`（抽样验证视频 36077）

## 1. 版本定义规则

版本号统一为 `<major>.<minor>.<patch>`，测试候选在末尾加小写 `b`/`c`：

| 变化类型 | 版本动作 | 示例 |
| --- | --- | --- |
| 同一套向量架构，改 chunk 参数（目标长度、最大长度、重叠等） | 升 patch | `1.1.0` → `1.1.1` |
| 同一套架构，改清洗/分块/是否拼上下文等会改变文本的处理 | 升 minor | `1.0.0` → `1.1.0` |
| 换 embedding 模型、向量维度、存储类型、完全不同的分块/检索架构 | 升 major | `1.1.x` → `2.0.0` |
| `2.x` 内只改参数 | 升 patch | `2.0.0` → `2.0.1` |
| 还在对比验证的候选 | 加 `b`/`c` 后缀，不设 production | `1.1.1b`、`1.1.1c` |

**major 是方法变化，不是“大改参数”**。换 `bge-m3` → `Qwen3-Embedding`、1024 → 2048 维、`halfvec` → 其他存储、或从“chunk 向量”改成“段向量 + 文档向量”这类不同架构，才进入 `2.x`。  
**batch size、并发数、扫描间隔、GPU 设备** 不影响向量结果，不单独升版本；它们只记在运行配置里。

## 2. 已落地的版本清单

| 版本 | 状态 | 模型/维度/存储 | 分块 | 清洗 |
| --- | --- | --- | --- | --- |
| `1.0.0` | legacy | `bge-m3` / 1024 / `halfvec` | `chunk-v1`（400/600/60） | 旧管线，无 `vector_safe` |
| `1.1.0` | production | `bge-m3` / 1024 / `halfvec` | `chunk-v1`（400/600/60） | `light-v1` 的 `vector_safe` |

`1.1.0` 的完整定义：

```text
1.1.0 | model=bge-m3 dim=1024 storage=halfvec chunker=chunk-v1 cleaning=light-v1/vector_safe
```

版本契约在 `backend/app/services/vector_version.py`：

- `VECTOR_VERSION`：当前生产默认版本；
- `VECTOR_VERSION_LEGACY`：`1.0.0`；
- `VERSION_PATTERN`：三段式 + 可选 `b/c`；
- `VECTOR_VERSION_MANIFEST`：每个版本对应的模型、维度、存储、chunker、chunk 参数、清洗方式；
- 导入时自检：默认版本必须已登记，且 `status="production"`。

## 3. 数据库与管线行为

### 表结构

```sql
ALTER TABLE content_chunks
  ADD COLUMN IF NOT EXISTS vector_version TEXT NOT NULL DEFAULT '1.0.0';

CREATE INDEX IF NOT EXISTS ix_content_chunks_vector_version
  ON content_chunks (vector_version);
```

存量行统一是 `1.0.0`。新写入的块显式写 `VECTOR_VERSION`，不依赖数据库默认值，避免旧进程把新块标成 legacy。

### 写入与检测

- `_build_chunks()`：用 `clean_segments(..., mode="vector_safe")` 建块，插入 `vector_version=VECTOR_VERSION`。
- `_embed_pending()`：补向量时同时写 `vector_version`。
- `_chunk_state()`：返回块数、缺向量数、最早块时间、**非当前版本块数**。
- `index_video()`：版本不一致时重建；同一视频只重建自己，不做全库扫描重建。
- `scan_missing()`：只统计 `version_stale_chunks`，**不按版本自动入队**。这是为了避免普通巡检把 6 万旧块全部塞进重建队列。
- `status()`：返回当前版本、当前版本块数、旧版本块数、当前版本缺向量块数、`version_coverage`。
- `scripts/build_content_chunks.py`：手工建块脚本也走 `vector_safe`，并显式写版本，避免绕开清洗。

### 不触发全量重嵌

版本字段只提供可观测性和显式迁移入口：

- 新视频/重新转写的视频自然生成 `1.1.0`；
- 存量 `1.0.0` 不自动迁移；
- 需要迁移时按视频显式调用 `index_video(video_id, force=True)` 或运行受控脚本；
- 不会因为改了 `VECTOR_VERSION` 就把 61,715 块全部重嵌。

## 4. 可回滚机制

版本切换前，`_build_chunks()` 会把**非当前版本**的旧块写入 `content_chunks_history`，再删除旧块。归档表包含原块文本、旧向量、旧版本号和 `archived_at` 批次时间；不参与检索，不建 HNSW 索引。

回滚脚本：

```bash
# 只预览，不写库
python scripts/vector_version_rollback.py --version 1.0.0 --videos 36077

# 确认后真正恢复
python scripts/vector_version_rollback.py --version 1.0.0 --videos 36077 --apply
```

边界：

- 只有**在归档机制生效后**被新版本替换的视频才有历史快照；
- 当前 61,713 个 `1.0.0` 旧块仍在 `content_chunks` 中，尚未被替换，因此它们本身就是可用的 legacy 数据；
- 回滚只恢复旧块和旧向量，不重新转写、不重新 embedding；
- 回滚后 `videos.chunk_indexed_at` 会更新，但后续重新索引仍会按当前版本重建；如果只想停留在旧版本，需要同时把 `VECTOR_VERSION` 回退到对应正式版本，并重新部署代码。

## 5. 运维命令

```bash
# 查看当前版本、版本分布、缺向量
docker exec -e PYTHONPATH=/app p2-siteyeb-backend-1 \
  python /app/scripts/vector_version_report.py

# JSON 输出
docker exec -e PYTHONPATH=/app p2-siteyeb-backend-1 \
  python /app/scripts/vector_version_report.py --json

# 单视频显式重建（会走版本检测；版本不一致会归档旧块）
docker exec -e PYTHONPATH=/app p2-siteyeb-backend-1 \
  python -c "from app.services.embedding_pipeline import index_video; print(index_video(36077, force=True))"
```

## 6. 当前部署与验证

- `vector_version.py`、`embedding_pipeline.py`、`tables.py`、`migrations.py`、`build_content_chunks.py` 已同步到 `p2-siteyeb-backend-1`、`p2-siteyeb-worker-1`、`p2-siteyeb-worker2-1`；
- worker 已重启加载新代码；当前 201 个首批重转写任务会被重启逻辑重新排队/继续；
- `vector_runner` 已用 `bge-m3` 重新启动，使用新版管线；
- 抽样视频 `36077` 已从 `1.0.0` 重建为 `1.1.0`，旧块已归档到 `content_chunks_history`；回滚测试后又重建了一次，当前历史表有 4 条快照记录；
- 当前分布：`1.0.0` 61,713 块、`1.1.0` 2 块、缺向量 0；
- 回滚 dry-run 已验证能识别 `36077` 的 `1.0.0` 历史快照。

## 7. 版本发布流程

1. 新方法先登记候选版本，例如 `1.1.1b`，`status="candidate"`；不要写成 production。
2. 用少量视频跑对比，记录 `version`、块数、检索样本、延迟、召回差异。
3. 验证通过后去掉 `b/c`，改为正式 `1.1.1`，`status="production"`，更新 `VECTOR_VERSION`。
4. 只有明确决定迁移存量时，才按视频/按批次显式重建；默认不触发全量重嵌。
5. 每次升版本同步更新 `VECTOR_VERSION_MANIFEST` 与本文件。
