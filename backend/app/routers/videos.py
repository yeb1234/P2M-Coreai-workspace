import json
import math
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AiJob, Category, SubtitleSegment, Video, WatchHistory
from app.schemas import (
    AiJobCreate,
    NoteOut,
    SegmentSearchResult,
    SubtitleSegmentOut,
    VideoOut,
    VideoPage,
    WatchHistoryIn,
)
from app.services.ai_jobs import create_ai_job, ensure_video_note
from app.services.sprite import get_or_generate_sprite, get_sprite_meta_path, get_sprite_path, has_sprite
from app.utils.serialization import load_segments, to_output_url


router = APIRouter(prefix="/api/videos", tags=["videos"])


def active_job_map(db: Session, video_ids: list[int]) -> dict[int, AiJob]:
    if not video_ids:
        return {}

    jobs = (
        db.query(AiJob)
        .filter(AiJob.video_id.in_(video_ids), AiJob.status.in_(("queued", "running")))
        .order_by(AiJob.created_at.desc())
        .all()
    )
    result = {}
    for job in jobs:
        if job.video_id not in result:
            result[job.video_id] = job
    return result


def serialize_video(
    video: Video,
    last_watch: WatchHistory | None = None,
    active_job: AiJob | None = None,
    category_path: str | None = None,
    include_segments: bool = True,
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
        transcription=video.transcription,
        transcript_segments=load_segments(video.transcript_segments) if include_segments else [],
        summary=video.summary,
        markdown_path=video.markdown_path,
        subtitle_path=video.subtitle_path,
        subtitle_url=to_output_url(video.subtitle_path),
        ai_status=video.ai_status or "idle",
        ai_stage=video.ai_stage,
        ai_error=video.ai_error,
        active_job_id=active_job.id if active_job else None,
        watch_progress=last_watch.progress if last_watch else None,
        completed=bool(last_watch.completed) if last_watch else False,
        created_at=video.created_at,
        updated_at=video.updated_at,
    )


def latest_watch_map(db: Session, video_ids: list[int]) -> dict[int, WatchHistory]:
    if not video_ids:
        return {}

    latest_rows = (
        db.query(WatchHistory.video_id, func.max(WatchHistory.watched_at).label("max_watched_at"))
        .filter(WatchHistory.video_id.in_(video_ids))
        .group_by(WatchHistory.video_id)
        .subquery()
    )
    histories = (
        db.query(WatchHistory)
        .join(
            latest_rows,
            (WatchHistory.video_id == latest_rows.c.video_id)
            & (WatchHistory.watched_at == latest_rows.c.max_watched_at),
        )
        .all()
    )
    return {history.video_id: history for history in histories}


def fts_segment_rows(db: Session, query_text: str, limit: int):
    try:
        return db.execute(
            text(
                """
                SELECT s.id, s.video_id, s.segment_index, s.start_sec, s.end_sec, s.text,
                       v.title, v.category_id, v.subtitle_path
                FROM subtitle_segments_fts f
                JOIN subtitle_segments s ON s.id = f.rowid
                JOIN videos v ON v.id = s.video_id
                WHERE subtitle_segments_fts MATCH :query_text
                ORDER BY bm25(subtitle_segments_fts)
                LIMIT :limit
                """
            ),
            {"query_text": query_text, "limit": limit * 3},
        ).fetchall()
    except Exception:
        return []


@router.get("/search/segments", response_model=list[SegmentSearchResult])
def search_segments(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    keywords = [part.strip().lower() for part in q.split() if part.strip()]
    if not keywords:
        keywords = [q.strip().lower()]

    results = []
    fts_rows = fts_segment_rows(db, q.strip(), limit)
    if fts_rows:
        for row in fts_rows:
            text_lower = (row.text or "").lower()
            score_hint = sum(1 for keyword in keywords if keyword in text_lower) or 0.5
            results.append(
                SegmentSearchResult(
                    video_id=row.video_id,
                    video_title=row.title,
                    category_id=row.category_id,
                    start_sec=row.start_sec,
                    end_sec=row.end_sec,
                    text=row.text,
                    subtitle_url=to_output_url(row.subtitle_path),
                    score_hint=score_hint,
                )
            )
        results.sort(key=lambda item: item.score_hint, reverse=True)
        return results[:limit]

    filters = [SubtitleSegment.text.contains(keyword) for keyword in keywords]
    rows = (
        db.query(SubtitleSegment, Video)
        .join(Video, Video.id == SubtitleSegment.video_id)
        .filter(or_(*filters))
        .limit(limit * 3)
        .all()
    )

    if not rows:
        rows = (
            db.query(SubtitleSegment, Video)
            .join(Video, Video.id == SubtitleSegment.video_id)
            .limit(limit * 3)
            .all()
        )

    for segment, video in rows:
        text_lower = segment.text.lower()
        score_hint = sum(1 for keyword in keywords if keyword in text_lower)
        if score_hint == 0:
            score_hint = 0.1
        results.append(
            SegmentSearchResult(
                video_id=video.id,
                video_title=video.title,
                category_id=video.category_id,
                start_sec=segment.start_sec,
                end_sec=segment.end_sec,
                text=segment.text,
                subtitle_url=to_output_url(video.subtitle_path),
                score_hint=score_hint,
            )
        )

    results.sort(key=lambda item: item.score_hint, reverse=True)
    return results[:limit]


@router.get("", response_model=VideoPage)
def get_videos(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    category_id: int | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(Video)
    if category_id:
        query = query.filter(Video.category_id == category_id)
    if search:
        query = query.filter(Video.title.contains(search))

    total = query.count()
    offset = (page - 1) * page_size
    selected = (
        query.order_by(Video.sort_key.asc().nullslast(), Video.id.asc())
        .offset(offset)
        .limit(page_size)
        .all()
    )
    watch_map = latest_watch_map(db, [item.id for item in selected])
    job_map = active_job_map(db, [item.id for item in selected])
    category_ids = {item.category_id for item in selected if item.category_id}
    category_map = {c.id: c.path for c in db.query(Category).filter(Category.id.in_(category_ids)).all()} if category_ids else {}
    return VideoPage(
        items=[
            serialize_video(
                item,
                watch_map.get(item.id),
                job_map.get(item.id),
                category_map.get(item.category_id),
                include_segments=False,
            )
            for item in selected
        ],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total else 0,
    )


@router.get("/continue/last", response_model=VideoOut)
def get_continue_video(db: Session = Depends(get_db)):
    history = (
        db.query(WatchHistory)
        .filter(WatchHistory.completed.is_(False), WatchHistory.progress > 5)
        .order_by(WatchHistory.watched_at.desc())
        .first()
    )
    if not history:
        raise HTTPException(status_code=404, detail="No unfinished video")
    video = db.query(Video).filter(Video.id == history.video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    job_map = active_job_map(db, [video.id])
    category_path = None
    if video.category_id:
        category = db.query(Category).filter(Category.id == video.category_id).first()
        category_path = category.path if category else None
    return serialize_video(video, history, job_map.get(video.id), category_path)


@router.get("/history/recent", response_model=list[VideoOut])
def get_recent_history(
    limit: int = Query(8, ge=1, le=30),
    db: Session = Depends(get_db),
):
    latest_rows = (
        db.query(WatchHistory.video_id, func.max(WatchHistory.watched_at).label("max_watched_at"))
        .group_by(WatchHistory.video_id)
        .subquery()
    )
    histories = (
        db.query(WatchHistory)
        .join(
            latest_rows,
            (WatchHistory.video_id == latest_rows.c.video_id)
            & (WatchHistory.watched_at == latest_rows.c.max_watched_at),
        )
        .order_by(WatchHistory.watched_at.desc())
        .limit(limit)
        .all()
    )
    if not histories:
        return []

    video_ids = [history.video_id for history in histories]
    videos = {video.id: video for video in db.query(Video).filter(Video.id.in_(video_ids)).all()}
    job_map = active_job_map(db, video_ids)
    category_ids = {video.category_id for video in videos.values() if video.category_id}
    categories = {c.id: c.path for c in db.query(Category).filter(Category.id.in_(category_ids)).all()} if category_ids else {}
    result = []
    for history in histories:
        video = videos.get(history.video_id)
        if not video:
            continue
        result.append(serialize_video(video, history, job_map.get(video.id), categories.get(video.category_id)))
    return result


@router.get("/recent", response_model=list[VideoOut])
def get_recent_videos(
    limit: int = Query(8, ge=1, le=30),
    category_id: int | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(Video)
    if category_id:
        query = query.filter(Video.category_id == category_id)

    videos = query.order_by(Video.created_at.desc(), Video.id.desc()).limit(limit).all()
    if not videos:
        return []

    video_ids = [video.id for video in videos]
    watch_map = latest_watch_map(db, video_ids)
    job_map = active_job_map(db, video_ids)
    category_ids = {video.category_id for video in videos if video.category_id}
    categories = {c.id: c.path for c in db.query(Category).filter(Category.id.in_(category_ids)).all()} if category_ids else {}
    return [
        serialize_video(video, watch_map.get(video.id), job_map.get(video.id), categories.get(video.category_id), include_segments=False)
        for video in videos
    ]


@router.get("/{video_id}", response_model=VideoOut)
def get_video(video_id: int, db: Session = Depends(get_db)):
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    watch_map = latest_watch_map(db, [video.id])
    job_map = active_job_map(db, [video.id])
    category_path = None
    if video.category_id:
        category = db.query(Category).filter(Category.id == video.category_id).first()
        category_path = category.path if category else None
    return serialize_video(video, watch_map.get(video.id), job_map.get(video.id), category_path)


def iter_file_range(path: Path, start: int, end: int, chunk_size: int = 1024 * 1024):
    with path.open("rb") as file:
      file.seek(start)
      remaining = end - start + 1
      while remaining > 0:
          chunk = file.read(min(chunk_size, remaining))
          if not chunk:
              break
          remaining -= len(chunk)
          yield chunk


@router.get("/{video_id}/file")
def stream_video(video_id: int, request: Request, db: Session = Depends(get_db)):
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    video_path = Path(video.filepath)
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")

    file_size = video_path.stat().st_size
    range_header = request.headers.get("range")
    headers = {
        "Accept-Ranges": "bytes",
    }

    if not range_header:
        headers["Content-Length"] = str(file_size)
        return FileResponse(video_path, media_type="video/mp4", filename=video.filename, headers=headers)

    try:
        unit, range_value = range_header.strip().split("=", 1)
        if unit != "bytes":
            raise ValueError
        start_text, end_text = range_value.split("-", 1)
        if start_text:
            start = int(start_text)
            end = int(end_text) if end_text else file_size - 1
        else:
            suffix_length = int(end_text)
            start = max(file_size - suffix_length, 0)
            end = file_size - 1
        if start < 0 or end >= file_size or start > end:
            raise ValueError
    except ValueError:
        return StreamingResponse(
            iter(()),
            status_code=416,
            headers={**headers, "Content-Range": f"bytes */{file_size}"},
            media_type="video/mp4",
        )

    headers.update({
        "Content-Length": str(end - start + 1),
        "Content-Range": f"bytes {start}-{end}/{file_size}",
    })
    return StreamingResponse(
        iter_file_range(video_path, start, end),
        status_code=206,
        headers=headers,
        media_type="video/mp4",
    )


@router.get("/{video_id}/thumbnail")
def get_thumbnail(video_id: int, db: Session = Depends(get_db)):
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    if not video.thumbnail or not Path(video.thumbnail).exists():
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(video.thumbnail, media_type="image/jpeg")


@router.post("/history")
def save_watch_history(payload: WatchHistoryIn, db: Session = Depends(get_db)):
    video = db.query(Video).filter(Video.id == payload.video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    if not video.duration and payload.duration:
        video.duration = payload.duration

    completed = bool(payload.duration and payload.progress / payload.duration >= 0.9)
    history = WatchHistory(
        video_id=payload.video_id,
        progress=payload.progress,
        duration=payload.duration,
        completed=completed,
    )
    db.add(history)
    db.commit()
    return {"status": "ok", "completed": completed}


@router.post("/{video_id}/ai-jobs")
def start_ai_job(video_id: int, payload: AiJobCreate, db: Session = Depends(get_db)):
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    job = create_ai_job(
        video_id=video_id,
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
        subtitle_correction_enabled=payload.subtitle_correction_enabled,
        subtitle_correction_prompt=payload.subtitle_correction_prompt,
    )
    return {"job_id": job.id, "status": job.status, "stage": job.stage}


@router.get("/{video_id}/playlist")
def get_playlist(video_id: int, db: Session = Depends(get_db)):
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    query = db.query(Video)
    if video.category_id:
        query = query.filter(Video.category_id == video.category_id)
    videos = query.order_by(Video.sort_key.asc().nullslast(), Video.id.asc()).all()
    watch_map = latest_watch_map(db, [item.id for item in videos])

    items = []
    current_index = 0
    category_path = None
    if video.category_id:
        category = db.query(Category).filter(Category.id == video.category_id).first()
        category_path = category.path if category else None
    for index, item in enumerate(videos):
        last_watch = watch_map.get(item.id)
        if item.id == video_id:
            current_index = index
        items.append(
            {
                "id": item.id,
                "title": item.title,
                "thumbnail": item.thumbnail,
                "category_path": category_path if item.id == video_id else (db.query(Category).filter(Category.id == item.category_id).first().path if item.category_id else None),
                "watch_progress": last_watch.progress if last_watch else None,
                "completed": bool(last_watch.completed) if last_watch else False,
                "subtitle_url": to_output_url(item.subtitle_path),
            }
        )
    return {"videos": items, "current_index": current_index, "total": len(items)}


@router.get("/{video_id}/notes", response_model=NoteOut)
def get_video_note(video_id: int, db: Session = Depends(get_db)):
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    note = ensure_video_note(db, video)
    if note.markdown_path:
        note_path = Path(note.markdown_path)
        if note_path.exists():
            note.content = note_path.read_text(encoding="utf-8")
            db.commit()
            db.refresh(note)
    return note


@router.get("/{video_id}/subtitle")
def get_subtitle_file(video_id: int, db: Session = Depends(get_db)):
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video or not video.subtitle_path:
        raise HTTPException(status_code=404, detail="Subtitle not found")
    subtitle_file = Path(video.subtitle_path)
    if not subtitle_file.exists():
        raise HTTPException(status_code=404, detail="Subtitle file missing")
    return FileResponse(subtitle_file, media_type="text/vtt", filename=subtitle_file.name)


@router.get("/{video_id}/segments", response_model=list[SubtitleSegmentOut])
def get_video_segments(video_id: int, db: Session = Depends(get_db)):
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    return (
        db.query(SubtitleSegment)
        .filter(SubtitleSegment.video_id == video_id)
        .order_by(SubtitleSegment.segment_index)
        .all()
    )


@router.get("/{video_id}/sprite")
def get_sprite_sheet(video_id: int, db: Session = Depends(get_db)):
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    if not Path(video.filepath).exists():
        raise HTTPException(status_code=404, detail="Video file not found")

    sprite_path = get_sprite_path(video_id)
    if not has_sprite(video_id):
        meta = get_or_generate_sprite(video.filepath, video_id)
        if not meta:
            raise HTTPException(status_code=500, detail="Sprite generation failed")
    else:
        meta_path = get_sprite_meta_path(video_id)
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            meta = None

    if not sprite_path.exists():
        raise HTTPException(status_code=404, detail="Sprite not found")

    return FileResponse(sprite_path, media_type="image/jpeg", headers={
        "X-Sprite-Meta": json.dumps(meta) if meta else "{}",
        "Cache-Control": "public, max-age=86400",
    })
