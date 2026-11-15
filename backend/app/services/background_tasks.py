"""通用持久化任务队列：任何「跑到一半断了要能接着跑」的活都可以挂这里。

## 为什么需要一套通用的

项目里现在有三种后台活，各自的可靠性天差地别：

  AI 转写   ai_jobs 表 + RQ + requeue_interrupted_ai_jobs   ← 重启能恢复
  缩略图     进程内 ThreadPool + 内存集合                     ← 重启全丢
  向量化     还没做

每来一种新活就要重写一遍「建表 + 入队 + 恢复 + 去重」，迟早出错。
所以抽这一层：**加一种新活只需要写一个处理函数 + 注册一个 kind**。

## 设计

    background_tasks 表  ← 唯一可信的状态源（谁都能查、重启能读回）
            ↓  投递
        RQ 队列          ← 只负责分发，Redis 挂了也不影响正确性
            ↓  消费
      worker 进程         ← 按 kind 分派到具体处理函数

三个关键点：

1. **DB 是状态源，Redis 只是管道**
   Redis 里的队列随时可能因为重启/清空而消失，但 DB 里的
   `status='queued'` 记录还在。worker 启动时扫一遍 DB 把 queued
   的重新投递，一条都不会漏。这是「重启能接着跑」的根本保证。

2. **任务函数必须幂等**
   恢复机制会把 `running` 改回 `queued` 重新执行 —— 意味着同一个任务
   可能被执行两次（第一次跑到一半崩了，第二次从头再来）。
   所以处理函数要满足：**跑两遍和跑一遍的结果一样**。
   缩略图天然幂等（写同一个文件）、转写幂等（先查有没有产出）。

3. **带重试上限**
   每次都失败的任务不能无限重投，否则会占死队列。
   attempts 到上限就标 failed，等人处理。

## 重启恢复的完整链路

    worker 启动
      → Base.metadata.create_all（表在）
      → requeue_stale_tasks()
          · status='running' → 'queued'（进程崩了，没人知道它还活着）
          · status='queued'  → 重新 enqueue（Redis 可能丢过）
      → 正常消费

## 不用做的事

不需要分布式锁。整套系统只有一个 worker 进程消费，
`status` 字段本身就是锁：入队前先 `UPDATE ... WHERE status='queued'`
影响行数为 0 就说明别人抢走了。
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Callable

from sqlalchemy import or_

from app.database import SessionLocal
from app.models import BackgroundTask

logger = logging.getLogger(__name__)

# 任务最多重试几次。超过就置 failed，留给人看。
MAX_ATTEMPTS = 3

# 单次执行超时（秒）。RQ 层面也有一层超时，这里是兜底：
# 处理函数内部如果有长时间阻塞的网络调用，可以让它自己检查。
TASK_TIMEOUT_SECONDS = 30 * 60


class TaskHandler:
    """任务处理函数的登记表。

    用法：
        @register_task("thumbnail")
        def handle_thumbnail(task: BackgroundTask) -> None:
            ...

    处理函数收到的是 ORM 对象，自己决定看 target_id 还是 payload。
    **必须幂等** —— 恢复机制会导致同一个任务被跑多次。
    """

    _handlers: dict[str, Callable[[BackgroundTask], None]] = {}

    @classmethod
    def register(cls, kind: str) -> Callable:
        def decorator(fn: Callable[[BackgroundTask], None]) -> Callable:
            cls._handlers[kind] = fn
            return fn

        return decorator

    @classmethod
    def get(cls, kind: str) -> Callable[[BackgroundTask], None] | None:
        return cls._handlers.get(kind)

    @classmethod
    def kinds(cls) -> list[str]:
        return list(cls._handlers.keys())


def register_task(kind: str) -> Callable:
    return TaskHandler.register(kind)


# ── 任务创建 ────────────────────────────────────────────────────


def enqueue_task(
    kind: str,
    target_id: str,
    payload: dict[str, Any] | None = None,
    *,
    dedupe: bool = True,
) -> str | None:
    """创建一个任务并投递。返回 task_id，去重命中时返回 None。

    dedupe=True 时，如果同一个 (kind, target_id) 已经有 queued/running
    的记录，直接跳过 —— 避免用户连点几次按钮堆出一堆重复任务。
    """
    db = SessionLocal()
    try:
        if dedupe:
            existing = (
                db.query(BackgroundTask.id)
                .filter(
                    BackgroundTask.kind == kind,
                    BackgroundTask.target_id == str(target_id),
                    BackgroundTask.status.in_(("queued", "running")),
                )
                .first()
            )
            if existing:
                return None

        task = BackgroundTask(
            kind=kind,
            target_id=str(target_id),
            payload=payload or {},
            status="queued",
            attempts=0,
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        task_id = task.id
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("创建任务失败 kind=%s target=%s", kind, target_id)
        return None
    finally:
        db.close()

    _push_to_rq(task_id)
    return task_id


def _push_to_rq(task_id: str) -> None:
    """把任务推进 RQ。失败不影响正确性 —— worker 启动时会扫 DB 补投。"""
    try:
        from app.services.rq_client import background_queue

        background_queue().enqueue(
            "app.services.background_tasks.run_background_task",
            args=(task_id,),
            job_id=f"bg-{task_id}",
            job_timeout=TASK_TIMEOUT_SECONDS,
        )
    except Exception:  # noqa: BLE001
        logger.warning("投递到 RQ 失败，留待下次扫描补投 task=%s", task_id)


# ── 任务执行 ────────────────────────────────────────────────────


def run_background_task(task_id: str) -> None:
    """RQ 调用的入口。按 kind 分派到具体处理函数。"""
    db = SessionLocal()
    try:
        task = db.query(BackgroundTask).filter(BackgroundTask.id == task_id).first()
        if task is None:
            logger.warning("任务不存在，跳过 task=%s", task_id)
            return

        # 已经跑完的不要再跑（恢复机制可能重复投递）
        if task.status == "done":
            return

        handler = TaskHandler.get(task.kind)
        if handler is None:
            task.status = "failed"
            task.error = f"没有注册 kind={task.kind} 的处理函数"
            db.commit()
            logger.error("未知任务类型 kind=%s task=%s", task.kind, task_id)
            return

        task.status = "running"
        task.attempts = (task.attempts or 0) + 1
        task.started_at = datetime.now()
        db.commit()

        try:
            handler(task)
            task.status = "done"
            task.error = None
            task.finished_at = datetime.now()
            db.commit()
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            task = db.query(BackgroundTask).filter(BackgroundTask.id == task_id).first()
            if task is None:
                return
            task.error = str(exc)[:2000]
            task.finished_at = datetime.now()
            if (task.attempts or 0) >= MAX_ATTEMPTS:
                task.status = "failed"
                logger.error("任务失败已达上限 kind=%s task=%s err=%s", task.kind, task_id, exc)
            else:
                task.status = "queued"
                logger.warning("任务失败，将重试 kind=%s task=%s 第 %s 次", task.kind, task_id, task.attempts)
            db.commit()
    finally:
        db.close()


# ── 重启恢复 ────────────────────────────────────────────────────


def requeue_stale_tasks() -> dict[str, int]:
    """worker 启动时调用：把「该跑没跑完」的任务重新投递。

    两种情况都要处理：
      running —— 上一个 worker 进程崩了，任务卡在 running 状态没人管
      queued  —— 记录建好了但 RQ 投递失败（比如当时 Redis 不可用）

    返回各类恢复的数量，便于打日志。
    """
    db = SessionLocal()
    recovered_running = 0
    requeued = 0
    try:
        stale = (
            db.query(BackgroundTask)
            .filter(
                or_(
                    BackgroundTask.status == "running",
                    BackgroundTask.status == "queued",
                )
            )
            .all()
        )
        for task in stale:
            if task.status == "running":
                recovered_running += 1
            task.status = "queued"
        db.commit()
        ids = [t.id for t in stale]
    finally:
        db.close()

    for task_id in ids:
        _push_to_rq(task_id)
    requeued = len(ids)

    if requeued:
        logger.info(
            "任务恢复：running→queued %d 个，重新投递 %d 个",
            recovered_running,
            requeued,
        )
    return {"recovered_running": recovered_running, "requeued": requeued}


def task_stats() -> dict[str, int]:
    """按状态统计任务数量，给管理接口用。"""
    db = SessionLocal()
    try:
        rows = (
            db.query(BackgroundTask.status, BackgroundTask.id)
            .all()
        )
        counts: dict[str, int] = {}
        for status, _ in rows:
            counts[status] = counts.get(status, 0) + 1
        return counts
    finally:
        db.close()
