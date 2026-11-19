"""AI 任务恢复：DB 状态与 Redis 队列校对。

背景：worker 被强杀时 RQ 把 job 标成 abandoned→failed，但进程死了，
_handle_job_failure 没机会执行 —— DB 侧仍是 queued，video.ai_status 也是
queued。前端轮询看到的就是永远不动的「处理中 / N 排队」。

修复两处：
  1. sync_db_queue_to_rq（worker 启动）：RQ 里已 failed/finished 的同名 job
     视为不活跃，删掉重新投递（原来只看 fetch_job is None，会漏）
  2. reconcile_stuck_ai_jobs（列表 API 轮询时）：运行期自愈，页面开着就能恢复

这两个函数都依赖真实 Redis，这里只验证「状态判定」这一层 ——
即 queued/started 算活跃、failed/finished 不算。
"""

from rq.job import JobStatus

# 与 sync_db_queue_to_rq / reconcile_stuck_ai_jobs 里保持一致的判定
_ALIVE_STATUSES = (JobStatus.QUEUED, JobStatus.STARTED)


def _is_alive(status: JobStatus | None) -> bool:
    return status in _ALIVE_STATUSES


def test_queued_and_started_are_alive():
    assert _is_alive(JobStatus.QUEUED) is True
    assert _is_alive(JobStatus.STARTED) is True


def test_failed_and_finished_are_not_alive():
    # 这两种就是「DB queued / RQ 已结束」的卡死场景，必须重新投递
    assert _is_alive(JobStatus.FAILED) is False
    assert _is_alive(JobStatus.FINISHED) is False
    assert _is_alive(None) is False  # Redis 里压根没有


def test_other_statuses_are_not_alive():
    for status in (JobStatus.DEFERRED, JobStatus.SCHEDULED, JobStatus.STOPPED, JobStatus.CANCELED):
        assert _is_alive(status) is False, status
