"""Redis Queue client for AI job management.

Provides Redis connection, named queue access, and cancellation helpers.
All RQ interactions go through this module to avoid scattered Redis code.
"""

from __future__ import annotations

import redis
from rq import Queue
from rq.command import send_kill_horse_command

from app.database import settings
from app.services.redis_keys import p2_key

# 转写任务的兜底超时（视频时长未知时用这个）。
#
# RQ 默认 job_timeout 是 180 秒 —— 一个小时的课程视频根本转不完，
# 到点就被 RQ 强杀，任务标记失败。三处 enqueue 之前都没传这个参数，
# 等于所有超过 3 分钟的转写都在超时边缘。
AI_JOB_TIMEOUT_SECONDS = 4 * 60 * 60

# 按视频时长动态算超时的参数。
#
# 为什么不能只用一个固定值：2 小时的课程和 20 分钟的短片需要的转写时间
# 差一个数量级。固定 4 小时对短片太宽松（真卡死要占着 worker 4 小时），
# 对 4 小时的合集又可能不够 —— 用户明确提到「有的视频 2 小时呢，留余地大点」。
#
# 系数取 3：faster-whisper small/int8 在 CPU 上大约 1/5~1/10 实时，
# 3 倍实时是很宽的安全边界，再叠加 30 分钟固定缓冲覆盖模型加载、
# 音频提取、总结调用的开销。上下限夹住，避免异常 duration 算出离谱值。
_TIMEOUT_FACTOR = 3.0
_TIMEOUT_BASE_BUFFER_SECONDS = 30 * 60
_TIMEOUT_MIN_SECONDS = 60 * 60  # 再短的视频也给 1 小时
_TIMEOUT_MAX_SECONDS = 12 * 60 * 60  # 上限 12 小时


def compute_job_timeout(duration_sec: float | None) -> int:
    """按视频时长算这个任务该给多少超时。

    2 小时视频 → 2h×3 + 30min = 6.5 小时
    18 分钟     → 下限兜到 1 小时
    4 小时合集  → 12.5h 被上限截到 12 小时
    duration 缺失 → 退回固定 4 小时
    """
    if not duration_sec or duration_sec <= 0:
        return AI_JOB_TIMEOUT_SECONDS
    estimated = duration_sec * _TIMEOUT_FACTOR + _TIMEOUT_BASE_BUFFER_SECONDS
    return int(max(_TIMEOUT_MIN_SECONDS, min(_TIMEOUT_MAX_SECONDS, estimated)))

# 任务结果在 Redis 里保留一天。默认 500 秒，
# 用户过一会回来查进度就查不到结果了。
AI_JOB_RESULT_TTL_SECONDS = 24 * 60 * 60

_redis_conn: redis.Redis | None = None
_ai_jobs_queue: Queue | None = None
_summary_jobs_queue: Queue | None = None
_background_queue: Queue | None = None


def get_redis_connection() -> redis.Redis:
    global _redis_conn
    if _redis_conn is None:
        _redis_conn = redis.from_url(settings.redis_url, decode_responses=False)
    return _redis_conn


def ai_jobs_queue() -> Queue:
    global _ai_jobs_queue
    if _ai_jobs_queue is None:
        _ai_jobs_queue = Queue(p2_key("queue:ai_jobs"), connection=get_redis_connection())
    return _ai_jobs_queue


def summary_jobs_queue() -> Queue:
    """只补总结的独立队列；笔记本/备用总结 worker 消费这里。"""
    global _summary_jobs_queue
    if _summary_jobs_queue is None:
        _summary_jobs_queue = Queue(p2_key("queue:summary_jobs"), connection=get_redis_connection())
    return _summary_jobs_queue


def is_job_cancelled(job_id: str) -> bool:
    """Check whether a job has been marked for cancellation in Redis."""
    return bool(get_redis_connection().exists(p2_key(f"ai_job:cancelled:{job_id}")))


def cancel_job(job_id: str) -> None:
    """Mark a job as cancelled in Redis (graceful cancellation signal).

    TTL 必须盖住单个任务可能的最长运行时间（_TIMEOUT_MAX_SECONDS，12h），
    否则超长任务跑到一半时取消标记过期，worker 检查不到 ——
    用户以为取消了，实际还在烧 CPU。多留 2 小时覆盖排队等待。
    """
    ttl = _TIMEOUT_MAX_SECONDS + 2 * 3600
    get_redis_connection().setex(p2_key(f"ai_job:cancelled:{job_id}"), ttl, "1")


def clear_job_cancelled(job_id: str) -> None:
    """Remove cancellation flag after the job finishes or is cleaned up."""
    get_redis_connection().delete(p2_key(f"ai_job:cancelled:{job_id}"))


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
        _background_queue = Queue(p2_key("queue:background"), connection=get_redis_connection())
    return _background_queue
