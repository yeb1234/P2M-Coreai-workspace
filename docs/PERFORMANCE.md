# PERFORMANCE

> 状态：现行（最后校对 2026-11-16）；性能测量基于 2026-11-16 的 `content_chunks` 60,259 块、`subtitle_segments` 3,593,723 条基线。2026-11-20 当前库为 98,271 块、5,667,374 条，旧测量未重跑，延迟与比例结论仅作参考。

> **用途**：记录有量化结果或结构性收益的性能改动，以及这个项目值得长期盯的指标。
>
> **维护约定**：做完性能优化当天追加一条，必须写「改了什么 / 优化前 / 优化后 / 依据」。
> 没有具体测量值就写结构性描述（「消除了全表扫描」「少一次网络往返」），
> **不要编造毫秒数**。测试方法本身有问题时也要写下来 —— 假数据比没数据更危险。
> 功能变化记 `CHANGELOG.md`，缺陷修复记 `BUGFIXES.md`。

---

## 一、优化记录（时间倒序）

### 2026-11-16

#### 检索质量：新增视频级元数据通道（用 100~200ms 换准确率）

- **改了什么**：新增 `app/services/retrieval_meta.py` 与 `lexical.meta_search`，
  让路径 / 课程名 / 章 / 课时参与召回，与词法、向量三路一起进 RRF；
  重排时把路径线索拼在正文前，作为 cross-encoder 的判断依据。
  路径只作**视频级先验**，每个视频最多贡献一条候选，不挤占内容召回名额。
- **优化前**：向量只对 `content_chunks.text` 编码、词法只 `ILIKE` 字幕正文，
  路径与标题完全没进检索。两个实测失效样例：
  - 「黑马前端 jQuery 第五章」top-5 全是黑马 8.0 的 ajax 登录页，
    库内 117 个 jQuery 视频一条没召回；
  - 「什么是 GC 算法」top-5 全是 AIGC 噪声，真正的《3、什么是GC算法》没出现
    （ASR 把 GC 听成 JC，正文写的是「什么是JC算法」，只匹配正文必然漏）。
- **优化后**：三个典型查询 top-1 全部修正 ——
  jQuery 第五章 →《05-Jquery对象》；jQuery 动画 →《02-获取位置》rerank 0.987；
  GC 算法 →《3、什么是GC算法》rerank 0.821。**零重建索引**，复用已有语义块向量。
- **成本**：每次检索 +100~200ms。
  - 测量条件：全库 14,327 个视频 / 60,259 个语义块 / 8,785 个已索引视频（截至 2026-11-16），
    单机 `p2-siteyeb-postgres-1` + 本机 LM Studio 的 bge-m3，串行执行，未做并发压测。
  - 其中 df（文档频率）统计在词已缓存时消失：进程内缓存、写入后 10 分钟过期、
    上限 512 条；命中缓存时该次 77~90ms（df 部分为 0），
    进程重启或缓存过期后首次遇到该词 +70~95ms/批（该次合计 170~300ms）。
- **不要这么做**：把路径拼进每个块的向量。实测同一视频 45 个块，
  块间两两余弦均值从 0.612 涨到 0.778（+27%），视频越长段内区分度被稀释得越厉害。
  路径是视频级信号，只能当先验，不能当块特征。
- **回退**：`RETRIEVAL_META_ENABLED=0` 可完全回到原行为（进程启动时读取，
  需重启 backend/worker），已实测逐条结果一致。
- **依据**：`b519494`；设计稿 `docs/retrieval-metadata-design.md`。
- **边界**：接口已返回 `meta`（课程 / 章 / 第 N 节 / 上下节），
  但前端与对话引用卡片尚未消费 —— 用户界面还看不到这些线索。
  注：对话引用卡片 2026-11-16 起由 `FEATURES.chatVideoReferences` 开关关闭（默认 `false`），
  代码保留、后端仍生成 references；改回 `true` 重建前端即恢复。

#### 口语化查询改写（规则层）

- **改了什么**：新增 `app/services/query_rewrite.py`，三路召回前先剥掉口语前缀、
  意图词（「帮我找一下」「我想学」），并做术语中英扩展（GC ↔ 垃圾回收、
  DOM ↔ 文档对象模型）。只删不改写，可关。
- **优化前**：「前端那个做网页交互的东西」top-3 是
  《5_深度搜索_主智能体》/《AG大模型全栈实践班》/《03-什么是DOM》。
- **优化后**：top-3 变成《14、事件模型2》/《15、事件模型3》/《05-DOMContentLoaded》。
- **为什么不用 LLM 改写**：检索在主链路上，调一次 LLM 要 1~2 秒；
  规则层是纯字符串处理（<1ms）。LLM 改写留到有缓存和异步再说。
- **依据**：`b519494`。

#### 前端首屏传输量 1166KB → 12KB

- **改了什么**：`sounds.ts` 的 `preloadAll()` 原来会把 15 个环境音全部预加载，
  改为只预加载当前选中的那一个，其余等用户真的切换时再加载。
  同时把 `vite.config.ts` 的 `emptyOutDir` 从 `false` 改为 `true`。
- **优化前**：64 个请求 / 1166KB，其中 audio 15 个 / 1147KB（占 98%），
  `dist/assets` 累积 839 个历史构建文件（同一个页面有 44 个 hash 版本）。
- **优化后**：38 个请求 / 12KB，音频请求 0；`dist/assets` 46 个文件 / 1.3MB。
- **依据**：`ff9f4a5`；测量脚本 `scripts/perf-check.cjs`（Playwright，读
  `performance.getEntriesByType('resource')` 的 `transferSize`）。
- **教训**：第一次测「登录 + 进工作台」得到 5549ms，差点当成性能问题，
  实际是脚本里写死 `waitForTimeout(5500)`；改成 `waitForFunction` 等真实信号后是 340ms。

#### 重排器从 LLM listwise 换成语义 cross-encoder

- **改了什么**：把「20 个候选拼进 prompt 让 LLM 排序」换成
  `BAAI/bge-reranker-v2-m3`（硅基流动），LLM listwise 保留为 API 失败时的降级路径。
- **优化前**：5000ms，概率性输出，分数只能排序不能当阈值。
- **优化后**：484ms；确定性输出；相关 0.99 / 无关 0.00002，分数差距足够卡阈值。
- **依据**：`f7ae429`。

#### 缩略图吞吐 40 张/分钟 → 269 张/分钟

- **改了什么**：扫描器原来是固定「每 5 分钟扫一次、每次 200 个」，
  改成自适应 —— 这轮扫满了就 10 秒后接着投，排空了才回 5 分钟；
  给在途队列加 `MAX_INFLIGHT=400` 上限，防止投递快于处理导致内存膨胀。
- **优化前**：40 张/分钟（4 个线程实际能吃 120–800 张/分钟，瓶颈在扫描器不给活干），
  22,175 个缺缩略图的视频要跑约 9 小时。
- **优化后**：269 张/分钟（6.7 倍）。
- **依据**：`c16231b`；同时修掉「失败无限重试」——损坏文件每轮重试一次。
- **教训**：第一次改错，判据用「这一轮投递数量 >= 200」，但投递数会被并发上限截断，
  池子满时恒为 0，结果「一分钟 0 张」。改成看「这轮 SQL 是否扫满」（`_last_scan_full`）。

#### 画像聚合下推 SQL，LLM 压缩移出事务

- **改了什么**：`recompute_profile` 原来 `db.query(WatchEvent).filter(...).all()`
  把全部事件捞进 Python 再 sum/groupby；改成 8 条带 `GROUP BY` / `DISTINCT` 的聚合查询。
  `_hour_histogram` 改 `GROUP BY EXTRACT(hour)`。`maybe_compress` 的 LLM 调用
  （timeout 20s）从事务里移出。
- **优化前**：心跳 30 秒一条，重度用户一年几十万行全表读入内存；
  该函数在每次聊天、每次路径规划、每个 agent 工具调用里都会跑。
  压缩时 20 秒的连接一直 idle in transaction，持有快照、挡 vacuum、DDL 排队。
- **优化后**：数据量不再随用户历史线性增长；长事务窗口消失。
- **依据**：`e8e447c`。改后用线上库核对 6 个指标，除 `notes_count`
  （8770 → 0，是修掉口径错误的结果）外全部一致。

#### 删除碎片向量表（3.5GB）

- **改了什么**：删 `segment_embeddings`（716,107 行 / 3.5GB）、碎片向量回填脚本、
  碎片检索路径、`retrieval_source` 开关和 `/api/search/stats` 端点。
- **优化前**：库总大小约 6GB，且两条检索路径调参方向相反（块模式关相似度、阈值 0.04；
  碎片模式保留相似度、阈值 0.12），线上行为取决于一个配置项。
- **优化后**：库 2.49GB；代码净减约 420 行。
- **依据**：`ceb83ee`。删表前后同一组 4 个查询的命中 id 与分数完全一致 —— 证明删的是冗余。

#### 建块向量化接入流水线（消除人工回填）

- **改了什么**：转写完成后自动触发建块 + 向量化，worker 启动与自适应扫描（10s/5min）兜底，
  用「`chunk_indexed_at` + 块时间 vs 字幕时间」两层判断做续跑。
- **优化前**：没有任何代码在转写完成后建块，新转写的视频在检索里搜不到，
  日志里什么都没有；存量靠人工跑脚本。
- **优化后**：新内容自动进入索引，进程被杀后可续跑，不会重复计算或冲掉已算好的向量。
- **依据**：`6ad7750`。

#### 前端切 TAB 不再重建页面

- **改了什么**：`<Routes>` 换成 keep-alive：只挂载访问过的页面，切走时 `display:none`，
  每个页面记住并恢复滚动位置。
- **优化前**：每次切 TAB 组件卸载重挂，滚动位置归零、展开面板收起、输入清空，
  并触发一轮数据拉取。
- **优化后**：切回不重建、不重复请求；页面内的计时器与轮询也能跨页面继续跑。
- **依据**：`0d0332f`（未做请求数对比，属于结构性收益）。

### 2026-11-15

#### SQLite → PostgreSQL + pgvector（HNSW）

- **改了什么**：换 PG 17 + pgvector 0.8.7；HNSW（halfvec, m=16）取代暴力 KNN；
  `pg_trgm` GIN 取代 FTS5；向量写入改 `COPY` 批量。
- **优化前**：SQLite 库 15GB，其中 14GB 是 319 万条无效向量（查询模型与建库模型不同，
  距离恒为 1.35），vec0 无 ANN 索引，KNN 全表扫描 26 秒；FTS5 的 unicode61
  分词对中文完全失效，三个中文查询全部零命中。
- **优化后**：KNN 6–25ms；中文模糊检索 3–32ms；库 15GB → 1.77GB；
  语义检索分数 0.35 → 0.55–0.83。
- **依据**：`2ce0523`。

#### 检索单元从 9 字碎片改成语义块（约 565 字）

- **改了什么**：359 万条字幕按句末标点切成 60,257 块（目标 400 字、上限 600、重叠 60）。
- **优化前**：平均 9 字的字幕片段，65.3% 少于 10 字；
  向量编码由字面重叠决定，RRF 在噪声上融合，rerank 面对 180 字截断的碎片无法判断相关性。
- **优化后**：压缩比 59.6:1；向量回填量从 186 万降到 6 万，耗时从约 6 小时降到约 12 分钟
  （结构性收益：需要计算的单元少了 30 倍）。
- **依据**：`8d86e49`、`670e5e2`。

#### 块模式词法查询：相似度匹配 → 关键词 ILIKE

- **改了什么**：块模式放弃 `text % query`（trgm 相似度），改成抽中文关键词走 `ILIKE`。
  必须用 `ILIKE` 而不是 `lower(text) LIKE`，否则 `gin_trgm_ops` 索引失效。
- **优化前**：为召回把阈值压到 0.04，GIN 返回几万行候选，单次查询 1.2 秒
  （单独 EXPLAIN 只要 8ms，慢在候选爆炸）。
- **优化后**：FastAPI 那条从 741ms 降到 16ms；整体词法 0–740ms。
- **依据**：`65ce544`。

#### 词法长句短路 + embedding 预热

- **改了什么**：查询超过 8 字且含技术术语时跳过整句 trgm 相似度，只走 `ILIKE`；
  启动时后台预热 bge-m3（LM Studio 首次加载约 2 秒）。
- **优化前**：「RRF 融合重排怎么做」1136ms、「Promise 链式调用」1202ms；
  第一个查询凭空慢 2 秒。
- **优化后**：171ms / 157ms；首查不再多 2 秒。
- **依据**：`aee1ef3`。这类长句的整句 trgm 命中本来就不进前列，属于纯浪费。

#### 播放埋点批量写入 + 统计聚合下推

- **改了什么**：前端 15 秒心跳改为批量上报，后端一次事务写入；
  `get_recent_activity` 从「取最近 200 条明细再求和」改成 SQL 聚合。
- **优化前**：逐条 POST 会让 2 小时视频产生 480 次请求和 480 次 commit；
  「近 7 天」实际只覆盖不到一天，报出 44 分钟（真实 338 分钟）。
- **优化后**：一次请求写一批；统计口径正确且不随明细条数失真。
- **依据**：`f74587e`。

#### 大表统计信息与 Redis 内存上限

- **改了什么**：给 `subtitle_segments`（359 万行）等三张大表设更积极的 autovacuum
  参数（`analyze_scale_factor=0.02`、`threshold=1000`）并立即 ANALYZE；
  Redis 设 `maxmemory 256mb` + `noeviction`。
- **优化前**：`last_analyze` 为 NULL、`n_live_tup` 显示 0，规划器以为表是空的；
  Redis 无上限，RQ 堆任务时会吃光宿主机内存。
- **优化后**：中文模糊检索走 `Bitmap Index Scan on ix_subtitle_segments_text_trgm`；
  ANALYZE 359 万行仅 274ms，成本可忽略。
- **依据**：`157a42c`。不用 LRU 淘汰是刻意的：队列任务被悄悄丢掉比写入失败更糟。

#### 转写真正跑上 GPU

- **改了什么**：compose 透传 `WHISPER_*` / `DEVICE_TYPE`，挂载模型缓存；
  Dockerfile 在 CUDA 模式下把 nvidia 的 `lib` 目录写入 `ld.so.conf.d` 并 ldconfig；
  模型改走 ModelScope 镜像。
- **优化前**：实际一直跑 faster-whisper + small + int8 + CPU（配置里写的 large-v3
  从来没进过容器）。
- **优化后**：同一段 50 秒中英混合音频，large-v3 + CUDA 6.34s（7.9x 实时）；
  whisper.cpp + Vulkan 13.4s（3.7x 实时）。第二次 6.34s ≈ 首次 6.71s，确认模型缓存常驻。
- **依据**：`b0ded7e`。

#### 缩略图补齐改线程池

- **改了什么**：新增 `thumbnail_worker.py`：固定 4 线程 `ThreadPoolExecutor`
  + `_inflight` 去重 + 每 5 分钟自动扫描，替换「每 20 秒生成 1 个」的后台循环
  和「每次请求起一个 daemon 线程」的 rescan。
- **优化前**：一小时最多 180 张，两万多条视频要跑 160 小时；
  两个 rescan 请求并发时同一 video_id 被两个线程同时写文件 + commit（竞态）。
- **优化后**：4 个 ffmpeg 真并行（subprocess 等待时释放 GIL），自动补齐无需人工 rescan。
- **依据**：`be7b6b9`；吞吐的进一步优化见 `c16231b`（40 → 269 张/分钟）。

#### 去重脚本的 14327 次全表自连接

- **改了什么**：`watch_history` 去重 SQL 原来在组循环里，14327 组 = 14327 次全表自连接；
  移到循环外只跑一次。
- **依据**：`1283035`（未记录耗时，属于结构性收益）。

## 二、关键指标与观测方法

只列项目里真实存在的入口。所有命令默认在项目根目录执行。

### 1. 服务可用性与事务健康

- **入口**：`GET /health`、`GET /ready`
- **看什么**：
  - `/health` 的 `transactions` 段：`level`、`idle_in_transaction`、
    `longest_idle_tx_sec`、`blocked_queries`、`longest_blocked_sec`、`warnings`。
    判定阈值在 `backend/app/database.py`：长事务 ≥ 60s 或等锁 ≥ 30s 记 `warn`。
  - `/ready` 的 `checks`：`database`、`vectors`（`chunks` / `embedded` / `coverage`）、
    `embedding_model`、`llm`、`transactions`；返回 503 表示检索链路不齐。
- **为什么单独盯事务**：长事务不报错、不超时、不打日志，只会让 `ALTER TABLE` /
  `CREATE INDEX` 无声排队 —— 曾经把迁移卡了 12 分 30 秒，整站 502。
- **容器 unhealthy 时**：`docker inspect -f '{{range .State.Health.Log}}...' p2-siteyeb-backend-1`
  能看到探针最后一次输出（应用日志可能一个字都没有）。容器名由 compose 生成，
  可用 `docker compose ps` 核对实际名字。
- **一键诊断**：`bash scripts/diagnose.sh`（只读）。四段：容器状态、探针最后输出、
  PG 长事务/锁等待、Redis worker 注册。

### 2. 向量覆盖率与索引进度

- **入口**：`GET /api/admin/embeddings/status`
- **看什么**：`videos_with_subtitles`、`videos_indexed`、`videos_pending`、
  `chunks`、`chunks_missing_vectors`、`vector_coverage`。
- **正常值**：`videos_pending` 应长期为 0（worker 每 5 分钟自动扫）；
  `vector_coverage` 接近 1.0。
- **手动兜底**：`POST /api/admin/embeddings/scan`、`POST /api/admin/embeddings/reindex/{video_id}`。
- **相关任务**：`GET /api/admin/background-tasks/stats` 返回
  `{queued, running, done, failed}`；重启后看 queued + running 判断有没有任务被漏掉。

### 3. 转写吞吐与任务失败率

- **入口**：`GET /api/ai-jobs`（管理员）、`GET /api/admin/ai-jobs/queue`；
  前端 AI 任务中心显示的倍速（Nx）。
- **表字段**：`ai_jobs.status`（queued / running / cancelling / completed / failed / cancelled）、
  `created_at`、`started_at`、`updated_at`（没有单独的 finished_at，终态时间用 `updated_at`）。
- **每日成功/失败比**：

```sql
SELECT date_trunc('day', created_at) AS day,
       count(*) FILTER (WHERE status = 'completed') AS completed,
       count(*) FILTER (WHERE status = 'failed')    AS failed,
       count(*) FILTER (WHERE status = 'cancelled') AS cancelled
FROM ai_jobs
WHERE created_at > now() - interval '7 days'
GROUP BY 1 ORDER BY 1 DESC;
```

- **转写速率**：`(updated_at - started_at)` 为单任务耗时，配合 `videos.duration`
  可算实时倍率；同一模型下倍率明显下降，先查是不是退回了 CPU
  （`ai_jobs.whisper_model` / `device_type` / `compute_type` 三个字段可核对）。
- **典型异常**：`status=queued` 但 Redis 里没有活跃 job（worker 被重启时会这样）。
  `/api/ai-jobs` 轮询会触发 `reconcile_stuck_ai_jobs` 自愈；
  也可手动 `POST /api/admin/ai-jobs/recover-stuck`。

### 4. 检索延迟与检索质量

- **延迟**：`logs/backend.jsonl` 里 access 日志带 `path` 和 `ms`，
  可筛 `/api/search/hybrid`、`/api/assistant/chat/stream`。
  接口文档已关闭（`/api/docs` 返回 404），只能从日志看。
- **质量**：`bash scripts/eval-retrieval.sh` 跑 8 条固定查询
  （含一条「红烧肉怎么做」应返回空），输出 top3 供人工判断。
  改动检索参数前后各跑一次，对比命中内容而不是只看分数。
- **不要用的指标**：向量余弦绝对值。bge-m3 把中文相似度压在 0.4–0.6，
  无关 0.487–0.545 / 相关 0.579–0.590，差 0.03–0.08，阈值设 0.55 误杀一半、
  设 0.5 挡不住。要卡阈值只能用 cross-encoder 的分数。

### 5. 缩略图补齐进度

- **入口**：`GET /api/admin/thumbnails/status`（`inflight` = 排队 + 正在生成）。
- **失败封顶**：`videos.thumbnail_attempts` 到 3 就放弃，`thumbnail_failed_at` 记录时间。
  放弃后需手动触发：`POST /api/admin/thumbnails/retry/{video_id}` 或
  `POST /api/admin/thumbnails/retry-failed`（典型场景：视频盘重新挂载后整批重试）。
- **判据**：如果 `inflight` 长期不降、`thumbnail` 仍为空，先确认
  `resolve_media_path()` 能把 DB 里的路径映射到容器内实际路径。

### 6. 前端首屏体积

- **脚本**：`node scripts/perf-check.cjs`（Playwright + `performance.getEntriesByType('resource')`）。
- **看什么**：请求总数、`transferSize` 总和、按 `initiatorType` 分组的数量
  （重点看 `audio`，历史上它占了 98%）。
- **基线**：38 个请求 / 12KB / 音频 0 个（`ff9f4a5` 之后）。
  若音频请求数突然变成 15，说明预加载逻辑又被接回挂载流程。

### 7. 错误率与慢请求

- **日志位置**：`logs/backend.jsonl`、`logs/worker.jsonl`（JSONL，按大小轮转）。
  字段：`ts`、`level`、`logger`、`msg`、`request_id`、`svc`；
  access 日志额外带 `method` / `path` / `status` / `ms` / `client`。
- **查询**：

```bash
bash scripts/logq.sh stats --since 24h     # 按级别统计
bash scripts/logq.sh errors --since 1h     # 最近的 ERROR/CRITICAL
bash scripts/logq.sh req 8f3a2c1d          # 按 request_id 串起一次请求的全部日志
bash scripts/logq.sh path /api/notes       # 按路径筛
```

- **worker 的 request_id**：转写任务用 `job_id` 当 request_id，
  grep 一个 id 就能看完整条任务链路。
- **脱敏**：日志里的密码 / 令牌会被正则盖掉，排障时不要把原始请求体贴进 issue。

### 8. 回归与隔离检查

- **全项目检查**：`bash scripts/full-check.sh`（容器健康、公共接口、鉴权边界、
  安全头、数据库结构、Redis 配置、检索链路、前端资源；输出 PASS/WARN/FAIL 计数）。
- **多用户隔离**：`python backend/scripts/test_multi_user.py`（宿主机跑；
  默认打 `http://localhost`（80 nginx 入口），可传第一个参数指别的环境。
  backend 容器内 8000 映射到宿主回环 `127.0.0.1:12402`；脚本不要写 `127.0.0.1:8000`）。
- **修复项针对性验证**：`backend/scripts/verify_fixes.py`（验证「修之前会错、修之后对」，
  不是只看接口 200）。

---

## 附录：已知瓶颈（未修，本轮不动）

记录在此是为了让下一个改检索的人不用重新测一遍。以下问题**本轮未修**，
不属于本版收益，不要当成已解决的优化项引用。

- **不足 3 字符的关键词绕过 pg_trgm 索引，退化为全表扫描**（60,259 行，截至 2026-11-16）。
  - 触发条件：查询里出现不足 3 个字符的关键词（`算法`、`闭包`、`gc`）。
    `vue`（3 字符）、`组件通信`（4 字符）、`jQuery` 都能走 GIN 索引，不慢。
  - 实测（EXPLAIN，同一张表、同样用 `ILIKE '%词%'`）：`算法`（2 字符）
    走 Seq Scan、rows removed 59,185，**369ms**；`组件通信`（4 字符）
    走 Bitmap Heap Scan（GIN），**2ms**。原因：pg_trgm 的 GIN 索引要求
    模式里至少 3 个字符才能抽出 trigram。
  - 端到端 `timings.lexical_ms`（全库）：`什么是 GC 算法` 868~1048ms
    （`什么是` 47 + `算法` 350~380 + `gc` 300，三个条件 OR 叠加）；
    `闭包是什么` 455~470ms；`Vue 组件通信` 80~125ms（单词查询本身 2~6ms，
    慢在连接往返）；`黑马前端 jQuery 第五章` 32~65ms。
  - 注意：`函数返回另一个函数` 的 `lexical_ms` 是 **0**，不是慢查询 ——
    其中文串有 9 个字，超过 `extract_cjk_terms` 的 `max_len=8` 被整体丢弃，
    词法通道根本没查库。**不要把它当成全表扫描的例子引用。**
  - 状态：未修，本轮不动；修法与三种备选方案见
    `docs/retrieval-metadata-design.md` §7.1。
