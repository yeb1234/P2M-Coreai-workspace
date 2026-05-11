from typing import Protocol


class VideoLike(Protocol):
    subtitle_path: str | None
    transcript_segments: str | None
    summary: str | None


class JobLike(Protocol):
    status: str
    summary: str | None


class BatchPayloadLike(Protocol):
    mode: str


def has_subtitles(video: VideoLike) -> bool:
    return bool(video.subtitle_path or video.transcript_segments)


def has_summary(video: VideoLike, latest_job: JobLike | None = None) -> bool:
    video_summary = bool(video.summary and video.summary.strip())
    job_summary = bool(latest_job and latest_job.summary and latest_job.summary.strip())
    return video_summary or job_summary


def is_ai_complete(video: VideoLike, latest_job: JobLike | None = None) -> bool:
    return has_subtitles(video) and has_summary(video, latest_job)


def is_batch_eligible(video: VideoLike, latest_job: JobLike | None, payload: BatchPayloadLike) -> tuple[bool, str | None]:
    video_has_subtitles = has_subtitles(video)
    video_has_summary = has_summary(video, latest_job)
    ai_complete = video_has_subtitles and video_has_summary

    if payload.mode == "all":
        return True, None

    if latest_job and latest_job.status in ("queued", "running"):
        return False, "active_job"

    if payload.mode == "unfinished":
        if ai_complete:
            return False, "complete"
        if latest_job and latest_job.status in ("failed", "cancelled"):
            return True, None
        if not video_has_subtitles:
            return True, None
        if not video_has_summary:
            return True, None
        if latest_job and latest_job.status != "completed":
            return True, None
        return False, "complete"

    if payload.mode == "missing_subtitles":
        if video_has_subtitles:
            return False, "has_subtitles"
        return True, None

    if payload.mode == "missing_summary":
        if not video_has_subtitles:
            return False, "no_subtitles"
        if video_has_summary:
            return False, "has_summary"
        return True, None

    if payload.mode == "failed_only":
        if latest_job and latest_job.status == "failed":
            return True, None
        return False, "not_failed"

    return False, "unknown_mode"
