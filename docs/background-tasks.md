# 后台任务的重启续跑

> 状态：事实已核实（核对基线 2026-11-16）

## 一、两套后台机制，别混在一起

| | AI 转写队列 | 通用后台任务 |
|---|---|---|
| 数据表 | `ai_jobs` | `background_tasks` |
| RQ 队列 | `ai_jobs` | `background` |
| 触发 | 前端任务中心 / 批量转写 | 转写完成后自动投递、定时扫描兜底、管理接口手动触发 |
| 状态恢复 | worker 启动 `requeue_interrupted_ai_jobs` + 列表接口 `reconcile_stuck_ai_jobs` | worker 启动 `requeue_stale_tasks` |
| 前端入口 | 前端 AI 任务中心（`useAiJobCenter` / `VideoAiJobCenter`），轮询 `GET /api/ai-jobs`（管理员） | 无独立任务中心；进度经 `/api/admin/embeddings/*`、`/api/admin/thumbnails/*` 管理接口查看 |

依据：`backend/app/services/rq_client.py:69,114`；`backend/app/routers/ai_jobs.py:22,53,60,65`；`backend/app/services/background_tasks.py:7-13,279`；`src/hooks/useAiJobCenter.ts`。

## 二、worker 进程

- 独立 compose 服务 `worker`，启动命令 `python -m app.worker`（`docker-compose.yml:260-271`）；backend 侧 `AI_WORKER_EMBEDDED=false`，不内嵌第二个消费者（`docker-compose.yml:142-144`）。
- 消费者是 RQ `SimpleWorker`（Windows 下用 `WindowsWorker` 子类，关掉 Unix-only death penalty；非 Windows 用 rq 原生 `Worker`）（`backend/app/worker.py:15,47-49,100`）。
- 同一个进程同时监听两个队列：`queues=[ai_jobs, background]`，worker 名 `ai-worker-{pid}`（`worker.py:101-107`）。分开排队的意义：转写队列堵了，向量化任务不该跟着等。
- 启动顺序：`create_all` → `ensure_runtime_schema` → 恢复 AI 中断任务 → DB 队列补投 RQ → 注册后台 handler → 恢复 stale 后台任务 → 起语义块定时扫描（`worker.py:64-86`）。

## 三、任务类型与投递链路

### `chunk_index`（语义块 + 向量化，走 `background` 队列）

- 转写完成后由 `ai_job_tasks._enqueue_chunk_index(video_id)` 投递（`backend/app/services/ai_job_tasks.py:33,47,133,175`）。
- 定时扫描兜底：`embedding_pipeline.start_auto_scan` 每 300 秒扫一次「有字幕没索引 / 索引过期」的视频，补投 `chunk_index`（`backend/app/services/embedding_pipeline.py:300,280-328,396`）。
- 处理函数：`background_handlers.handle_chunk_index`（`register_task("chunk_index")`，`backend/app/services/background_handlers.py:39-40`）。

### 缩略图（不走 RQ，走进程内线程池）

- 缩略图由 `thumbnail_worker` 在 backend 进程内的 `ThreadPoolExecutor` 生成，**不进 `background` 队列**：扫描间隔 300 秒、每批 200、在飞上限 400、单视频最多尝试 3 次（`backend/app/services/thumbnail_worker.py:80,84,88,93,130,207-237`）。
- `background_handlers.py` 里旧的 `thumbnail` 注册装饰器是死代码，运行时不可达（`background_handlers.py:13`）。不要再按「缩略图走 RQ 后台任务」排查。

## 四、后台任务状态机

`background_tasks` 表字段：`kind`、`target_id`、`payload`、`status`、`attempts`、`error`（`backend/app/models.py:526,555-559`）。

- 状态：`queued` → `running` → `done` / `failed`；`attempts` 累计，最多重试 `MAX_ATTEMPTS=3`，超时兜底 `TASK_TIMEOUT_SECONDS=1800`（`background_tasks.py:69,73`）。
- 入队前去重：同一 `(kind, target_id)` 已有 `queued`/`running` 记录则跳过；只有去重命中返回 `None`，投递出错一律抛异常（`background_tasks.py:114-165`）。
- 恢复语义（`background_tasks.py:40-46,279`）：
  - worker 启动时 `running` → `queued`（进程崩了，没人知道它还活着）；
  - `queued` → 重新 enqueue（Redis 可能丢过）；
  - 处理函数必须幂等 —— 恢复机制会让同一个任务被跑多次。
- 不需要分布式锁：整套系统只有一个 worker 消费，`status` 字段本身就是锁（`background_tasks.py:48-52`）。

## 五、管理接口（均需管理员）

| 方法 | 路径 | 作用 | 依据 |
|---|---|---|---|
| GET | `/api/ai-jobs` | 转写任务列表；列表加载时顺手对账 DB 与 RQ 状态 | `ai_jobs.py:53,60,65` |
| GET | `/api/admin/background-tasks/stats` | 后台任务状态统计（queued/running/done/failed） | `admin.py:114-123` |
| POST | `/api/admin/background-tasks/requeue` | 手动触发一次 stale 恢复（正常启动时自动跑） | `admin.py:126-131` |
| GET | `/api/admin/embeddings/status` | 语义块索引进度：有字幕、已索引、缺口、向量覆盖率 | `admin.py:86-91` |
| POST | `/api/admin/embeddings/scan?limit=50` | 手动触发一次缺失扫描 | `admin.py:94-99` |
| POST | `/api/admin/embeddings/reindex/{video_id}` | 重建单个视频索引（force 默认 true） | `admin.py:102-111` |
| GET | `/api/admin/thumbnails/status` | 缩略图补齐进度（inflight = 排队 + 生成中） | `admin.py:134-143` |
| POST | `/api/admin/thumbnails/rescan` | 扫库投递缺失缩略图（线程池，立即返回） | `admin.py:146-156` |
| POST | `/api/admin/thumbnails/retry/{video_id}` | 重置失败计数并立刻重试一张 | `admin.py:159-182` |
| POST | `/api/admin/thumbnails/retry-failed` | 把已放弃的视频计数清零，让扫描重新捡起 | `admin.py:185-188` |

## 六、手动新增一种后台任务

在 `background_handlers.py` 用 `register_task` 登记处理函数；处理函数收 `BackgroundTask` ORM 对象，自己取 `target_id` / `payload`，必须幂等：

```python
from app.services.background_tasks import register_task

@register_task("chunk_index")
def handle_chunk_index(task: BackgroundTask) -> None:
    ...
```

投递：`enqueue_task("chunk_index", target_id=str(video_id))`（`background_tasks.py:114-165`）。

## 七、排查

- 队列注册数与积压：`bash scripts/diagnose.sh` 第 4 段，读 `rq:workers:ai_jobs` 注册数（正常 1；0 没有消费者，2+ 重复 worker），以及 `rq:queue:ai_jobs`、`rq:queue:background` 长度（`scripts/diagnose.sh:73-79`）。
- 转写一直排队：先确认 worker 在消费，再看 `/api/ai-jobs` 里的失败原因。
- 检索搜不到新视频：看 `/api/admin/embeddings/status` 的缺口与向量覆盖率，再从 backend/worker 日志按 `bg-<task_id>` 拉单次任务记录。

## 八、数据基线（2026-11-20 口径）

有字幕视频 14,160；语义块 98,271；字幕片段 5,667,374（约 566 万）。实时数字以管理接口为准。

## 待用户确认

- `worker.py:102-103` 注释仍写「background 是缩略图/向量化」，实际缩略图已改走进程内线程池，`background` 队列只剩 `chunk_index`；注释是否要顺手更正属代码侧，本次未改。
