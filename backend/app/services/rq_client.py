"""Redis Queue client for AI job management.

Provides Redis connection, named queue access, and cancellation helpers.
All RQ interactions go through this module to avoid scattered Redis code.
"""

from __future__ import annotations

import redis
from rq import Queue
from rq.command import send_kill_horse_command

from app.database import settings

_redis_conn: redis.Redis | None = None
_ai_jobs_queue: Queue | None = None


def get_redis_connection() -> redis.Redis:
    global _redis_conn
    if _redis_conn is None:
        _redis_conn = redis.from_url(settings.redis_url, decode_responses=False)
    return _redis_conn


def ai_jobs_queue() -> Queue:
    global _ai_jobs_queue
    if _ai_jobs_queue is None:
        _ai_jobs_queue = Queue("ai_jobs", connection=get_redis_connection())
    return _ai_jobs_queue


def is_job_cancelled(job_id: str) -> bool:
    """Check whether a job has been marked for cancellation in Redis."""
    return bool(get_redis_connection().exists(f"ai_job:cancelled:{job_id}"))


def cancel_job(job_id: str) -> None:
    """Mark a job as cancelled in Redis (graceful cancellation signal)."""
    get_redis_connection().setex(f"ai_job:cancelled:{job_id}", 3600, "1")


def clear_job_cancelled(job_id: str) -> None:
    """Remove cancellation flag after the job finishes or is cleaned up."""
    get_redis_connection().delete(f"ai_job:cancelled:{job_id}")


def send_kill_to_worker(worker_name: str) -> None:
    """Send SIGTERM/SIGKILL to an RQ worker's horse process.

    On Unix this kills the forked child; on Windows it terminates the worker
    process (SimpleWorker) which is executing the job.
    """
    try:
        send_kill_horse_command(get_redis_connection(), worker_name)
    except Exception:
        pass
