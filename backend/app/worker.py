from __future__ import annotations

import logging
import os
import signal
import sys
import time

from app.database import Base, engine, ensure_runtime_schema, settings
from app.services.admin_ai_queue import sync_db_queue_to_rq
from app.services.ai_jobs import requeue_interrupted_ai_jobs
from app.services.background_tasks import requeue_stale_tasks
from app.services.background_handlers import register_all as _register_bg_handlers
from app.services.rq_client import ai_jobs_queue, background_queue, get_redis_connection
from rq.worker import SimpleWorker

logger = logging.getLogger(__name__)

_running = True


def _stop(_signum, _frame) -> None:
    global _running
    _running = False


def _clean_dead_workers(redis_conn) -> None:
    """Remove stale worker registrations from Redis on Windows restart."""
    from rq import Worker
    for w in Worker.all(connection=redis_conn):
        try:
            w.register_death()
        except Exception:
            pass


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


def main() -> None:
    # worker 之前完全没配日志，跑的全是 RQ 的纯文本。
    # 而它是转写/建块这些长任务待的地方，恰恰最需要结构化日志。
    from app.core.observability import setup_from_settings

    setup_from_settings("worker")

    logger.info("AI RQ worker starting...")
    if sys.platform != "win32":
        signal.signal(signal.SIGINT, _stop)
        signal.signal(signal.SIGTERM, _stop)

    Base.metadata.create_all(bind=engine)
    ensure_runtime_schema()
    if settings.ai_worker_requeue_running_on_start:
        requeue_interrupted_ai_jobs()
    # Push any DB queued jobs that were created while Redis was unavailable
    sync_db_queue_to_rq()
    # 通用任务：先注册 handler，再把 running/queued 的重新投递
    _register_bg_handlers()
    requeue_stale_tasks()

    # 语义块索引扫描：把「有字幕但没索引 / 索引已过期」的视频投递过来。
    #
    # 为什么扫描放在 worker 而不是 backend：
    #   建块和向量化是重活，不该和 HTTP 请求抢线程；
    #   worker 是 restart: unless-stopped 的常驻进程，重启后线程自己回来。
    #
    # 为什么需要扫描而不是只靠转写后投递：
    #   1) 转写后投递失败（Redis 抖动）时需要兜底
    #   2) 历史遗留：这次接入之前转写的视频一个都没索引过
    #   3) 视频重转、字幕变了，需要发现「旧索引」
    from app.services.embedding_pipeline import start_auto_scan

    start_auto_scan()

    logger.info("AI worker initialized, waiting for jobs...")

    # Import rq here to avoid issues if Redis is not available at import time
    from rq import Worker

    redis_conn = get_redis_connection()
    queue = ai_jobs_queue()
    bg_queue = background_queue()

    # Clean stale worker registrations so this new process can register
    _clean_dead_workers(redis_conn)

    WorkerCls = WindowsWorker if sys.platform == "win32" else Worker
    worker = WorkerCls(
        # 两个队列都要消费：ai_jobs 是转写（长任务），
        # background 是缩略图/向量化这类可以随时重来的活。
        # 分开排队的意义：转写队列堵了，缩略图不该跟着等。
        queues=[queue, bg_queue],
        connection=redis_conn,
        name=f"ai-worker-{os.getpid()}",
    )

    # On Windows RQ uses SimpleWorker which runs jobs in the same process.
    # When a job is force-killed the worker process itself dies; the user
    # must restart it (same as restarting the backend today).
    while _running:
        try:
            # burst=False keeps the worker blocking on the queue.
            # It only returns on exception (e.g. job killed), then the
            # loop restarts after a brief pause.
            worker.work(burst=False, with_scheduler=False)
        except Exception:
            logger.exception("Worker error")
        if _running:
            # Brief pause before restarting after an error
            time.sleep(2)

    logger.info("AI RQ worker stopped.")


if __name__ == "__main__":
    main()
