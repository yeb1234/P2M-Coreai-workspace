from datetime import datetime, timedelta

from sqlalchemy import and_, or_

from app.database import SessionLocal
from app.models import AiJob, Video
from app.services.admin_settings import load_transcription_settings
from app.services.ai_queue import is_queue_paused, pause_queue, resume_queue


def ai_queue_state() -> dict:
    db = SessionLocal()
    try:
        return {
            "paused": is_queue_paused(),
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
        for job in jobs:
            job.status = "cancelled"
            job.stage = "cancelled"
            job.message = "Cancelled before processing"
            job.error = "Cancelled before processing"
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
            job.status = "queued"
            job.stage = "queued"
            job.message = "Recovered from stale subtitle correction state" if was_correcting_subtitles else "Recovered from stale running state"
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
    pause_queue()
    return {"paused": True}


def resume_ai_queue() -> dict:
    resume_queue()
    return {"paused": False}


def cancel_ai_job(job_id: str) -> dict:
    db = SessionLocal()
    try:
        job = db.query(AiJob).filter(AiJob.id == job_id).first()
        if not job:
            return {"cancelled": False, "reason": "not_found"}
        if job.status not in ("queued", "running"):
            return {"cancelled": False, "reason": "not_active"}
        video = db.query(Video).filter(Video.id == job.video_id).first()
        job.status = "cancelled"
        job.stage = "cancelled"
        job.message = "Cancelled by user"
        job.error = "Cancelled by user"
        if video:
            video.ai_status = "idle"
            video.ai_stage = None
            video.ai_error = None
        db.commit()
        return {"cancelled": True}
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

        job.status = "queued"
        job.stage = "queued"
        job.message = "Resumed by user"
        job.error = None
        video.ai_status = "queued"
        video.ai_stage = "queued"
        video.ai_error = None
        db.commit()
        return {"resumed": True, "job_id": job.id}
    finally:
        db.close()


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
        jobs = db.query(AiJob).filter(AiJob.status.in_(("queued", "running"))).all()
        video_ids = {job.video_id for job in jobs}
        for job in jobs:
            job.status = "cancelled"
            job.stage = "cancelled"
            job.message = "Cancelled by user"
            job.error = "Cancelled by user"
        if video_ids:
            videos = db.query(Video).filter(Video.id.in_(video_ids)).all()
            for video in videos:
                video.ai_status = "idle"
                video.ai_stage = None
                video.ai_error = None
        db.commit()
        return {"cleared": len(jobs)}
    finally:
        db.close()


def clear_finished_ai_jobs() -> dict:
    db = SessionLocal()
    try:
        jobs = db.query(AiJob).filter(AiJob.status.in_(("completed", "failed", "cancelled"))).all()
        count = len(jobs)
        for job in jobs:
            db.delete(job)
        db.commit()
        return {"cleared": count}
    finally:
        db.close()


def clear_completed_ai_jobs() -> dict:
    db = SessionLocal()
    try:
        jobs = db.query(AiJob).filter(AiJob.status == "completed").all()
        count = len(jobs)
        for job in jobs:
            db.delete(job)
        db.commit()
        return {"cleared": count}
    finally:
        db.close()


def clear_all_ai_jobs() -> dict:
    db = SessionLocal()
    try:
        jobs = db.query(AiJob).all()
        video_ids = {job.video_id for job in jobs}
        count = len(jobs)
        for job in jobs:
            if job.status == "running":
                job.status = "cancelled"
                job.stage = "cancelled"
                job.message = "Cancelled by clear all"
                job.error = "Cancelled by clear all"
            else:
                db.delete(job)
        if video_ids:
            videos = db.query(Video).filter(Video.id.in_(video_ids)).all()
            for video in videos:
                if video.ai_status in ("queued", "running", "failed", "cancelled"):
                    video.ai_status = "idle"
                    video.ai_stage = None
                    video.ai_error = None
        db.commit()
        return {"cleared": count}
    finally:
        db.close()
