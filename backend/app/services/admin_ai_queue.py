"""RQ-based AI queue management.

Replaces the hand-rolled ThreadPoolExecutor + memory-flag system with
Redis Queue for reliable enqueue, execution, cancellation and recovery.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import and_, or_

from app.database import SessionLocal
from app.models import AiJob, Video
import sys

from app.services.admin_settings import load_transcription_settings
from app.services.ai_jobs import (
    _step_summarize,
    _video_has_transcription_outputs,
    write_markdown_output,
)
from app.utils.serialization import load_segments
from app.services.rq_client import (
    AI_JOB_RESULT_TTL_SECONDS,
    AI_JOB_TIMEOUT_SECONDS,
    ai_jobs_queue,
    cancel_job,
    clear_job_cancelled,
    compute_job_timeout,
    get_redis_connection,
    is_job_cancelled,
    send_kill_to_worker,
)

_PAUSE_KEY = "ai_queue:paused"


def _job_timeout_seconds(db, job) -> int:
    """按这个任务对应视频的时长算超时。

    2 小时课程不该和 20 分钟短片用同一个 4 小时固定值 ——
    短片真卡死会白占 worker 四小时，长合集又可能不够。
    算不出来时退回固定值，不阻塞入队。
    """
    try:
        duration = (
            db.query(Video.duration).filter(Video.id == job.video_id).scalar()
        )
    except Exception:
        duration = None
    return compute_job_timeout(duration)


def _is_queue_paused() -> bool:
    return bool(get_redis_connection().exists(_PAUSE_KEY))


def ai_queue_state() -> dict:
    db = SessionLocal()
    try:
        return {
            "paused": _is_queue_paused(),
            "running": db.query(AiJob).filter(AiJob.status == "running").count(),
            "queued": db.query(AiJob).filter(AiJob.status == "queued").count(),
            "failed": db.query(AiJob).filter(AiJob.status == "failed").count(),
            "completed": db.query(AiJob).filter(AiJob.status == "completed").count(),
        }
    finally:
        db.close()


def clear_queued_ai_jobs() -> dict:
    db = SessionLocal()
    try:
        jobs = db.query(AiJob).filter(AiJob.status == "queued").all()
        video_ids = {job.video_id for job in jobs}
        queue = ai_jobs_queue()
        for job in jobs:
            job.status = "cancelled"
            job.stage = "cancelled"
            job.message = "Cancelled before processing"
            job.error = "Cancelled before processing"
            rq_job = queue.fetch_job(job.id)
            if rq_job:
                rq_job.cancel()
        if video_ids:
            videos = db.query(Video).filter(Video.id.in_(video_ids)).all()
            for video in videos:
                if video.ai_status == "queued":
                    video.ai_status = "idle"
                    video.ai_stage = None
                    video.ai_error = None
        db.commit()
        return {"cleared": len(jobs)}
    finally:
        db.close()


def recover_stuck_ai_jobs(minutes: int = 60, correction_minutes: int = 15, force: bool = False) -> dict:
    stale_minutes = max(5, min(minutes, 24 * 60))
    correction_stale_minutes = max(5, min(correction_minutes, stale_minutes))
    now = datetime.now()
    cutoff = now - timedelta(minutes=stale_minutes)
    correction_cutoff = now - timedelta(minutes=correction_stale_minutes)
    db = SessionLocal()
    try:
        jobs = (
            db.query(AiJob)
            .filter(
                AiJob.status == "running",
                or_(
                    force,
                    and_(AiJob.stage == "correcting-subtitles", AiJob.updated_at < correction_cutoff),
                    and_(
                        or_(AiJob.stage != "correcting-subtitles", AiJob.stage.is_(None)),
                        AiJob.updated_at < cutoff,
                    ),
                ),
            )
            .all()
        )
        for job in jobs:
            was_correcting_subtitles = job.stage == "correcting-subtitles"
            video = db.query(Video).filter(Video.id == job.video_id).first()

            # 如果视频已经有完整转录结果，直接标记完成而不是恢复为 queued
            if video and _video_has_transcription_outputs(video):
                job.status = "completed"
                job.stage = "completed"
                job.message = "Skipped — video already has transcription"
                job.error = None
                job.transcript = video.transcription
                job.transcript_segments = video.transcript_segments
                job.summary = video.summary
                job.markdown_path = video.markdown_path
                job.subtitle_path = video.subtitle_path
                video.ai_status = "completed"
                video.ai_stage = "completed"
                video.ai_error = None
                continue

            job.status = "queued"
            job.stage = "queued"
            job.message = (
                "Recovered from stale subtitle correction state"
                if was_correcting_subtitles
                else "Recovered from stale running state"
            )
            job.error = None
            if video:
                video.ai_status = "queued"
                video.ai_stage = "queued"
                video.ai_error = None
        if jobs:
            db.commit()
        return {
            "recovered": len(jobs),
            "cutoff_minutes": stale_minutes,
            "correction_cutoff_minutes": correction_stale_minutes,
        }
    finally:
        db.close()


def pause_ai_queue() -> dict:
    get_redis_connection().set(_PAUSE_KEY, "1")
    return {"paused": True}


def resume_ai_queue() -> dict:
    get_redis_connection().delete(_PAUSE_KEY)
    sync_db_queue_to_rq()
    return {"paused": False}


def cancel_ai_job(job_id: str) -> dict:
    db = SessionLocal()
    try:
        job = db.query(AiJob).filter(AiJob.id == job_id).first()
        if not job:
            return {"cancelled": False, "reason": "not_found"}
        if job.status not in ("queued", "running", "cancelling"):
            return {"cancelled": False, "reason": "not_active"}
        video = db.query(Video).filter(Video.id == job.video_id).first()
        queue = ai_jobs_queue()
        if job.status in ("running", "cancelling"):
            # 优雅取消：设 Redis flag，worker 在下一个步骤边界检查
            # is_job_cancelled() 后抛 "Job cancelled"，由 _handle_job_failure
            # 统一收尾成 cancelled（见 ai_jobs.py）。
            #
            # 原来这里直接返回 running_not_cancellable，但项目里其实
            # 早就有一整套取消信号机制（rq_client.cancel_job + whisper 内部
            # 每步检查 + clear_active_ai_jobs 的批量取消），只是单个取消
            # 没接上 —— 用户点取消没反应，只能等它跑完。
            cancel_job(job.id)
            job.status = "cancelling"
            job.stage = "cancelling"
            job.message = "Cancelling — will stop after current step"
            job.error = None
            if video:
                video.ai_status = "cancelling"
                video.ai_stage = "cancelling"
            db.commit()
            return {"cancelled": True, "status": job.status, "graceful": True}
        else:
            rq_job = queue.fetch_job(job_id)
            if rq_job:
                rq_job.cancel()
            job.status = "cancelled"
            job.stage = "cancelled"
            job.message = "Cancelled by user"
            job.error = "Cancelled by user"
            if video and video.ai_status == "queued":
                video.ai_status = "idle"
                video.ai_stage = None
                video.ai_error = None
        db.commit()
        return {"cancelled": True, "status": job.status}
    finally:
        db.close()


def resume_ai_job(job_id: str) -> dict:
    db = SessionLocal()
    try:
        job = db.query(AiJob).filter(AiJob.id == job_id).first()
        if not job:
            return {"resumed": False, "reason": "not_found"}
        existing_active = (
            db.query(AiJob)
            .filter(AiJob.video_id == job.video_id, AiJob.id != job.id, AiJob.status.in_(("queued", "running")))
            .first()
        )
        if existing_active:
            return {"resumed": False, "reason": "active_job", "job_id": existing_active.id}
        video = db.query(Video).filter(Video.id == job.video_id).first()
        if not video:
            return {"resumed": False, "reason": "missing_video"}

        # 清掉上次取消时留下的 Redis flag。
        # 不清的话，续写出来的新任务在第一个步骤边界检查 is_job_cancelled()
        # 就会立刻又「被取消」—— 用户点了续写，任务瞬间又停，看起来像坏了。
        clear_job_cancelled(job_id)

        # 如果视频已经有完整转录结果，跳过转写，但仍要检查总结。
        # 原来这里直接标记 completed，有字幕无总结的视频「续写」后
        # summary 还是空的 —— 和 run_ai_job_task 的跳过分支同一个 bug。
        if _video_has_transcription_outputs(video):
            summary = video.summary
            summary_error = None
            if job.do_summary and not (summary and summary.strip()):
                summary, summary_error = _step_summarize(
                    db, job, video, video.transcription or ""
                )
                if summary:
                    video.summary = summary
                    try:
                        from pathlib import Path

                        md_path = Path(video.markdown_path) if video.markdown_path else None
                        if md_path and md_path.exists():
                            write_markdown_output(
                                md_path=md_path,
                                source_filename=video.filename,
                                transcript=video.transcription or "",
                                transcript_segments=load_segments(video.transcript_segments),
                                summary=summary,
                                word_limit=job.word_limit,
                                whisper_model=job.whisper_model,
                                language=job.language,
                                subtitle_filename=Path(video.subtitle_path).name if video.subtitle_path else None,
                                summary_error=summary_error,
                            )
                    except Exception as exc:
                        logger = logging.getLogger(__name__)
                        logger.warning("续写补总结到 markdown 失败 video=%s: %s", video.id, exc)

            job.status = "completed"
            job.stage = "completed"
            job.message = (
                "Resumed — summary generated from existing transcript"
                if summary else "Skipped — video already has transcription"
            )
            job.error = None
            job.transcript = video.transcription
            job.transcript_segments = video.transcript_segments
            job.summary = summary
            job.markdown_path = video.markdown_path
            job.subtitle_path = video.subtitle_path
            video.ai_status = "completed"
            video.ai_stage = "completed"
            video.ai_error = summary_error if summary_error and not summary else None
            db.commit()
            return {"resumed": True, "job_id": job.id}

        job.status = "queued"
        job.stage = "queued"
        job.message = "Resumed by user"
        job.error = None
        video.ai_status = "queued"
        video.ai_stage = "queued"
        video.ai_error = None
        db.commit()
        if not _is_queue_paused():
            queue = ai_jobs_queue()
            # 清掉上次取消/失败留下的 RQ job，否则同名 job_id 会被
            # RQ 当成「已存在」拒绝入队，续写后 DB 是 queued 但
            # Redis 里没有任务，又变成假「处理中」。
            old = queue.fetch_job(job_id)
            if old is not None:
                try:
                    old.delete()
                except Exception:
                    pass
            queue.enqueue(
                "app.services.ai_job_tasks.run_ai_job_task",
                args=(job_id,),
                job_id=job_id,
                job_timeout=_job_timeout_seconds(db, job),
                result_ttl=AI_JOB_RESULT_TTL_SECONDS,
            )
        return {"resumed": True, "job_id": job.id}
    finally:
        db.close()


def enqueue_ai_jobs(job_ids: list[str], at_front: bool = False) -> None:
    """Enqueue a list of job IDs into the RQ queue.

    Args:
        job_ids: List of job IDs to enqueue.
        at_front: If True, push jobs to the front of the queue (for single-video priority).
    """
    if not job_ids:
        return
    queue = ai_jobs_queue()
    # 一次查出这批任务对应视频的时长，避免逐条 query
    timeout_by_job: dict[str, int] = {}
    db = SessionLocal()
    try:
        rows = (
            db.query(AiJob.id, Video.duration)
            .join(Video, Video.id == AiJob.video_id)
            .filter(AiJob.id.in_(job_ids))
            .all()
        )
        timeout_by_job = {jid: compute_job_timeout(dur) for jid, dur in rows}
    except Exception:
        pass
    finally:
        db.close()

    for job_id in job_ids:
        queue.enqueue(
            "app.services.ai_job_tasks.run_ai_job_task",
            args=(job_id,),
            job_id=job_id,
            at_front=at_front,
            job_timeout=timeout_by_job.get(job_id, AI_JOB_TIMEOUT_SECONDS),
            result_ttl=AI_JOB_RESULT_TTL_SECONDS,
        )


def sync_queued_ai_job_settings() -> dict:
    current = load_transcription_settings()
    db = SessionLocal()
    try:
        jobs = db.query(AiJob).filter(AiJob.status == "queued").all()
        for job in jobs:
            job.whisper_engine = current["whisper_engine"]
            job.whisper_model = current["whisper_model"]
            job.language = current["language"]
            job.do_summary = current["do_summary"]
            job.word_limit = current["word_limit"]
            job.cpu_threads = None if current["whisper_engine"] == "whisper.cpp" else current["cpu_threads"]
            job.compute_type = current["compute_type"]
            job.beam_size = current["beam_size"]
            job.best_of = current["best_of"]
            job.temperature = current["temperature"]
            job.vad_filter = current["vad_filter"]
            job.subtitle_correction_enabled = current["subtitle_correction_enabled"]
            job.subtitle_correction_scope = "off" if current["subtitle_correction_scope"] == "off" else "full"
            job.subtitle_correction_prompt = current["subtitle_correction_prompt"] or None
            job.message = "Queued with current transcription settings"
            job.error = None
            job.updated_at = datetime.now()
        db.commit()
        return {"updated": len(jobs)}
    finally:
        db.close()


def clear_active_ai_jobs() -> dict:
    db = SessionLocal()
    try:
        running_jobs = db.query(AiJob).filter(AiJob.status.in_(("running", "cancelling"))).all()
        queued_jobs = db.query(AiJob).filter(AiJob.status == "queued").all()
        queue = ai_jobs_queue()
        for job in running_jobs:
            # 只设 Redis 取消 flag，让这个任务在下一个步骤边界自行退出。
            #
            # 原来还会 send_kill_to_worker() 杀掉整个 worker 进程 ——
            # 单并发时勉强能用，并发=2 后会连带杀死另一个无关的运行中任务，
            # 而且 worker 重启又要走一整套恢复流程，代价极大。
            # whisper 内部本来就每步检查 flag，优雅取消就够了。
            cancel_job(job.id)
            job.status = "cancelling"
            job.stage = "cancelling"
            job.message = "Cancelling — will stop after current step"
            job.error = None
        for job in queued_jobs:
            rq_job = queue.fetch_job(job.id)
            if rq_job:
                rq_job.cancel()
            job.status = "cancelled"
            job.stage = "cancelled"
            job.message = "Cancelled by user"
            job.error = "Cancelled by user"
        all_video_ids = {job.video_id for job in running_jobs} | {job.video_id for job in queued_jobs}
        if all_video_ids:
            videos = db.query(Video).filter(Video.id.in_(all_video_ids)).all()
            for video in videos:
                if video.id in {job.video_id for job in running_jobs}:
                    video.ai_status = "cancelling"
                    video.ai_stage = "cancelling"
                else:
                    video.ai_status = "idle"
                    video.ai_stage = None
                    video.ai_error = None
        db.commit()
        return {
            "cleared": len(running_jobs) + len(queued_jobs),
            "running_stopped": len(running_jobs),
            "queued_cancelled": len(queued_jobs),
        }
    finally:
        db.close()


def clear_finished_ai_jobs() -> dict:
    db = SessionLocal()
    try:
        count = (
            db.query(AiJob)
            .filter(AiJob.status.in_(("completed", "failed", "cancelled")))
            .delete(synchronize_session=False)
        )
        db.commit()
        return {"cleared": int(count)}
    finally:
        db.close()


def clear_completed_ai_jobs() -> dict:
    db = SessionLocal()
    try:
        count = (
            db.query(AiJob)
            .filter(AiJob.status == "completed")
            .delete(synchronize_session=False)
        )
        db.commit()
        return {"cleared": int(count)}
    finally:
        db.close()


def clear_all_ai_jobs() -> dict:
    db = SessionLocal()
    try:
        running_jobs = db.query(AiJob).filter(AiJob.status.in_(("running", "cancelling"))).all()
        running_video_ids = {job.video_id for job in running_jobs}
        deleted = (
            db.query(AiJob)
            .filter(AiJob.status.in_(("queued", "completed", "failed", "cancelled")))
            .delete(synchronize_session=False)
        )
        # Only reset videos that are NOT tied to a running job
        all_videos = db.query(Video).filter(Video.ai_status.in_(("queued", "running", "failed", "cancelled", "cancelling"))).all()
        for video in all_videos:
            if video.id in running_video_ids:
                # Leave running jobs untouched
                continue
            video.ai_status = "idle"
            video.ai_stage = None
            video.ai_error = None
        db.commit()
        return {
            "cleared": int(deleted),
            "deleted": int(deleted),
            "running_preserved": len(running_jobs),
        }
    finally:
        db.close()


def sync_db_queue_to_rq() -> int:
    """Push any DB 'queued' jobs that are not yet in the RQ queue.

    Called on startup, resume, and after recover so that jobs created
    while Redis was temporarily unavailable still get executed.
    """
    import logging

    logger = logging.getLogger(__name__)
    db = SessionLocal()
    try:
        queued_jobs = db.query(AiJob).filter(AiJob.status == "queued").order_by(AiJob.created_at.asc()).all()
        if not queued_jobs:
            return 0
        queue = ai_jobs_queue()
        enqueued = 0
        skipped = 0
        for job in queued_jobs:
            try:
                # 如果视频已经有完整转录结果，直接标记完成，不入队
                video = db.query(Video).filter(Video.id == job.video_id).first()
                if video and _video_has_transcription_outputs(video):
                    job.status = "completed"
                    job.stage = "completed"
                    job.message = "Skipped — video already has transcription"
                    job.transcript = video.transcription
                    job.transcript_segments = video.transcript_segments
                    job.summary = video.summary
                    job.markdown_path = video.markdown_path
                    job.subtitle_path = video.subtitle_path
                    video.ai_status = "completed"
                    video.ai_stage = "completed"
                    video.ai_error = None
                    skipped += 1
                    continue

                rq_job = queue.fetch_job(job.id)
                # fetch_job 会从 failed/finished registry 里也找到同名 job，
                # 光判断 is None 不够：worker 被强杀后，RQ 把任务标成
                # abandoned→failed，而 DB 侧还停在 queued。于是这里看到
                # 「job 已存在」就跳过，DB 永远 queued，前端一直显示
                # 「处理中」，用户反复重试都没用。
                #
                # 只有 RQ 里确实还活着（queued / started）才算已入队。
                # 其它状态一律清掉旧记录重新投递。
                from rq.job import JobStatus

                alive = rq_job is not None and rq_job.get_status() in (
                    JobStatus.QUEUED,
                    JobStatus.STARTED,
                )
                if rq_job is not None and not alive:
                    try:
                        rq_job.delete()
                    except Exception:
                        pass
                if not alive:
                    queue.enqueue(
                        "app.services.ai_job_tasks.run_ai_job_task",
                        args=(job.id,),
                        job_id=job.id,
                        job_timeout=_job_timeout_seconds(db, job),
                        result_ttl=AI_JOB_RESULT_TTL_SECONDS,
                    )
                    enqueued += 1
            except Exception:
                logger.exception("Failed to enqueue job %s to RQ", job.id)
        db.commit()
        logger.info(
            "sync_db_queue_to_rq: pushed %d/%d queued jobs to RQ, skipped %d already-done",
            enqueued,
            len(queued_jobs),
            skipped,
        )
        return enqueued
    finally:
        db.close()


def reconcile_stuck_ai_jobs(db, limit: int = 20) -> int:
    """把「DB 说 queued、但 RQ 里已经不在队列」的任务重新投递。

    为什么需要：worker 被强制重启（Docker restart / OOM kill）时，
    RQ 会把正在跑或排队中的 job 标成 abandoned→failed，但进程被杀，
    _handle_job_failure 没机会执行 —— DB 侧仍是 queued，Video 上也是
    queued。前端轮询看到的就是「处理中 / 1 排队」，可 Redis 里根本没有
    这个任务，永远不会有人执行它。用户只能反复点重试，而重试只是刷新
    同一个 DB 行的 created_at，问题依旧。

    worker 启动时会跑 sync_db_queue_to_rq，但那是「一次性」的；
    运行期再发生 worker 重启就没有人校对了。所以挂在前端每 3 秒轮询的
    AI 任务列表 API 上，页面开着就能自愈。

    只处理 queued：running 的 job 可能真的在 worker 里执行（RQ started），
    贸然重投会造成同一任务双跑。started 状态视为活跃，不动。
    """
    from rq.job import JobStatus

    try:
        queue = ai_jobs_queue()
        # queued 和 running 都要扫。
        #
        # 原来只扫 queued，漏了一类真实故障：worker 重启后 RQ 会把旧的
        # started job 移到 failed（AbandonedJobError），但那是**延迟发生**的 ——
        # worker 启动时 requeue_interrupted_ai_jobs 已经把 DB 的 running
        # 改成 queued 了，可如果 RQ 标记发生在之后，DB 会停在 running，
        # 而这个函数只扫 queued，于是永远没人管它，前端一直显示「正在转写」。
        #
        # 判定仍然靠 RQ 的真实状态：started 说明确实在跑，不动；
        # 只有 RQ 里找不到或已 failed 的才重投。
        stuck = (
            db.query(AiJob)
            .filter(AiJob.status.in_(("queued", "running")))
            .order_by(AiJob.created_at.asc())
            .limit(limit)
            .all()
        )
        recovered = 0
        for job in stuck:
            try:
                rq_job = queue.fetch_job(job.id)
                alive = rq_job is not None and rq_job.get_status() in (
                    JobStatus.QUEUED,
                    JobStatus.STARTED,
                )
                if alive:
                    continue
                if rq_job is not None:
                    try:
                        rq_job.delete()
                    except Exception:
                        pass
                queue.enqueue(
                    "app.services.ai_job_tasks.run_ai_job_task",
                    args=(job.id,),
                    job_id=job.id,
                    job_timeout=_job_timeout_seconds(db, job),
                    result_ttl=AI_JOB_RESULT_TTL_SECONDS,
                )
                video = db.query(Video).filter(Video.id == job.video_id).first()
                if video is not None:
                    video.ai_status = "queued"
                    video.ai_stage = "queued"
                    video.ai_error = None
                # job 自身状态也要复位。原来是 running 的话，
                # 重投后 DB 还写着 running，前端会显示「正在转写」但实际在排队。
                if job.status == "running":
                    job.status = "queued"
                    job.stage = "queued"
                job.message = "Requeued after stale state detected"
                recovered += 1
            except Exception:
                # 单个任务恢复失败不影响其它任务，也不影响列表展示
                logger = logging.getLogger(__name__)
                logger.exception("校对 AI job 状态失败 job=%s", job.id)
        if recovered:
            db.commit()
        return recovered
    except Exception:
        # Redis 不可用时什么都不做：列表照常展示，下次轮询再试
        logging.getLogger(__name__).exception("AI job 状态校对失败")
        return 0
