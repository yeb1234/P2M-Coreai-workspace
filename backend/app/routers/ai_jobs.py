from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AiJob, Video
from app.schemas import AiJobListItem, AiJobListOut, AiJobOut
from app.utils.serialization import load_segments, to_output_url


router = APIRouter(prefix="/api/ai-jobs", tags=["ai-jobs"])


def _job_list_item(job: AiJob) -> AiJobListItem:
    return AiJobListItem(
        id=job.id,
        video_id=job.video_id,
        video_title=job.video.title if job.video else None,
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
        subtitle_correction_enabled=job.subtitle_correction_enabled,
        summary_error=job.summary_error,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


@router.get("", response_model=AiJobListOut)
def list_ai_jobs(
    status: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    query = db.query(AiJob).outerjoin(Video)
    if status:
        query = query.filter(AiJob.status == status)

    total = query.count()
    jobs = query.order_by(AiJob.updated_at.desc(), AiJob.created_at.desc()).limit(limit).all()

    return AiJobListOut(
        items=[_job_list_item(job) for job in jobs],
        total=total,
        running=db.query(AiJob).filter(AiJob.status == "running").count(),
        queued=db.query(AiJob).filter(AiJob.status == "queued").count(),
        failed=db.query(AiJob).filter(AiJob.status == "failed").count(),
        completed=db.query(AiJob).filter(AiJob.status == "completed").count(),
    )


@router.get("/{job_id}", response_model=AiJobOut)
def get_ai_job(job_id: str, db: Session = Depends(get_db)):
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
        summary=job.summary,
        summary_error=job.summary_error,
        markdown_path=job.markdown_path,
        subtitle_path=job.subtitle_path,
        subtitle_url=to_output_url(job.subtitle_path),
        created_at=job.created_at,
        updated_at=job.updated_at,
    )
