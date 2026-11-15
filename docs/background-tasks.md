# 后台任务的重启续跑

时间：2026-11-16

## 一句话结论

**不是所有任务都需要同一套机制。** 按「能不能靠扫描重新发现」分成两类，各自用最合适的方案：

| 任务 | 机制 | 重启后 |
|---|---|---|
| 缩略图批量补齐 | 定时扫描「缺缩略图的」 | **自动续跑**（扫描即恢复） |
| AI 转写 | `ai_jobs` 表 + RQ + `requeue_interrupted_ai_jobs` | **自动续跑** |
| 一次性任务（向量化等） | `background_tasks` 表 + RQ + `requeue_stale_tasks` | **自动续跑** |

---

## 一、缩略图：不需要任务表

关键洞察：**「哪些视频还没缩略图」这个事实本身就存在数据库里**（`videos.thumbnail IS NULL`）。

所以不需要为每个视频记一条任务记录 —— 只要扫描这个条件，就能知道还剩什么活。

```
worker 启动
  → start_auto_scan()
      → 每 5 分钟扫一次：SELECT id FROM videos WHERE thumbnail IS NULL LIMIT 200
      → 投给线程池并发生成
```

**重启时会发生什么**：进程死了，内存队列没了，但 DB 里那些 `thumbnail IS NULL` 的记录还在。新进程起来后第一次扫描会发现它们，继续生成。

**实测**：

```
重启前: succeeded=400, 剩余 27,276
重启后: succeeded=600, 剩余 27,069   ← 自动接着补
```

**为什么不给缩略图建任务表**：2 万多个视频就是 2 万多条任务记录，而扫描一条 SQL 就能得到同样的信息。**能用查询表达的，不要用状态表存。**

---

## 二、AI 转写：已有机制

`ai_jobs` 表记录每个转写任务，`requeue_interrupted_ai_jobs()` 在 worker 启动时把 `running` 改回 `queued` 并重新入队。

这套早就有了，本轮只是把 worker 纳入 docker compose 保证它会自动启动。

---

## 三、通用底座：给「扫描发现不了」的任务用

有些任务没法靠扫描发现。比如「给视频 123 建向量」——你不能靠「哪些视频还没向量」来推断，因为可能用户只想给某几个建，或者中途改了参数需要重跑。

这类任务需要**显式记录**。新增 `background_tasks` 表：

```
id / kind / target_id / payload / status / attempts / error
     / created_at / started_at / finished_at
```

状态机：

```
queued ──→ running ──→ done
             │
             ├─ 失败且 attempts < 3 ──→ queued（重试）
             └─ 失败且 attempts >= 3 ──→ failed
```

### 三条设计原则

**1. DB 是状态源，Redis 只是管道**

Redis 里的队列随时可能因为重启/清空而消失，但 DB 里的 `status='queued'` 记录还在。worker 启动时扫一遍 DB 把 queued 的重新投递，一条都不会漏。

这是「重启能接着跑」的根本保证 —— **不要相信队列，要相信表**。

**2. 任务函数必须幂等**

恢复机制会把 `running` 改回 `queued` 重新执行，意味着同一个任务可能被执行两次（第一次跑到一半崩了）。所以处理函数要满足：**跑两遍和跑一遍的结果一样**。

```python
@register_task("thumbnail")
def handle_thumbnail(task):
    video = db.query(Video).get(int(task.target_id))
    if video.thumbnail:      # ← 幂等检查：已经有就跳过
        return
    ...
```

**3. 带重试上限**

每次必失败的任务不能无限重投，否则会占死队列。`attempts >= 3` 就标 `failed`，留给人处理。

### 重启恢复的完整链路

```
worker 启动
  → Base.metadata.create_all（表在）
  → register_all()（注册 handler）
  → requeue_stale_tasks()
      · status='running' → 'queued'（进程崩了，没人知道它还活着）
      · status='queued'  → 重新 enqueue（Redis 可能丢过）
  → 正常消费 [ai_jobs, background] 两个队列
```

**实测**：

```
造一条跑在 running 的任务（模拟跑到一半崩了）
  → docker restart siteyeb-worker
  → 任务状态: running → done
  → attempts: 1 → 2      ← 确认重新执行了一次
```

---

## 四、怎么加一种新任务

三步：

```python
# 1. 写处理函数（必须幂等）
@register_task("embedding")
def handle_embedding(task: BackgroundTask) -> None:
    video_id = int(task.target_id)
    # 幂等检查：已经有完整向量就跳过
    if has_complete_embedding(video_id):
        return
    # 干活
    vectors = compute_embeddings(video_id)
    # 用 upsert 写回，不要 insert（避免重复执行撞主键）
    upsert_embeddings(video_id, vectors)


# 2. 投递
enqueue_task("embedding", target_id=str(video_id), payload={"model": "bge-m3"})


# 3. 不用做别的事 —— worker 会自动消费、自动重试、重启自动恢复
```

---

## 五、监控接口

```
GET  /api/admin/background-tasks/stats    各状态数量
POST /api/admin/background-tasks/requeue  手动触发恢复（正常不需要）
GET  /api/admin/thumbnails/status         缩略图补齐进度
POST /api/admin/thumbnails/rescan         手动投递一批缩略图
GET  /api/ai-jobs                         转写任务列表（admin）
```

重启后想确认「有没有任务被漏掉」，查 `queued + running` 的数量就行。

---

## 六、没有做的事

**不做分布式锁**。整套系统只有一个 worker 进程消费，`status` 字段本身就是锁：入队前先判断状态，重复投递会被 `run_background_task` 里的 `if task.status == "done": return` 挡掉。

如果以后要开多 worker，需要加行级锁（`SELECT ... FOR UPDATE`）或 Redis 分布式锁。现在不需要。

**不做任务优先级**。缩略图和转写分两个队列，互不阻塞，但队列内部是 FIFO。如果以后有「用户等着看结果」的任务需要插队，再加优先级字段。
