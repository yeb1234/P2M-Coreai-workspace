"""RQ task functions for AI job execution.

Each job runs in a standalone process (or thread depending on the worker
class) so a kill-horse command can force-stop even in-process engines like
faster-whisper.
"""

from __future__ import annotations

import logging
import os
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
    write_markdown_output,
)
from app.services.rq_client import clear_job_cancelled, is_job_cancelled
from app.utils.serialization import load_segments

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
    # 用 job_id 当 request_id：一次转写会打十几条日志，
    # 有了这个就能 grep 一个 id 看完整过程（和 HTTP 请求同一套字段）
    from app.core.observability import bind_request_id

    bind_request_id(f"job-{job_id}"[:64])

    db = SessionLocal()
    try:
        job = db.query(AiJob).filter(AiJob.id == job_id).first()
        if not job:
            logger.warning("Job %s not found in DB, skipping", job_id)
            return

        # 兜底路由：台式机 worker 只消费 ai_jobs，如果历史配置或旧队列
        # 把 summary_only 任务误投进来，不在这里跑 LLM，也不改 DB 状态；
        # 保持 queued，交给 audio-prep 的池刷新按 summary_only 重新投到
        # summary_jobs。否则台式机会和笔记本重复做同一批总结。
        queues_mode = (os.getenv("WORKER_QUEUES") or "").strip().lower().replace(" ", "")
        if job.summary_only and queues_mode == "ai_jobs":
            logger.warning(
                "summary_only job=%s landed in ai_jobs; leave queued for summary_jobs reload",
                job_id,
            )
            return

        video = db.query(Video).filter(Video.id == job.video_id).first()
        if not video:
            _mark_failed(db, job, "Video not found")
            return

        # 「只补总结」不能重新抽音频跑 Whisper：库里已有字幕的视频，
        # 直接拿 transcription/transcript_segments 做总结。
        # 这条分支在 source 文件不存在时也能走通 —— 数据库里已有字幕，
        # 不该因为源视频被移走就丢掉总结能力。
        existing_text = (video.transcription or "").strip()
        existing_segments = load_segments(video.transcript_segments)
        if not existing_text and existing_segments:
            existing_text = "\n".join(
                (segment.get("text") or "").strip() for segment in existing_segments
            ).strip()

        if job.summary_only and existing_text and existing_segments:
            paths = _build_job_paths(video, job)
            summary = video.summary if (video.summary and video.summary.strip()) else None
            summary_error = None
            if job.do_summary and not summary:
                summary, summary_error = _step_summarize(
                    db, job, video, existing_text
                )
                if not (summary and summary.strip()):
                    # 以前这里继续写文件并把 job 标成 completed，监控看到
                    # “Processing complete”，但 videos.summary 是空的，
                    # 全库完成度永远上不去。总结没产出就是失败，不能伪成功。
                    _mark_failed(
                        db,
                        job,
                        summary_error or "总结为空，未写入视频总结",
                        stage="summarizing",
                    )
                    return
            _step_write_outputs(
                db, job, video, paths, existing_text, existing_segments, summary, summary_error
            )
            _finalize_job(db, job, video, paths, existing_text, existing_segments, summary, summary_error)
            return

        paths = _build_job_paths(video, job)
        if not paths.source.exists():
            _mark_failed(db, job, "Video file does not exist")
            return

        # 如果视频已经有完整的转录结果，跳过「提取音频 + 转写」这两步，
        # 但仍要检查总结 —— 有字幕无总结时用户点「生成」，以前这里直接
        # 标记完成，summary 永远是空的，用户看到「缺总结」却怎么都补不上。
        if _video_has_transcription_outputs(video):
            summary = video.summary
            summary_error = None
            if job.do_summary and not (summary and summary.strip()):
                # 字幕已在库里，直接拿转录文本补一次总结，不重跑 whisper
                job.status = "running"
                job.stage = "summarizing"
                db.commit()
                summary, summary_error = _step_summarize(
                    db, job, video, video.transcription or ""
                )
                if not (summary and summary.strip()):
                    _mark_failed(
                        db,
                        job,
                        summary_error or "总结为空，未写入视频总结",
                        stage="summarizing",
                    )
                    return
                if summary:
                    video.summary = summary
                    # markdown 里也补上总结段，保持笔记文件与库一致
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
                                subtitle_filename=Path(video.subtitle_path).name if video.subtitle_path else "",
                                summary_error=summary_error,
                            )
                    except Exception as exc:
                        logger.warning("补写总结到 markdown 失败 video=%s: %s", video.id, exc)

            job.status = "completed"
            job.stage = "completed"
            job.message = (
                "Skipped transcription; summary generated from existing transcript"
                if summary else "Skipped — video already has transcription"
            )
            job.transcript = video.transcription
            job.transcript_segments = video.transcript_segments
            job.summary = summary
            job.summary_error = summary_error
            job.markdown_path = video.markdown_path
            job.subtitle_path = video.subtitle_path
            video.ai_status = "completed"
            video.ai_stage = "completed"
            video.ai_error = summary_error if summary_error and not summary else None
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


def _mark_failed(db, job: AiJob, error: str, stage: str = "missing-video") -> None:
    """标记任务失败，并同步视频上的冗余状态字段。

    为什么必须同步 Video：create_ai_job 已经把 video.ai_status 设成
    「queued」，而前端轮询的是视频列表/详情里的 ai_status（不是 job 列表）。
    原来这里只改 job，于是视频文件被移走 / 外接盘没挂载时：

        job 列表里：failed
        视频详情里：正在排队…   ← 永远

    用户只能反复点重试，而每一次都立刻失败。
    """
    job.status = "failed"
    job.stage = stage
    job.error = error

    video = db.query(Video).filter(Video.id == job.video_id).first()
    if video is not None:
        # 只有「这个视频没有别的活跃任务」时才改视频状态，
        # 否则会把刚提交的新任务状态覆盖成 failed。
        other_active = (
            db.query(AiJob.id)
            .filter(
                AiJob.video_id == job.video_id,
                AiJob.id != job.id,
                AiJob.status.in_(("queued", "running")),
            )
            .first()
        )
        if other_active is None:
            video.ai_status = "failed"
            video.ai_stage = stage
            video.ai_error = (error or "")[:2000] or None

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
