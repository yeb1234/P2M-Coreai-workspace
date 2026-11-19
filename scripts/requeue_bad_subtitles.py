import csv
import json
import os
from collections import Counter
from datetime import datetime
from pathlib import Path

from app.database import SessionLocal
from app.models import Video, AiJob
from app.routers.ai_jobs import _prepare_force_rerun
from app.services.ai_jobs import create_ai_job
from app.services.admin_ai_queue import _is_queue_paused, enqueue_ai_jobs
from app.utils.files import resolve_media_path

QUALITY_CSV = Path("/tmp/subtitle_quality_full.csv")
BACKUP_JSONL = Path("/tmp/subtitle_retranscribe_backup_2026-11-17.jsonl")
PRIORITY_CSV = Path("/tmp/subtitle_retranscribe_priority_2026-11-17.csv")
LIMIT = int(os.getenv("RETRANSCRIBE_LIMIT", "0") or "0")


def is_strong(row: dict) -> bool:
    flags = row["flags"].split("|")
    if "garbled_segments" in flags:
        return True
    if "coverage_low" in flags or "timestamps_overlap" in flags:
        return True
    return "repeat_loop" in flags and float(row["repeat_run_max"]) >= 500


rows = [r for r in csv.DictReader(QUALITY_CSV.open(encoding="utf-8")) if r["severity"] == "critical"]
selected = [r for r in rows if is_strong(r)]
selected.sort(
    key=lambda r: (
        0 if "garbled_segments" in r["flags"] else
        1 if "coverage_low" in r["flags"] or "timestamps_overlap" in r["flags"] else
        2,
        -float(r["repeat_run_max"]),
        -float(r["duration"] or 0),
    )
)
if LIMIT > 0:
    selected = selected[:LIMIT]

db = SessionLocal()
backed_up = []
created = []
skipped = []
try:
    with BACKUP_JSONL.open("w", encoding="utf-8") as backup:
        for row in selected:
            video_id = int(row["id"])
            video = db.query(Video).filter(Video.id == video_id).first()
            if not video:
                skipped.append({"video_id": video_id, "reason": "video_missing"})
                continue
            if not video.filepath:
                skipped.append({"video_id": video_id, "reason": "filepath_missing"})
                continue
            source = resolve_media_path(video.filepath)
            if not source.exists():
                skipped.append({"video_id": video_id, "reason": "source_file_missing", "filepath": video.filepath})
                continue
            active = (
                db.query(AiJob)
                .filter(AiJob.video_id == video_id, AiJob.status == "running")
                .first()
            )
            if active:
                skipped.append({"video_id": video_id, "reason": "currently_running", "job_id": active.id})
                continue

            backed_up.append(video_id)
            backup.write(
                json.dumps(
                    {
                        "video_id": video_id,
                        "title": video.title,
                        "filepath": video.filepath,
                        "duration": video.duration,
                        "transcription": video.transcription,
                        "transcript_segments": video.transcript_segments,
                        "summary": video.summary,
                        "markdown_path": video.markdown_path,
                        "subtitle_path": video.subtitle_path,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )

            # 强制重跑：清掉旧字幕/块状态和旧任务，旧文件本身不删除。
            _prepare_force_rerun(db, video)
            db.commit()

            job = create_ai_job(
                db=db,
                video_id=video_id,
                whisper_model="large-v3-turbo",
                whisper_engine="faster-whisper",
                language="zh",
                do_summary=False,
                word_limit=200,
                ollama_model=None,
                compute_type="float16",
                beam_size=3,
                best_of=5,
                temperature=0,
                vad_filter=True,
                device_type="cuda",
                subtitle_correction_enabled=False,
            )
            created.append(job.id)
            video.ai_status = "queued"
            video.ai_stage = "queued"
            video.ai_error = None
            db.commit()

    if created and not _is_queue_paused():
        enqueue_ai_jobs(created, at_front=True)
        enqueue_status = "enqueued_at_front"
    elif created:
        enqueue_status = "queue_paused_db_only"
    else:
        enqueue_status = "nothing_to_enqueue"

    with PRIORITY_CSV.open("w", encoding="utf-8-sig", newline="") as out:
        writer = csv.DictWriter(
            out,
            fieldnames=[
                "video_id", "title", "priority_reason", "duration",
                "repeat_run_max", "flags", "sample",
            ],
        )
        writer.writeheader()
        for row in selected:
            if int(row["id"]) not in backed_up:
                continue
            if "garbled_segments" in row["flags"]:
                reason = "garbled_segments"
            elif "coverage_low" in row["flags"] or "timestamps_overlap" in row["flags"]:
                reason = "coverage_or_overlap"
            else:
                reason = "repeat_run_ge_500"
            writer.writerow({
                "video_id": row["id"],
                "title": row["title"],
                "priority_reason": reason,
                "duration": row["duration"],
                "repeat_run_max": row["repeat_run_max"],
                "flags": row["flags"],
                "sample": row["sample"],
            })

    print(json.dumps({
        "quality_candidates": len(selected),
        "backed_up": len(backed_up),
        "created_jobs": len(created),
        "skipped": len(skipped),
        "enqueue_status": enqueue_status,
        "backup": str(BACKUP_JSONL),
        "priority_csv": str(PRIORITY_CSV),
        "skip_reasons": dict(Counter(s["reason"] for s in skipped)),
    }, ensure_ascii=False, indent=2))
    if skipped:
        print("skipped:", json.dumps(skipped[:10], ensure_ascii=False))
finally:
    db.close()
