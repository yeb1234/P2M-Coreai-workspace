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
from app.services.ai_jobs import _video_has_transcription_outputs
from app.services.rq_client import (
    ai_jobs_queue,
    cancel_job,
    clear_job_cancelled,
    get_redis_connection,
    is_job_cancelled,
    send_kill_to_worker,
)

_PAUSE_KEY = "ai_queue:paused"


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
            # Running jobs cannot be stopped mid-flight on Windows
            # (SimpleWorker runs in-process). They must finish the
            # current step and then exit gracefully.
            return {"cancelled": False, "reason": "running_not_cancellable"}
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

        # 如果视频已经有完整转录结果，直接标记完成而不是恢复为 queued
        if _video_has_transcription_outputs(video):
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
            queue.enqueue(
                "app.services.ai_job_tasks.run_ai_job_task",
                args=(job_id,),
                job_id=job_id,
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
    for job_id in job_ids:
        queue.enqueue(
            "app.services.ai_job_tasks.run_ai_job_task",
            args=(job_id,),
            job_id=job_id,
            at_front=at_front,
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
            cancel_job(job.id)
            rq_job = queue.fetch_job(job.id)
            if rq_job and rq_job.get_status() == "started":
                send_kill_to_worker(rq_job.worker_name)
            job.status = "cancelling"
            job.stage = "cancelling"
            job.message = "Stopping worker (will finalize after current step)"
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
                if rq_job is None:
                    queue.enqueue(
                        "app.services.ai_job_tasks.run_ai_job_task",
                        args=(job.id,),
                        job_id=job.id,
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
