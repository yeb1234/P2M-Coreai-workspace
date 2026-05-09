from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AiJob
from app.schemas import AiJobOut
from app.utils.serialization import load_segments, to_output_url


router = APIRouter(prefix="/api/ai-jobs", tags=["ai-jobs"])


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
