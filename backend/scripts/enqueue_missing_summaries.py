"""把「已有字幕、没有总结」的视频批量投递到笔记本 summary worker。

只补总结，不重新抽音频、不重跑 Whisper：
- 选择 subtitle_path / transcript_segments 非空、summary 为空的视频；
- 跳过本视频已有 queued/running 的 summary_only 任务，避免重复入队；
- 任务写进 ai_jobs（summary_only=true），再直接投递到 RQ 的 summary_jobs；
- 不碰 ai_jobs 里的转写队列。

用法（在 backend 容器内执行）：
    python scripts/enqueue_missing_summaries.py --dry-run
    python scripts/enqueue_missing_summaries.py --limit 1 --video-id 50095
    python scripts/enqueue_missing_summaries.py --limit 999999
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal
from app.models import AiJob, Video
from app.services.rq_client import compute_job_timeout, get_redis_connection
from app.utils.files import unique_suffix

from rq import Queue


def has_subtitles(video: Video) -> bool:
    return bool((video.subtitle_path or "").strip() or (video.transcript_segments or "").strip())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=999999)
    parser.add_argument("--video-id", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        query = (
            db.query(Video)
            .filter(Video.summary.is_(None) | (Video.summary == ""))
            .filter((Video.subtitle_path.isnot(None) & (Video.subtitle_path != ""))
                    | (Video.transcript_segments.isnot(None) & (Video.transcript_segments != "")))
        )
        if args.video_id is not None:
            query = query.filter(Video.id == args.video_id)
        videos = query.order_by(Video.id).limit(args.limit).all()

        active_ids = {
            row[0]
            for row in db.query(AiJob.video_id)
            .filter(AiJob.summary_only.is_(True), AiJob.status.in_(("queued", "running")))
            .all()
        }
        selected = [v for v in videos if v.id not in active_ids and has_subtitles(v)]

        print(f"candidates={len(videos)} active_summary_jobs={len(active_ids)} selected={len(selected)}")
        if args.dry_run or not selected:
            for v in selected[:5]:
                print(f"  #{v.id} {v.title[:60]}")
            return 0

        jobs: list[tuple[AiJob, int]] = []
        for video in selected:
            job = AiJob(
                id=unique_suffix(),
                video_id=video.id,
                status="queued",
                stage="queued",
                message="Queued for summary-only processing",
                summary_only=True,
                do_summary=True,
                whisper_model="small",
                language="zh",
                word_limit=200,
            )
            video.ai_status = "queued"
            video.ai_stage = "queued"
            video.ai_error = None
            db.add(job)
            jobs.append((job, video.duration or 0))

        db.commit()

        queue = Queue("summary_jobs", connection=get_redis_connection())
        failed = 0
        for job, duration in jobs:
            try:
                queue.enqueue(
                    "app.services.ai_job_tasks.run_ai_job_task",
                    args=(job.id,),
                    job_id=job.id,
                    job_timeout=compute_job_timeout(duration),
                    result_ttl=24 * 60 * 60,
                )
            except Exception as exc:  # noqa: BLE001
                failed += 1
                print(f"ENQUEUE_FAILED job={job.id} video={job.video_id}: {exc}")
        print(f"created={len(jobs)} enqueued={len(jobs) - failed} failed={failed} queue=summary_jobs")
        return 0 if failed == 0 else 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
