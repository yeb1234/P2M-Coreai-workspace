from __future__ import annotations

import logging
import os
import signal
import socket
import sys
import threading
import time
import uuid

from app.database import ensure_runtime_schema, settings
from app.services.admin_ai_queue import sync_db_queue_to_rq
from app.services.ai_jobs import requeue_interrupted_ai_jobs
from app.services.background_tasks import reconcile_background_tasks, requeue_stale_tasks
from app.services.background_handlers import register_all as _register_bg_handlers
from app.services.rq_client import ai_jobs_queue, background_queue, get_redis_connection, summary_jobs_queue
from rq.worker import DequeueStrategy, SimpleWorker

logger = logging.getLogger(__name__)

_running = True
_STARTUP_LOCK_KEY = "p2-siteyeb:worker:startup-recovery:lock"
_STARTUP_LOCK_TTL_SECONDS = int(os.getenv("WORKER_STARTUP_LOCK_TTL", "120"))


def _stop(_signum, _frame) -> None:
    global _running
    _running = False


def _clean_dead_workers(redis_conn) -> None:
    """清理陈旧注册。

    默认不清理：RQ 的 register_death 会直接把注册从 Redis 删掉，
    并不校验对方是否还活着；多 worker 同时启动时，先启动的进程
    很容易把后启动的兄弟 worker 当成「死」的清掉。只有显式设置
    WORKER_SKIP_CLEAN=0 才执行，且仍建议在确认没有其他 worker 时使用。
    """
    if os.getenv("WORKER_SKIP_CLEAN", "1") == "1":
        logger.info("WORKER_SKIP_CLEAN=1（默认），保留现有 worker 注册")
        return
    from rq import Worker

    for w in Worker.all(connection=redis_conn):
        try:
            w.register_death()
        except Exception:
            pass


def _clean_own_registration(redis_conn, worker_name: str) -> None:
    """只删除同名旧 worker，不影响同项目里的其他 worker。

    WORKER_SKIP_CLEAN=1 会保留所有注册，用来避免误删 GPU worker；
    但固定 WORKER_NAME 的容器每次重建都会撞上自己上一次的旧注册。
    显式设置 WORKER_FORCE_REGISTER=1 时，仅清理这一个名字。
    """
    if os.getenv("WORKER_FORCE_REGISTER", "0") != "1":
        return
    key = f"rq:worker:{worker_name}"
    if redis_conn.exists(key):
        redis_conn.delete(key)
        logger.warning("removed stale worker registration %s", key)


class NoOpDeathPenalty:
    """No-op context manager that disables RQ's Unix-only death penalty on Windows."""
    def __init__(self, *args, **kwargs):
        pass
    def __enter__(self):
        pass
    def __exit__(self, *args):
        pass


class WindowsWorker(SimpleWorker):
    """Windows-compatible worker that disables Unix-only death penalty."""
    death_penalty_class = NoOpDeathPenalty


def _acquire_startup_lock(redis_conn) -> str | None:
    """选出一个 primary 做启动恢复。

    恢复动作（requeue_interrupted / sync_db_queue_to_rq / stale tasks）
    是幂等的，但并发跑会互相踩事务和队列；用 Redis NX 锁让同一时间
    只有一个 worker 执行。锁 TTL 防止进程崩溃后永久占锁。
    """
    token = f"{os.getpid()}:{uuid.uuid4().hex}"
    if redis_conn.set(_STARTUP_LOCK_KEY, token, nx=True, ex=_STARTUP_LOCK_TTL_SECONDS):
        logger.info("startup recovery lock acquired by pid=%s", os.getpid())
        return token
    logger.info("startup recovery skipped: another worker holds %s", _STARTUP_LOCK_KEY)
    return None


def _release_startup_lock(redis_conn, token: str) -> None:
    try:
        if redis_conn.get(_STARTUP_LOCK_KEY) == token.encode():
            redis_conn.delete(_STARTUP_LOCK_KEY)
    except Exception:
        logger.warning("释放 startup recovery 锁失败，等待 TTL 自动过期", exc_info=True)


def _run_startup_recovery(redis_conn) -> None:
    """只由一个 primary 执行的启动恢复。

    以前每个非 secondary worker 都会跑这一整套：两个 primary 同时
    启动时，sync_db_queue_to_rq 会同时扫几千条 queued 任务，并且
    每个任务都拉着一个大事务，最后和正在转写的 worker 撞 PostgreSQL
    deadlock。现在用 Redis 锁串行化，且 sync 本身改成分批提交。
    """
    token = _acquire_startup_lock(redis_conn)
    if token is None:
        return
    try:
        if settings.ai_worker_requeue_running_on_start:
            queues_mode = (
                os.getenv("WORKER_QUEUES") or "ai_jobs,background"
            ).strip().lower().replace(" ", "")
            if queues_mode == "ai_jobs":
                # 台式机只负责转写，不能把笔记本正在跑的 summary_only 任务重置。
                requeue_interrupted_ai_jobs(summary_only=False)
            elif queues_mode == "summary_jobs":
                requeue_interrupted_ai_jobs(summary_only=True)
            else:
                requeue_interrupted_ai_jobs()
        sync_db_queue_to_rq()
        requeue_stale_tasks()
        logger.info("startup recovery completed")
    except Exception:
        # 恢复失败不应该让整个 worker 退出；队列消费仍然可用，
        # 运行期还有 reconcile_stuck_ai_jobs 兜底。
        logger.exception("startup recovery failed; worker will still consume queue")
    finally:
        _release_startup_lock(redis_conn, token)


def _start_background_reconciler(redis_conn, interval: int = 30) -> None:
    """常驻校对 background_tasks，自动补投 RQ 里已经丢掉的 queued/running。

    多个 worker 都会消费 background，不能让每个进程每 30 秒都扫一遍；
    用 Redis 锁选出唯一执行者，锁过期后其他进程自然接管。
    """
    token = f"{os.getpid()}:{uuid.uuid4().hex}"
    lock_key = "bg:reconcile:lock"

    def loop() -> None:
        while _running:
            try:
                acquired = bool(
                    redis_conn.set(lock_key, token, nx=True, ex=interval * 2)
                )
                if acquired:
                    try:
                        result = reconcile_background_tasks()
                        if result.get("requeued"):
                            logger.warning(
                                "background 自动补投 %d 条（检查 %d，仍活着 %d，失败 %d）",
                                result["requeued"],
                                result["checked"],
                                result["alive"],
                                result["failed"],
                            )
                    finally:
                        try:
                            # 只释放自己拿到的锁，TTL 到期后别的 worker 接管。
                            if redis_conn.get(lock_key) == token.encode():
                                redis_conn.delete(lock_key)
                        except Exception:
                            pass
            except Exception:
                logger.exception("background 自动校对循环异常")
            time.sleep(interval)

    threading.Thread(
        target=loop,
        name="background-reconciler",
        daemon=True,
    ).start()


def main() -> None:
    # worker 之前完全没配日志，跑的全是 RQ 的纯文本。
    # 而它是转写/建块这些长任务待的地方，恰恰最需要结构化日志。
    from app.core.observability import setup_from_settings

    setup_from_settings("worker")

    secondary = os.getenv("WORKER_SECONDARY", "0") == "1"
    logger.info("AI RQ worker starting... secondary=%s", secondary)
    if sys.platform != "win32":
        signal.signal(signal.SIGINT, _stop)
        signal.signal(signal.SIGTERM, _stop)

    # schema 自举由 database.ensure_runtime_schema 统一加 PG advisory lock；
    # worker 不再自己 create_all，避免和 backend/另一个 worker 并发 DDL。
    # 这里不能让它把 worker 顶掉：DDL 撞锁时 backend 仍能服务，队列消费也
    # 应该继续；真正的表结构由 entrypoint / backend 启动时补齐。
    try:
        ensure_runtime_schema()
    except Exception:
        logger.exception("worker 运行时 schema 检查失败，继续消费队列")

    # 所有 worker 都要注册 background handler：secondary 也会消费 background
    # 队列（summary-worker-laptop 就是 summary_jobs,background），以前只在
    # primary 分支注册，secondary 拿到 background 任务会找不到 handler。
    _register_bg_handlers()

    redis_conn = get_redis_connection()
    if not secondary:
        # 启动恢复串行化：只允许一个 primary 做 requeue/sync/stale/扫描。
        _run_startup_recovery(redis_conn)
    else:
        logger.info("secondary worker: skip startup recovery (queue consume only)")

    logger.info("AI worker initialized, waiting for jobs...")

    # Import rq here to avoid issues if Redis is not available at import time
    from rq import Worker

    queue = ai_jobs_queue()
    bg_queue = background_queue()
    summary_queue = summary_jobs_queue()

    # Clean stale worker registrations so this new process can register
    _clean_dead_workers(redis_conn)

    WorkerCls = WindowsWorker if sys.platform == "win32" else Worker
    own_name = os.getenv("WORKER_NAME") or f"ai-worker-{socket.gethostname()}-{os.getpid()}"
    _clean_own_registration(redis_conn, own_name)
    # 默认两个队列都消费；独立 vector-worker 只消费 background，
    # summary-worker 只消费 summary_jobs，避免和转写长队列抢任务。
    # summary_jobs,background：默认总结优先；需要让笔记本在 AI 总结和
    # 向量任务之间来回处理时，设置 WORKER_DEQUEUE_STRATEGY=round_robin。
    queues_mode = (os.getenv("WORKER_QUEUES") or "ai_jobs,background").strip().lower().replace(" ", "")
    if queues_mode == "background":
        queues = [bg_queue]
    elif queues_mode == "ai_jobs":
        queues = [queue]
    elif queues_mode == "summary_jobs":
        queues = [summary_queue]
    elif queues_mode == "summary_jobs,background":
        queues = [summary_queue, bg_queue]
    else:
        queues = [queue, bg_queue]

    # 向量扫描线程跟着 background 消费者走：vector-worker 独占扫描，
    # 避免 primary 只消费 ai_jobs 时也起一个没人消费的扫描线程。
    if any(q.name == bg_queue.name for q in queues):
        from app.services.embedding_pipeline import start_auto_scan

        start_auto_scan()
        logger.info("vector auto-scan started in pid=%s", os.getpid())

    strategy_name = (os.getenv("WORKER_DEQUEUE_STRATEGY") or "default").strip().lower()
    if strategy_name == "round_robin":
        dequeue_strategy = DequeueStrategy.ROUND_ROBIN
    elif strategy_name == "random":
        dequeue_strategy = DequeueStrategy.RANDOM
    else:
        dequeue_strategy = DequeueStrategy.DEFAULT
    logger.info(
        "worker queues=%s dequeue_strategy=%s",
        [q.name for q in queues],
        dequeue_strategy.value,
    )
    worker = WorkerCls(
        # ai_jobs 是转写（长任务），background 是缩略图/向量化这类可以随时重来的活。
        # 分开排队的意义：转写队列堵了，缩略图不该跟着等。
        queues=queues,
        connection=redis_conn,
        name=own_name,
    )

    # 只要这个 worker 消费 background，就参与运行期校对。
    # 不依赖重启：vector-worker 被 kill 后留下的 queued 任务会被自动补投。
    if any(q.name == bg_queue.name for q in queues):
        _start_background_reconciler(redis_conn, interval=30)

    # On Windows RQ uses SimpleWorker which runs jobs in the same process.
    # When a job is force-killed the worker process itself dies; the user
    # must restart it (same as restarting the backend today).
    while _running:
        try:
            # burst=False keeps the worker blocking on the queue.
            # It only returns on exception (e.g. job killed), then the
            # loop restarts after a brief pause.
            worker.work(
                burst=False,
                with_scheduler=False,
                dequeue_strategy=dequeue_strategy,
            )
        except Exception:
            logger.exception("Worker error")
        if _running:
            # Brief pause before restarting after an error
            time.sleep(2)

    logger.info("AI RQ worker stopped.")


if __name__ == "__main__":
    main()
