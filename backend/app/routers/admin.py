from fastapi import APIRouter

from app.database import SessionLocal
from app.models import AiJob, Video
from app.schemas import RescanOut
from app.services.file_scanner import generate_missing_thumbnails, scan_video_library


router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/rescan", response_model=RescanOut)
def rescan_library():
    result = scan_video_library()
    generate_missing_thumbnails(limit=3)
    return RescanOut(**result)


@router.post("/ai-jobs/clear-active")
def clear_active_ai_jobs():
    db = SessionLocal()
    try:
        jobs = db.query(AiJob).filter(AiJob.status.in_(("queued", "running"))).all()
        video_ids = {job.video_id for job in jobs}
        for job in jobs:
            job.status = "failed"
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
