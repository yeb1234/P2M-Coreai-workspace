# PR-003 存储治理：统计信息与内存上限

- **分支**：`fix/storage-governance`
- **合并提交**：`157a42c`
- **影响面**：数据库查询计划、Redis 稳定性
- **风险等级**：低（只改参数，不改逻辑）

---

## 为什么

起因是回答一个问题：「PG + pgvector + Redis 三个够不够，清爽整洁吗」。

盘点的时候顺手查了两个指标，发现都不是「够不够」的问题，是**已经在漏的地方**。

---

## 发现问题 1：359 万行的表从未被分析

```
 subtitle_segments | 统计行数 0 | 最近分析: (NULL)
 notes             | 统计行数 0 | 最近分析: (NULL)
```

`pg_stat_user_tables.n_live_tup` 显示 **0**，但实际有 357 万行。

PostgreSQL 的规划器依赖统计信息估算行数。它以为这是张空表，
就会选错连接方式 —— 在本该用 Hash Join 的地方选 NestLoop，
在百万行表上代价可能是几十倍。

**为什么 autovacuum 没管**：默认阈值是 `0.1 × 行数`。
批量导入 359 万行之后，还要再变 36 万次才会触发一次 analyze。
一次性 COPY 导入的话，实际上永远不会发生。

## 发现问题 2：Redis 没有内存上限

```
used_memory_human: 1.49M
maxmemory_human:   0B          ← 0 = 不限制
```

现在只占 1.5MB，看起来无事。但 RQ 队列一旦堆起来
（批量转写 1 万个视频），会把宿主机内存吃光，然后 OOM Killer 随机杀进程 ——
大概率杀掉 PostgreSQL。

---

## 改了什么

**`app/migrations.py`**：给三张大表设更积极的 autovacuum 参数

```python
("subtitle_segments", 0.02),
("segment_embeddings", 0.02),
("videos", 0.05),
```

0.02 意味着 359 万行的表在变 7 万次后就会重新分析一次，比默认积极 5 倍。
同时 `autovacuum_analyze_threshold = 1000`，小表也能及时分析。

**`docker-compose.yml`**：Redis 加内存上限

```yaml
- --maxmemory
- "256mb"
- --maxmemory-policy
- noeviction
```

**特意不用 LRU 淘汰**：队列里的任务被悄悄丢掉，比写入失败更糟。
宁可 `enqueue` 报错让人知道，也不要「任务提交成功但永远不执行」。

---

## 怎么验证

```bash
# 统计信息修好
docker exec siteyeb-pg psql -U p2user -d p2learning -c "
SELECT relname, n_live_tup FROM pg_stat_user_tables
WHERE relname='subtitle_segments';"
# 期望：3577042

# 查询计划走索引，不是全表扫
docker exec siteyeb-pg psql -U p2user -d p2learning -c "
EXPLAIN (COSTS OFF) SELECT id FROM subtitle_segments
WHERE text ILIKE '%事件循环%' LIMIT 10;"
# 期望：Bitmap Index Scan on ix_subtitle_segments_text_trgm

# Redis 配置
docker exec siteyeb-redis redis-cli CONFIG GET maxmemory maxmemory-policy
# 期望：268435456 / noeviction
```

修复前后检索延迟（同一批查询）：

| 查询 | 修复前 | 修复后 |
|---|---|---|
| 事件循环 | 47ms | 41ms |
| 闭包 | — | 41ms |
| 长句（11 字） | 350ms | 350ms |

短查询有小幅改善。长句的瓶颈在多个术语 `ILIKE` 扫 359 万行，不是统计信息 ——
**不要指望修了统计就解决所有慢查询，要知道瓶颈在哪。**

---

## 风险与回滚

`ALTER TABLE ... SET (autovacuum_*)` 只改 `pg_class.reloptions`，不重写表，秒级完成。

回滚：`ALTER TABLE ... RESET (autovacuum_analyze_scale_factor, ...)`，或者直接 revert 这个 commit。

---

## 复盘

### 1. 盘点资产的时候，顺手查「健康度」

这次不是计划内的修复，是回答「够不够」的时候顺手查了两个指标。

一个可复用的动作：**每次盘点基础设施，同时查三类指标** ——
- 统计信息是否新鲜（`last_analyze`）
- 索引是否被真正使用（`pg_stat_user_indexes.idx_scan`）
- 容量是否接近上限（`maxmemory`、磁盘使用率）

这三类平时不看，出事时都是「原来早就有征兆」。

### 2. 默认值是为「平均负载」设计的，不是为你的负载

- autovacuum 默认阈值适合持续小批量写入，不适合一次性导入几百万行
- Redis 默认 `maxmemory 0` 适合专用缓存实例，不适合和业务共存的队列

**用之前先问：「默认值假设的使用模式，和我的实际情况一样吗？」**

不一样就要显式覆盖，并且把覆盖的理由写进代码注释 ——
否则下一个人（或者半年后的自己）会以为是随便调的。

### 3. 「现在没问题」不等于「不会有问题」

Redis 只占 1.5MB，从数据上看完全健康。
但缺上限意味着**没有边界**，而边界只有在被突破时才有意义。

判断标准不是「当前占用多少」，是「最坏情况会涨到多少」。
批量转写 1 万个视频的队列，和现在 5 个键的空队列，是两个系统。
