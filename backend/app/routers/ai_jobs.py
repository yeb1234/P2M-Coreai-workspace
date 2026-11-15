from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import AiJob, Note, SubtitleSegment, Video
from app.schemas import AiJobBatchCreate, AiJobBatchOut, AiJobBatchSkippedItem, AiJobListItem, AiJobListOut, AiJobOut
from app.services.ai_jobs import _apply_job_options, _build_job_options
from app.utils.files import unique_suffix
import logging

from app.services.admin_ai_queue import _is_queue_paused, enqueue_ai_jobs
from app.services.ai_job_rules import is_batch_eligible
from app.utils.serialization import load_segments, to_output_url


router = APIRouter(prefix="/api/ai-jobs", tags=["ai-jobs"])


def _job_list_item(job: AiJob) -> AiJobListItem:
    return AiJobListItem(
        id=job.id,
        video_id=job.video_id,
        video_title=job.video.title if job.video else None,
        duration=job.video.duration if job.video else None,
        status=job.status,
        stage=job.stage,
        message=job.message,
        error=job.error,
        whisper_engine=job.whisper_engine,
        whisper_model=job.whisper_model,
        language=job.language,
        do_summary=job.do_summary,
        word_limit=job.word_limit,
        cpu_threads=job.cpu_threads,
        compute_type=job.compute_type,
        device_type=job.device_type,
        subtitle_correction_enabled=job.subtitle_correction_enabled,
        subtitle_correction_scope=job.subtitle_correction_scope,
        started_at=job.started_at,
        subtitle_correction_prompt=job.subtitle_correction_prompt,
        summary_error=job.summary_error,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


@router.get("", response_model=AiJobListOut)
def list_ai_jobs(
    status: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=999999),
    db: Session = Depends(get_db),
    # 任务列表是运维视图：会暴露所有视频标题、失败原因、模型配置。
    # 普通用户不需要看，原来这里**完全没有鉴权**，不登录就能翻。
    _admin=Depends(require_admin),
):
    base_query = db.query(AiJob).outerjoin(Video)
    total_all = base_query.count()

    query = base_query
    if status:
        query = query.filter(AiJob.status == status)
    if status == "queued":
        jobs = query.order_by(AiJob.created_at.asc(), AiJob.id.asc()).limit(limit).all()
    elif status == "running":
        jobs = query.order_by(AiJob.updated_at.desc(), AiJob.created_at.asc()).limit(limit).all()
    elif status:
        jobs = query.order_by(AiJob.updated_at.desc(), AiJob.created_at.desc()).limit(limit).all()
    else:
        status_rank = case(
            (AiJob.status == "running", 0),
            (AiJob.status == "queued", 1),
            (AiJob.status == "failed", 2),
            (AiJob.status == "cancelled", 3),
            (AiJob.status == "completed", 4),
            else_=5,
        )
        jobs = (
            query.order_by(
                status_rank.asc(),
                case((AiJob.status == "queued", AiJob.created_at)).asc(),
                AiJob.updated_at.desc(),
                AiJob.created_at.desc(),
            )
            .limit(limit)
            .all()
        )

    return AiJobListOut(
        items=[_job_list_item(job) for job in jobs],
        total=total_all,
        running=db.query(AiJob).filter(AiJob.status == "running").count(),
        queued=db.query(AiJob).filter(AiJob.status == "queued").count(),
        failed=db.query(AiJob).filter(AiJob.status == "failed").count(),
        completed=db.query(AiJob).filter(AiJob.status == "completed").count(),
    )


def _latest_job_by_video(db: Session, video_ids: list[int]) -> dict[int, AiJob]:
    if not video_ids:
        return {}
    jobs = (
        db.query(AiJob)
        .filter(AiJob.video_id.in_(video_ids))
        .order_by(AiJob.video_id.asc(), AiJob.updated_at.desc(), AiJob.created_at.desc())
        .all()
    )
    latest: dict[int, AiJob] = {}
    for job in jobs:
        if job.video_id not in latest:
            latest[job.video_id] = job
    return latest


def _reset_video_ai_outputs(db: Session, video: Video) -> None:
    video.transcription = None
    video.transcript_segments = None
    video.summary = None
    video.markdown_path = None
    video.subtitle_path = None
    video.ai_status = "idle"
    video.ai_stage = None
    video.ai_error = None
    db.query(SubtitleSegment).filter(SubtitleSegment.video_id == video.id).delete()


def _prepare_force_rerun(db: Session, video: Video) -> None:
    _reset_video_ai_outputs(db, video)
    jobs = db.query(AiJob).filter(AiJob.video_id == video.id).all()
    for job in jobs:
        if job.status == "running":
            job.status = "cancelled"
            job.stage = "cancelled"
            job.message = "Cancelled by force rerun"
            job.error = "Cancelled by force rerun"
            continue
        db.delete(job)
    notes = db.query(Note).filter(Note.video_id == video.id, Note.source == "ai").all()
    for note in notes:
        note.content = ""
        note.markdown_path = None


@router.post("/batch", response_model=AiJobBatchOut)
def batch_ai_jobs(
    payload: AiJobBatchCreate,
    db: Session = Depends(get_db),
    # 转写是重资源操作：一次批量能把 CPU 吃满几小时。
    # 不鉴权等于让任何能访问站点的人给你的机器排满 whisper 任务。
    _admin=Depends(require_admin),
):
    unique_ids = list(dict.fromkeys(payload.video_ids))
    videos = db.query(Video).filter(Video.id.in_(unique_ids)).all()
    video_by_id = {video.id: video for video in videos}
    latest_jobs = _latest_job_by_video(db, unique_ids)

    eligible: list[Video] = []
    skipped_items: list[AiJobBatchSkippedItem] = []
    active = 0
    already_done = 0
    failed = 0

    for video_id in unique_ids:
        video = video_by_id.get(video_id)
        if not video:
            skipped_items.append(AiJobBatchSkippedItem(video_id=video_id, title=f"#{video_id}", reason="missing_video"))
            continue

        latest_job = latest_jobs.get(video_id)
        force_rerun = payload.mode == "all"
        if latest_job and latest_job.status in ("queued", "running") and force_rerun:
            active += 1

        eligible_for_mode, skip_reason = is_batch_eligible(video, latest_job, payload)
        if not eligible_for_mode:
            if skip_reason == "active_job":
                active += 1
            if skip_reason in {"complete", "has_subtitles", "has_summary"}:
                already_done += 1
            skipped_items.append(AiJobBatchSkippedItem(video_id=video.id, title=video.title, reason=skip_reason or "skipped"))
            continue
        if latest_job and latest_job.status == "failed":
            failed += 1

        eligible.append(video)

    selected = eligible[: payload.max_enqueue]
    limited = len(eligible) > len(selected)
    job_ids: list[str] = []
    if not payload.dry_run:
        options = _build_job_options(
            whisper_model=payload.whisper_model,
            whisper_engine=payload.whisper_engine,
            language=payload.language,
            do_summary=payload.do_summary,
            word_limit=payload.word_limit,
            ollama_model=payload.ollama_model,
            cpu_threads=payload.cpu_threads,
            compute_type=payload.compute_type,
            beam_size=payload.beam_size,
            best_of=payload.best_of,
            temperature=payload.temperature,
            vad_filter=payload.vad_filter,
            device_type=payload.device_type,
            subtitle_correction_enabled=payload.subtitle_correction_enabled,
            subtitle_correction_scope=payload.subtitle_correction_scope,
            subtitle_correction_prompt=payload.subtitle_correction_prompt,
        )
        for video in selected:
            if payload.mode == "all":
                _prepare_force_rerun(db, video)
            job = AiJob(
                id=unique_suffix(),
                video_id=video.id,
                status="queued",
                stage="queued",
                message="Queued for processing",
            )
            _apply_job_options(job, options)
            db.add(job)
            video.ai_status = "queued"
            video.ai_stage = "queued"
            video.ai_error = None
            job_ids.append(job.id)
        db.commit()
        if not _is_queue_paused():
            try:
                enqueue_ai_jobs(job_ids)
            except Exception:
                logging.getLogger(__name__).exception("Failed to enqueue jobs to RQ")
        else:
            # Queue is paused; jobs are queued in DB only and will be pushed
            # to RQ when resume is called.
            logging.getLogger(__name__).info("Queue is paused; %d jobs queued in DB only", len(job_ids))

    return AiJobBatchOut(
        mode=payload.mode,
        requested=len(unique_ids),
        eligible=len(eligible),
        enqueued=0 if payload.dry_run else len(job_ids),
        skipped=len(unique_ids) - len(eligible),
        active=active,
        already_done=already_done,
        failed=failed,
        limited=limited,
        max_enqueue=payload.max_enqueue,
        job_ids=job_ids,
        skipped_items=skipped_items[:20],
    )


@router.get("/{job_id}", response_model=AiJobOut)
def get_ai_job(
    job_id: str,
    db: Session = Depends(get_db),
    # 前端转写进度轮询走这里，所以不要求 admin；但必须登录，
    # 原来匿名就能查，等于把任务 id 当公开资源。
    _user=Depends(get_current_user),
):
    job = db.query(AiJob).filter(AiJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return AiJobOut(
        id=job.id,
        video_id=job.video_id,
        status=job.status,
        stage=job.stage,
        message=job.message,
        error=job.error,
        whisper_engine=job.whisper_engine,
        whisper_model=job.whisper_model,
        language=job.language,
        do_summary=job.do_summary,
        word_limit=job.word_limit,
        ollama_model=job.ollama_model,
        transcript=job.transcript,
        transcript_segments=load_segments(job.transcript_segments),
        subtitle_correction_scope=job.subtitle_correction_scope,
        summary=job.summary,
        summary_error=job.summary_error,
        markdown_path=job.markdown_path,
        subtitle_path=job.subtitle_path,
        subtitle_url=to_output_url(job.subtitle_path),
        created_at=job.created_at,
        updated_at=job.updated_at,
    )
