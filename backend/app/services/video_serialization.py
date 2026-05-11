from app.models import AiJob, Video, WatchHistory
from app.schemas import VideoOut
from app.utils.serialization import load_segments, to_output_url


def serialize_video(
    video: Video,
    last_watch: WatchHistory | None = None,
    active_job: AiJob | None = None,
    category_path: str | None = None,
    include_segments: bool = True,
    include_details: bool = True,
) -> VideoOut:
    return VideoOut(
        id=video.id,
        title=video.title,
        filename=video.filename,
        filepath=video.filepath,
        file_size=video.file_size,
        duration=video.duration,
        thumbnail=video.thumbnail,
        tags=video.tags,
        category_id=video.category_id,
        category_path=category_path,
        transcription=video.transcription if include_details else None,
        transcript_segments=load_segments(video.transcript_segments) if include_segments else [],
        summary=video.summary if include_details else None,
        markdown_path=video.markdown_path if include_details else None,
        subtitle_path=video.subtitle_path,
        subtitle_url=to_output_url(video.subtitle_path),
        ai_status=video.ai_status or "idle",
        ai_stage=video.ai_stage,
        ai_error=video.ai_error,
        active_job_id=active_job.id if active_job else None,
        watch_progress=last_watch.progress if last_watch else None,
        completed=bool(last_watch.completed) if last_watch else False,
        is_favorite=bool(video.is_favorite),
        favorited_at=video.favorited_at,
        created_at=video.created_at,
        updated_at=video.updated_at,
    )
