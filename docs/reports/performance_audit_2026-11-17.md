# P2 性能审计：数据库、缓存与请求链路

日期：2026-11-17  
范围：`backend/app/database.py`、`services/lexical.py`、`services/hybrid_search.py`、`services/vector_store.py`、`services/profile.py`、`routers/videos.py`、`services/background_tasks.py`、`services/admin_ai_queue.py`、Redis / PostgreSQL 运行态。  
性质：只读审计；本轮没有修改代码。测量发生在批量转写 / 向量化期间，绝对耗时受 LM Studio 队列影响，但瓶颈归属和相对差距可用。

## 结论

当前不是“数据库快满了”或“连接池不够”的问题。数据库 2.285 GB，实际连接只有 5 条，`max_connections=120`，连接池不是眼下的瓶颈。

真正值得先动的是检索链路的三个放大点：

1. **查询改写把两字符 `DI` 注入词法检索**，`ILIKE '%di%'` 命中 6,000+ 个块，词法单次从 29ms 变成约 700ms；这是当前最明确的单点慢查询。
2. **词法、元数据、query embedding 串行执行**。实测 `lexical_ms≈640–1,100ms`、`embed_ms≈1,900–5,600ms`、`meta_ms≈70–180ms`，串行把延迟相加。
3. **查询 embedding 与批量向量化共用 LM Studio**，批处理期间 query embedding 被排队，单次 2–5 秒；这部分不是 P2 代码慢，是资源争抢。

数据库侧已经完成的索引收敛有效：数据库索引总量 1,169 MB，堆 686 MB；剩余可做的是任务保留、统计查询合并，以及批处理后的 `ANALYZE`，不是继续盲删大索引。

## 一、实测数据

### 1. 数据库体量与连接

| 项 | 当前值 |
|---|---:|
| 数据库总大小 | 2,285 MB |
| 堆总量 | 686 MB |
| 索引总量 | 1,169 MB |
| `subtitle_segments` | 1,163 MB（堆 503 MB） |
| `content_chunks` | 795 MB（堆 147 MB） |
| `videos` | 168 MB（堆 19 MB） |
| 连接数 / `max_connections` | 5 / 120 |
| `idle in transaction` | 0 |

结论：连接池配置值得按角色收敛，但**现在不需要为了连接池重建 backend 容器**。运行中只有 5 条连接，先按下次计划重建时生效即可。

### 2. 表统计

| 表 | live | dead | seq_scan | idx_scan |
|---|---:|---:|---:|---:|
| `subtitle_segments` | 3,215,025 | 0 | 33 | 5,399,349 |
| `content_chunks` | 63,506 | 778 | 104 | 1,034,158 |
| `videos` | 18,476 | 245 | 1,608 | 242,243 |
| `background_tasks` | 18,244 | 2,558 | 5 | 48,888 |
| `ai_jobs` | 5,745 | 460 | 51,223 | 11,376 |
| `watch_events` | 9,016 | 2 | 322 | 29,246 |

`background_tasks` 的 18,244 行全部是 `done`，没有 failed / queued / running；`ai_jobs` 有 5,134 个 `queued`、607 个 `completed`、2 个 `running`、2 个 `failed`。现在做“保留 7 天”不会立刻删掉多少行，但需要先把策略建起来，否则批量任务会把表继续推大。

### 3. 检索链路

`hybrid_search('FastAPI 依赖注入 怎么实现', top_k=5)` 的分段耗时：

| 阶段 | 第一次（无 rerank） | 第二次（带 rerank） | 三次重复（无 rerank） |
|---|---:|---:|---:|
| lexical | 1,096.7 ms | 659.9 ms | 638–727 ms |
| meta | 182.9 ms | 81.2 ms | 69–175 ms |
| embed | 1,946.9 ms | 2,720.6 ms | 2,099–5,675 ms |
| vector | 70.2 ms | 8.0 ms | 8–20 ms |
| rerank | — | 577.6 ms | — |

单独测 `lexical_search`：

- 原始 query：`28.7 ms`；
- 改写后 query：`695.3 ms`。

改写后的 query 是：

```text
FastAPI 依赖注入 怎么实现 dependency injection DI
```

`query_rewrite.py` 的 `_TERM_MAP` 把“依赖注入”映射成了 `dependency injection DI`。`extract_tokens()` 把 `DI` 当成一个合法技术 token，词法层生成 `ILIKE '%di%'`。这个两字符模式命中了 6,654 个块，执行计划退化为对 `content_chunks` 的扫描 / 逐视频 nested loop。

EXPLAIN 对比：

| 查询条件 | 执行时间 |
|---|---:|
| 含 `%di%`，按 `similarity` 排序 | 1,045 ms |
| 去掉 `%di%`，其余条件不变 | 14.4 ms |

这是当前最值得先修的性能问题，优先级高于继续删索引。

### 4. 画像重算

同一 backend 进程内连续调用 `recompute_profile(db, 1)`：

```text
128.6 ms（冷）
23.7 ms
23.0 ms
19.7 ms
19.2 ms
```

当前只有 5 个用户、9,016 条 `watch_events`，单次重算约 20ms；它还不是主瓶颈。但 `build_system_prompt`、`get_learning_profile`、`get_my_learning_path`、计划生成都可能各调一次，单轮会叠加。缓存仍然值得做，只是排在检索修复之后。

### 5. Redis / 队列

| 项 | 当前值 |
|---|---:|
| `used_memory_human` | 11.50 MB |
| `maxmemory_human` | 256 MB |
| `maxmemory_policy` | `noeviction` |
| `rq:queue:ai_jobs` 长度 | 5,132 |
| `DBSIZE` | 6,387 |

`noeviction` 意味着 Redis 内存满时写入会失败。画像缓存、query embedding 缓存必须是有界、带 TTL 的小对象；不要把检索结果整页塞进这个 Redis。

## 二、P0：现在值得做

### P0-1 词法检索不要吃两字符扩展 token

**证据**：含 `DI` 的改写 query 让词法从 29ms 变成约 700ms；EXPLAIN 从 14.4ms 变成 1,045ms。

**建议改法，按风险从低到高**：

1. 最小改动：从 `query_rewrite._TERM_MAP` 的“依赖注入”映射里去掉 `DI`，保留 `dependency injection`。
2. 更稳的工程改法：`extract_tokens()` 对拉丁 token 设最小长度 3；对 `GO`、`C++`、`C#`、`R` 这类短技术词单独 allowlist，或要求词边界精确匹配，不做 `%xx%` 模糊。
3. 更彻底：把“用于词法的 query”和“用于向量的 query”拆开。`lexical_search` 用原始 query 或仅保留中文/长 token 的版本；`embedding` / `meta` 用扩展后的 query。

**预期收益**：词法阶段从 0.6–1.0s 降到 20–40ms；即使 embedding 仍被批处理拖慢，单次检索也能少 0.6–1s。

**风险边界**：去掉 `DI` 可能损失极少数只写 “DI” 的查询。用 70 条路由评测 + 真实探针验证，不要只看一条 query。

**验证方式**：

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ...
FROM content_chunks s
JOIN videos v ON v.id = s.video_id
WHERE (s.text ILIKE '%fastapi%' OR s.text ILIKE '%dependency%'
       OR s.text ILIKE '%injection%' OR s.text ILIKE '%依赖注入%')
ORDER BY similarity(s.text, '...') DESC, length(s.text) ASC
LIMIT 30;
```

目标是执行计划回到 `Bitmap Index Scan on ix_content_chunks_text_trgm`，而不是 `Seq Scan` / 逐视频 nested loop。

### P0-2 词法、元数据、embedding 并行

当前 `hybrid_search` 的顺序是 lexical → meta → embedding → vector。lexical 和 meta 不依赖 embedding，完全可以同时跑。

建议：

```text
线程池启动 lexical、meta、embedding 三个任务
等待三者完成
用 embedding 结果做 vector search
再进入 RRF / dedupe / rerank
```

**预期收益**：把 `lexical + meta + embed` 的串行和变成 `max(lexical, meta, embed)`；在 embedding 2s、lexical 0.7s 的当前状态下，理论上省 0.7s 左右。

**风险边界**：

- 三个任务都会拿数据库连接；当前连接池压力很低，但要把线程数限制为固定 2–3，不要按请求无限开线程。
- SQLAlchemy `Session` 不能跨线程共享；每个任务用自己的 `engine.connect()` 或短生命周期 session。
- 并行后 LM Studio 的 query embedding 可能和批量向量化抢得更凶；如果 embedding 服务没有请求优先级，收益会被抵消。这个改动应和 P0-3 一起做。

### P0-3 query embedding 缓存，不缓存整页检索结果

query embedding 是确定性的：同一模型、同一维度、同一文本，结果不变。可以安全缓存，不用考虑“新视频进来”导致的失效。

建议：

- 用进程内 LRU + TTL（例如 256 条、1 小时），key 为 `model + dim + normalized_query`；
- 不把 1024 维向量塞 Redis；单条约 4KB，量大了会碰 `noeviction`；
- backend 重启清零，可接受；
- 缓存命中时跳过 LM Studio 请求，但 lexical/meta 仍正常走 DB。

**预期收益**：重复问题、追问、前端重复搜索时，直接省掉 2–5 秒的 embedding 调用。首次查询仍然慢，这是可接受的。

**不要做**：60 秒整页检索结果缓存。向量版本变化、新视频、rerank 非确定性、用户过滤条件都会让失效逻辑变复杂；当前单用户场景收益不如 query embedding 缓存干净。

## 三、P1：数据库和缓存的结构性优化

### P1-1 画像缓存：5 分钟 TTL + 写入失效

现状：`chat_agent.build_system_prompt()` 每轮都 `SessionLocal()` + `recompute_profile`；`services/profile.py` 内部多次聚合并 `commit()`。实测单次 20ms，暂时不慢，但会随 `watch_events` 增长。

建议：

- `profile:{user_id}` 存序列化后的 `profile_to_dict()`，TTL 300 秒；
- `watch_events` 成功写入后 `delete profile:{user_id}`，让下一次聊天重算；
- 手动 `/recompute-profile` 也删缓存；
- 缓存的是 dict，不是 ORM 对象，避免 session 关闭后 lazy load 报错；
- 计划生成、工具调用复用同一个 `get_profile_cached()`，不要各自 `recompute_profile`。

风险：最多 5 分钟滞后；对“学习画像”这种非强一致数据可接受。Redis 当前 `noeviction`，key 很小且带 TTL，风险低，但仍要监控内存。

### P1-2 后台任务保留策略

`background_tasks` 18,244 行全部 `done`，2,558 dead tuple；`ai_jobs` 5,745 行，5,134 个仍在排队。现在不适合清理 queued / running。

建议策略：

| 表 | 规则 |
|---|---|
| `background_tasks` | `done` 超过 7 天删除或归档；`failed` 超过 30 天清理 |
| `ai_jobs` | `completed` / `failed` / `cancelled` 超过 30 天清理；queued / running 永不自动删 |
| 维护 | 每日低峰执行一次，删除后 `VACUUM ANALYZE` 相关表 |

注意：当前 `background_tasks` 最早记录是 2026-11-16，按 7 天规则现在还删不到；先建策略，等数据老化。不要在批量转写 / 向量化高峰做 `VACUUM FULL`。

### P1-3 合并管理面状态 count

代码里能看到两类重复统计：

- `admin_ai_queue.ai_queue_state()` 对 `ai_jobs` 分别 `count()` running / queued / failed / completed；
- `admin_health` 也对 queued / running / failed 各 `count()`，再加 `videos.count()`。

`ai_jobs.seq_scan=51,223` 很可能就是这类轮询统计放大的结果（表只有 5,745 行，单次不贵，但次数多）。建议：

```sql
SELECT status, count(*) FROM ai_jobs GROUP BY status;
```

一次查询拿全部状态；管理面结果再加 2–5 秒短 TTL，避免前端轮询每次都打 DB。

`background_tasks.task_stats()` 目前把 18,244 行 `(status, id)` 全捞进 Python 再计数，改成一条 `GROUP BY status` 即可；这是低风险小改动。

### P1-4 连接池按角色收敛，但不必现在重建

建议值仍然是：

| 进程 | pool_size | max_overflow |
|---|---:|---:|
| backend | 10 | 10 |
| worker / worker2 | 4 | 4 |
| 独立 background-index-worker | 4 | 4 |

理由：不是当前连接不够，而是避免未来四个进程同时打满 120。当前实测 5 条连接，说明还没发生。`docker-compose.yml` 已经改了，但 backend 没有重建容器，运行中仍是旧值；**不要为了这个立刻重建**，等下次计划内重建时一起生效，避免丢失 `docker cp` 的治理代码。

### P1-5 批处理后 ANALYZE

转写 / 向量化是大批量写入，autovacuum / autoanalyze 会滞后。批处理结束后执行：

```sql
ANALYZE content_chunks;
ANALYZE subtitle_segments;
ANALYZE videos;
```

成本很低，主要让过滤 + join 的计划稳定。不要在批处理正在写入时反复执行；选一个批次结束点。

## 四、P2 / 先不做

### 1. 不删 `ix_subtitle_segments_text_trgm`

它 306 MB，idx_scan 只有 4，但 `/segments/search` 在 hybrid search 抛异常后仍用 `SubtitleSegment.text.contains` 兜底；删掉会让 321 万行字幕在降级时顺序扫描。**除非先移除这个兜底接口，否则保留是合理的风险对冲。**

### 2. 不删 `ix_subtitle_segments_video_id`

49 MB，idx_scan 5,389,739，是热索引。复合索引 `(video_id, segment_index)` 理论上前缀可覆盖，但“理论覆盖”不等于优化器一定选它；当前扫描量说明它仍在被使用。删之前至少要有 `EXPLAIN` 证据和回滚预案。

### 3. 不做 `subtitle_segments` 分区

321 万行、1.16 GB，规模还不到必须分区的程度；分区会增加维护和查询复杂度。到几千万行再评估。

### 4. 不做整页检索结果 60 秒缓存

理由同上：失效维度多，收益不如 query embedding 缓存干净。单用户本地场景，HNSW 检索本身 8–70ms，不是瓶颈。

### 5. `pg_stat_statements` 可选

当前没有安装，无法按 SQL 聚合总耗时。开启需要 `shared_preload_libraries` + PostgreSQL 重启，属于维护窗口动作。不是本轮必须；如果后面还要继续抓慢查询，值得加。

## 五、建议实施顺序

| 顺序 | 改动 | 预期收益 | 风险 |
|---|---|---|---|
| 1 | 去掉/过滤词法层两字符扩展 token | 词法 0.6–1.0s → 20–40ms | 低；用 70 条评测验证 |
| 2 | query embedding 进程内 LRU | 命中时省 2–5s | 低；模型/维度变更要清缓存 |
| 3 | lexical/meta/embedding 并行 | 再省约 0.7s | 中；线程与 DB session 边界 |
| 4 | 画像 5 分钟缓存 + watch_events 失效 | 每轮省 20–60ms，随数据增长更明显 | 低；最多 5 分钟滞后 |
| 5 | 管理面 count 合并 + 短 TTL | 降低 `ai_jobs` 轮询扫描 | 低 |
| 6 | 保留策略 + 批处理后 ANALYZE | 控制表膨胀、稳定计划 | 低；避开批处理高峰 |
| 7 | `/segments/search` 关闭 rerank 或改本地 reranker | 省约 0.58s | 中；搜索排序质量会变，需评测 |

## 六、风险边界

- 不要为了连接池 / 索引重建 backend 容器；当前 backend 没有 bind mount，重建会丢 `docker cp` 的治理代码。
- 不要在 worker 正在转写时重启 worker；当前 `rq:queue:ai_jobs=5,132`，重启会打断正在执行的任务。
- 不要把检索结果、整页 JSON 或大对象塞进 `noeviction` Redis；队列写入失败会比缓存 miss 更严重。
- 不要在没有 `EXPLAIN` 和回滚迁移的情况下删 `ix_subtitle_segments_video_id` / `ix_subtitle_segments_text_trgm`。
- 不要在批处理高峰做 `VACUUM FULL`；它是强锁操作，会拖住写入和 API。
- 本次实测的 embedding 2–5 秒包含批量向量化争抢；不要把这段绝对耗时当成稳态 SLA，修复 query 形状后再复测一次。

## 七、实施记录（2026-11-17 20:40）

已落地 P0-1、P0-2、P0-3、P1 画像缓存、P1 管理面统计合并和保留维护脚本；连接池配置仍未在运行容器生效。

| 项目 | 改动 | 实测 |
|---|---|---|
| 词法 token | `extract_tokens` 默认 `min_latin_len=3`；`retrieval_meta` 显式保留 2 字符 | 原始 query 42.2ms，改写后 16.6ms（改前约 695ms） |
| 检索并行 | lexical / meta / query embedding 同池并行 | 冷请求 494.1ms（lex 34.5 / meta 190.4 / embed 401.4 / vector 58.5） |
| query embedding 缓存 | 进程内 LRU 256 条、TTL 1 小时 | 第二次 107.2ms，embed 0.0ms，`embed_cache=hit` |
| 画像缓存 | Redis `profile:v1:{user_id}`，TTL 300s；非心跳观看事件、进度新建/完成状态变化时失效 | 冷 100.7ms，热 0.6ms，Redis TTL 298s |
| 管理面统计 | `ai_jobs` 状态一次 GROUP BY；`task_stats` SQL 聚合 | `ai_queue_state` 31.2ms，`task_stats` 13.8ms |
| 保留维护 | `backend/scripts/maintenance.py` 默认 dry-run，`--apply` 才删除，`--analyze` 单独执行 | dry-run 当前可清理 0 行 |

补充：带 rerank 的一次冷请求 1,131.4ms（embed 593.8ms、rerank 492.0ms），说明并行化没有牺牲重排链路；热 embedding 缓存下重排仍是主要成本。

验证：backend `unittest=8 failures=0 errors=0 bare=32/32`；70 条工具路由评测 `cases=70 probes=0 failures=0`；backend `/health` 200、容器 `healthy`；带 rerank 冷请求已补测。本轮未重启 worker，未重删索引，未跑前端构建。

