"""Redis Queue client for AI job management.

Provides Redis connection, named queue access, and cancellation helpers.
All RQ interactions go through this module to avoid scattered Redis code.
"""

from __future__ import annotations

import redis
from rq import Queue
from rq.command import send_kill_horse_command

from app.database import settings

# 转写任务的超时上限。
#
# RQ 默认 job_timeout 是 180 秒 —— 一个小时的课程视频根本转不完，
# 到点就被 RQ 强杀，任务标记失败。三处 enqueue 之前都没传这个参数，
# 等于所有超过 3 分钟的转写都在超时边缘。
#
# 给 4 小时：足够转完 4 小时以上的长课程，又不至于让真卡死的任务
# 永远占着 worker。
AI_JOB_TIMEOUT_SECONDS = 4 * 60 * 60

# 任务结果在 Redis 里保留一天。默认 500 秒，
# 用户过一会回来查进度就查不到结果了。
AI_JOB_RESULT_TTL_SECONDS = 24 * 60 * 60

_redis_conn: redis.Redis | None = None
_ai_jobs_queue: Queue | None = None
_background_queue: Queue | None = None


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


def background_queue() -> Queue:
    """通用后台任务队列（缩略图、向量化等）。

    和 ai_jobs 分开是为了互不阻塞：转写队列里有长任务时，
    缩略图不该跟着排队。
    """
    global _background_queue
    if _background_queue is None:
        _background_queue = Queue("background", connection=get_redis_connection())
    return _background_queue
