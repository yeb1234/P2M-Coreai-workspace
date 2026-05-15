from __future__ import annotations

import logging
import os
import signal
import sys
import time

from app.database import Base, engine, ensure_runtime_schema, settings
from app.services.admin_ai_queue import sync_db_queue_to_rq
from app.services.ai_jobs import requeue_interrupted_ai_jobs
from app.services.rq_client import ai_jobs_queue, get_redis_connection
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
    logger.info("AI worker initialized, waiting for jobs...")

    # Import rq here to avoid issues if Redis is not available at import time
    from rq import Worker

    redis_conn = get_redis_connection()
    queue = ai_jobs_queue()

    # Clean stale worker registrations so this new process can register
    _clean_dead_workers(redis_conn)

    WorkerCls = WindowsWorker if sys.platform == "win32" else Worker
    worker = WorkerCls(
        queues=[queue],
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
