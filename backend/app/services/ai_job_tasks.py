"""RQ task functions for AI job execution.

Each job runs in a standalone process (or thread depending on the worker
class) so a kill-horse command can force-stop even in-process engines like
faster-whisper.
"""

from __future__ import annotations

import logging
from datetime import datetime

from app.database import SessionLocal
from app.models import AiJob, Video
from app.services.ai_jobs import (
    _build_job_paths,
    _finalize_job,
    _handle_job_failure,
    _step_correct_subtitles,
    _step_extract_audio,
    _step_summarize,
    _step_transcribe,
    _step_write_outputs,
    _video_has_transcription_outputs,
)
from app.services.rq_client import clear_job_cancelled, is_job_cancelled

logger = logging.getLogger(__name__)


def _enqueue_chunk_index(video_id: int) -> None:
    """转写完成后把「建块 + 向量化」投递出去。

    为什么必须在这里挂钩：建块和向量化原来是两个人工脚本，
    转写流程结束后什么都不做。后果是「新转写的视频在检索里搜不到」，
    而且没有任何异常信号 —— 用户只会觉得搜不准。

    投递失败不能影响转写结果：转写本身已经写盘完成了，
    索引还有定时扫描兜底（embedding_pipeline.scan_missing），
    所以这里只记日志。
    """
    try:
        from app.services.background_tasks import enqueue_task

        task_id = enqueue_task("chunk_index", target_id=str(video_id))
        if task_id:
            logger.info("已投递索引任务 video=%s task=%s", video_id, task_id)
    except Exception:  # noqa: BLE001
        logger.warning("投递索引任务失败 video=%s（扫描会补上）", video_id, exc_info=True)


def run_ai_job_task(job_id: str) -> None:
    """RQ task entry point: execute a single AI job end-to-end."""
    db = SessionLocal()
    try:
        job = db.query(AiJob).filter(AiJob.id == job_id).first()
        if not job:
            logger.warning("Job %s not found in DB, skipping", job_id)
            return

        video = db.query(Video).filter(Video.id == job.video_id).first()
        if not video:
            _mark_failed(db, job, "Video not found")
            return

        paths = _build_job_paths(video, job)
        if not paths.source.exists():
            _mark_failed(db, job, "Video file does not exist")
            return

        # 如果视频已经有完整的转录结果，直接标记完成，避免重复处理
        if _video_has_transcription_outputs(video):
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
            db.commit()
            # 已有转写说明早就有字幕了，但可能从没建过块（历史遗留）
            _enqueue_chunk_index(video.id)
            return

        # Claim the job
        job.status = "running"
        job.stage = "claimed"
        job.message = "Worker claimed job"
        job.started_at = datetime.now()
        job.updated_at = datetime.now()
        video.ai_status = "running"
        video.ai_stage = "claimed"
        video.ai_error = None
        db.commit()

        # Execute pipeline
        _step_extract_audio(db, job, video, paths, job_id)
        if is_job_cancelled(job_id):
            raise RuntimeError("Job cancelled")

        transcript, segments = _step_transcribe(db, job, video, paths, job_id)
        if is_job_cancelled(job_id):
            raise RuntimeError("Job cancelled")

        transcript, segments, correction_error = _step_correct_subtitles(
            db, job, video, transcript, segments
        )
        if correction_error:
            job.error = correction_error
            db.commit()
        if is_job_cancelled(job_id):
            raise RuntimeError("Job cancelled")

        summary, summary_error = _step_summarize(db, job, video, transcript)
        if is_job_cancelled(job_id):
            raise RuntimeError("Job cancelled")

        _step_write_outputs(db, job, video, paths, transcript, segments, summary, summary_error)
        if is_job_cancelled(job_id):
            raise RuntimeError("Job cancelled")

        _finalize_job(db, job, video, paths, transcript, segments, summary, summary_error)
        # 转写产物已落库，接着把检索用的块和向量补上
        _enqueue_chunk_index(video.id)

    except Exception as exc:
        _handle_job_failure(db, job_id, exc)
    finally:
        clear_job_cancelled(job_id)
        _cleanup_wav(job_id)
        db.close()


def _mark_failed(db, job: AiJob, error: str) -> None:
    job.status = "failed"
    job.stage = "missing-video"
    job.error = error
    db.commit()


def _cleanup_wav(job_id: str) -> None:
    """Remove temporary wav file if it exists."""
    db = SessionLocal()
    try:
        job = db.query(AiJob).filter(AiJob.id == job_id).first()
        if not job:
            return
        video = db.query(Video).filter(Video.id == job.video_id).first()
        if not video:
            return
        paths = _build_job_paths(video, job)
        if paths.wav.exists():
            try:
                paths.wav.unlink()
            except OSError:
                pass
    finally:
        db.close()
