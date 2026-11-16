# 3.0.0-beta

> 这是一个**大版本**。数据库结构、检索链路、部署方式都变了，
> 升级前请先读「破坏性变更」和「升级步骤」。

---

## 一句话概括

把 2.9x 的「能跑」变成了 3.0 的「能维护」：检索从逐句碎片换成语义块，
多用户真正隔离，长事务和静默失效这两类问题系统性清掉，
迁移有版本记录，日志能回溯，部署收敛到一套 compose。

---

## 主要变更

### 1. 检索链路重构

**从逐句字幕（平均 9 字）换成语义块（约 565 字）。**

碎片做检索单位的问题是：一条命中只有「那我们就来看一下」这种句子，
必须先按时间窗扩成段落才能给模型用。块本身就是完整上下文，少一层拼装和去重。

- 新增 `content_chunks`（pgvector `halfvec(1024)`）+ HNSW 索引
- 新增 `services/chunker.py`：分块逻辑的唯一来源，脚本和运行时共用
- 新增 `services/embedding_pipeline.py`：**三层续跑**
  - 整条没做过 → 建块 + 向量化
  - 块建好了、向量没齐 → 只补向量（不重建）
  - 齐了但字幕变了 → 重建
- **删除 `segment_embeddings`（716,107 行 / 3.5 GB）**，库从 ~6 GB 降到 2.5 GB
- 删除碎片检索路径、`retrieval_source` 开关、`scripts/backfill_embeddings.py`

> 为什么必须三层判断：块和向量都是派生数据，**无法自证新鲜**。
> 视频重转过、字幕变了，旧块还在、旧向量也在。只看「有没有块」
> 扫不出「是不是旧的」。而如果每次判「没做过」就重建，
> 会在「重建中途被杀」时把已经算好的向量全冲掉，永远算不完。

### 2. 多用户隔离

- `notes` 分 `shared` / `private`，私有笔记只有本人可读写
- 观看进度、收藏、会话、个人画像全部按 `user_id` 过滤
- 迁移里把历史数据归属到最早的 admin

修复的越权路径（都已实测验证）：

| 路径 | 原来 |
|---|---|
| `GET /api/videos/{id}/notes` | 不鉴权，且会读到别人的私有笔记 |
| `ensure_video_note` | 不看 scope，AI 转写会覆盖用户私有笔记 |
| 私有笔记文件 | 落在公开静态目录 `/output/user-notes/{uid}/note-{id}.md`，可枚举下载 |
| `ensure_session` | 不校验归属，拿到别人的 session_id 就能读写他的会话 |
| Agent `search_notes` | 全库检索，能读出别人的私有笔记正文 |
| 观看进度 | 全局最新，A 会从 B 看到的位置续播 |

### 3. 长事务：不再把迁移卡死

**这一类问题导致过一次整站 502**：缩略图 worker 把 ffmpeg 夹在
`SELECT` 和 `commit()` 之间，4 个线程各占一个 `videos` 的读锁，
迁移的 `ALTER TABLE videos` 等了 12 分半，后端卡在启动阶段。

修法统一成三段式——**DB 事务绝不跨越耗时操作**：

```
短事务读 → 无事务做耗时操作（ffmpeg / ffprobe / 网络） → 短事务写
```

覆盖 7 处：`thumbnail_worker`、`handle_thumbnail`、`index_video`、
`stream_video`（最严重：视频传多久事务就开多久）、`get_sprite_sheet`、
`generate_missing_thumbnails/sprites`、`upsert_video`。

另外迁移的 DDL 加 `SET LOCAL lock_timeout = '20s'`——宁可 20 秒报错，
不要无声卡 12 分钟。

### 4. 可观测性

- `/health` 新增 `transactions` 段：idle-in-tx 数、最长时长、锁等待。
  阈值 60s / 30s。
- **warn 时仍返回 200**：探针挂掉会触发重启，但重启解决不了锁等待
  （持锁的是别的连接），只会让问题看起来像「进程不稳定」。
- `scripts/diagnose.sh`：只读，六段输出。站点 502 时 `/health` 自己也是 502，
  所以需要一条不依赖应用进程的路径。

### 5. 日志

- 应用日志落盘 JSONL（`./logs/{backend,worker}.jsonl`），20MB × 5 轮转
- docker 侧 `json-file` 20MB × 3 兜底
- `worker` 之前**完全没配日志**，跑的是 RQ 纯文本
- 脱敏：原来只过滤 `extra_fields` 的键名，`logger.info(f"...pwd={p}")`
  会把密码原样写进日志。加了内容级正则。
- 修 500 的 `request_id` 是 `-`：`@app.exception_handler(Exception)` 挂在
  `ServerErrorMiddleware` 上，读不到中间件设的 contextvar，需要从
  `request.scope` 回填。
- `scripts/logq.sh errors|req|stats|tail`

### 6. 数据库迁移版本化（Alembic）

之前只有 `create_all` + 手写 `ALTER TABLE ... IF NOT EXISTS`。它幂等、
启动自动跑，但**没有版本记录、不给已有表补索引、不可回滚**。

「不给已有表补索引」这次真的踩到了：`models.Note` 声明了 `scope`/`user_id`
的 `index=True`，新库有索引、老库没有，同一份代码两种行为。

- baseline `ed9ec716c9b0`：21 表 + 49 索引 + `content_chunks` + 6 个手工索引
- `f2f5d8064921`：补 notes 两个索引
- 老库过渡：检测「有表但无 `alembic_version`」→ stamp baseline → upgrade head

### 7. 死代码清理

**净删 2030 行。**

- `services/assistant.py` 整模块 330 行（0 导入，已被 `agents/chat_agent.py` 取代）
- `TimeCenterPage.tsx` 468 行（路由指向的是 Page2）
- `idbStorage.ts` 10 个函数（本地账号库残留）
- 插件的 `panel` 字段：5 个插件都填了整页组件，**0 处读取**，
  却把 TodoPage/CalendarPage/PomodoroPage 整个拉进主 bundle，
  让 `React.lazy` 白做。删掉后 TodoPage 变成独立 chunk。

### 8. 部署

- `start.bat` / `start.sh` 重写为 Docker 编排（旧的跑本机 uvicorn + npm run dev，
  但 pgvector / Redis / ffmpeg 只有容器里有）
- 「不用 AI 助手」= `postgres + redis + backend + frontend`，worker 不起
- 修 nginx 缓存后端旧 IP 导致整站 502：改用 `resolver` + 变量形式 `proxy_pass`

---

## 破坏性变更

| 变更 | 影响 |
|---|---|
| 删除 `segment_embeddings` 表 | 无法回退到碎片检索。数据不可恢复，需要重新向量化 |
| 删除 `retrieval_source` 配置 | `.env` 里留着也会被忽略（`extra="ignore"`） |
| 删除 `BACKFILL_EMBEDDINGS` 开关 | 建块+向量化已自动化，不需要手动跑脚本 |
| `notes.scope` 成为必需语义 | 历史笔记默认 `shared` |
| 删除 `services/assistant.py` | 如有外部脚本 import 会断（仓库内 0 引用） |
| 启动方式改为全 Docker | 本机 `uvicorn` 直跑不再支持 |

---

## 升级步骤

```bash
# 1. 备份数据库（必须）
docker exec siteyeb-pg pg_dump -U p2user p2learning > backup-2.9x.sql

# 2. 拉代码、重建镜像
git pull
docker compose build backend frontend

# 3. 启动（会先跑 alembic）
docker compose up -d

# 4. 确认结构和数据
curl localhost/health
curl localhost/ready
curl localhost/api/admin/embeddings/status
```

第 3 步会自动处理：老库检测到「有表但无 `alembic_version`」→
stamp 到 baseline → 跑增量迁移。

**如果迁移卡住**：`bash scripts/diagnose.sh`，第 3 段会显示是谁在持锁。

---

## 验证记录

| 项 | 结果 |
|---|---|
| 前端单测 | 194 / 194 |
| 多用户隔离 | 25 / 25 |
| 安全与 bug 修复验证 | 13 / 13 |
| 页面冒烟 | 8 个页面，无 JS 错误 |
| 新建库 vs 线上库结构 | 262 列 + 82 索引 **完全一致** |
| 语义块索引覆盖 | 8,819 / 8,819 视频，60,422 块 |
| 检索一致性（删表前后） | 4 个查询命中 id 与分数完全一致 |
| 缩略图吞吐 | 40 → 269 张/分钟 |
| `typescript` 构建 | 通过 |
| `pg_stat_activity` 长事务 | 0 |

---

## 已知问题（beta 期间继续修）

- 番茄钟「根据时间推算番茄钟个数」与「反向推算」失效
- 检索打分的部分边界行为待调（`rerank_score` 在 LLM 分支是名次、交叉编码器分支是分数，语义不统一）
- `recompute_profile` 每条聊天都全量扫 `watch_events`，数据量上来会慢
- 学习路径配额在去重/并发上限之前扣，重复点击会白扣
- 部分页面功能未完成，需要加「施工中」标识
- 收藏仍是全局布尔值（应做成 `video_favorites` 表）
