"""CPU-only audio pre-extractor.

The GPU workers should spend their time on Whisper, not on reading HDD-backed
videos. This process scans queued AI jobs, runs ffmpeg on the CPU, and writes
16 kHz mono WAV files to a separate SSD cache. The GPU worker then finds the
WAV already there and skips ffmpeg entirely.

It is deliberately a plain DB polling loop instead of another RQ queue: the
existing ai_jobs table is already the source of truth, and a separate queue
would need a second state machine to keep "prepared" and "transcribed" in sync.
"""

from __future__ import annotations

import logging
import os
import signal
import time
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

from app.database import SessionLocal, settings
from app.models import AiJob, Video
from app.services.ai_jobs import _build_job_paths, _video_has_transcription_outputs
from app.services.ffmpeg_audio import extract_wav_16k_mono

logger = logging.getLogger(__name__)

_running = True


def _stop(_signum, _frame) -> None:
    global _running
    _running = False


def _cache_wav(job_id: str) -> None:
    """Extract one queued job's audio into the SSD cache.

    Re-checks the job status after extraction starts: a GPU worker may have
    claimed it meanwhile, in which case we keep the WAV (it is still usable)
    but do not overwrite the running job's stage/message.
    """
    db = SessionLocal()
    try:
        job = db.query(AiJob).filter(AiJob.id == job_id).first()
        if not job or job.status != "queued":
            return
        video = db.query(Video).filter(Video.id == job.video_id).first()
        if not video:
            job.status = "failed"
            job.stage = "failed"
            job.message = "Video record missing"
            job.error = f"Video record not found: {job.video_id}"
            job.updated_at = datetime.now()
            db.commit()
            return
        if _video_has_transcription_outputs(video):
            return

        paths = _build_job_paths(video, job)
        if paths.wav.exists() and paths.wav.stat().st_size > 0:
            if job.status == "queued":
                job.stage = "audio_cached"
                job.message = "Audio cached on SSD"
                job.updated_at = datetime.now()
                db.commit()
            return
        if not paths.source.exists():
            # A missing source used to leave the job queued forever. audio-prep
            # would pick the same queue head every poll and never reach the
            # jobs behind it. Mark it failed once so the queue can move on.
            message = f"Source video missing: {paths.source}"
            logger.warning("audio-prep fail job=%s video=%s: %s", job_id, video.id, message)
            job.status = "failed"
            job.stage = "failed"
            job.message = "Source file missing"
            job.error = message
            job.updated_at = datetime.now()
            video.ai_status = "failed"
            video.ai_stage = "failed"
            video.ai_error = message
            db.commit()
            return

        tmp_path = paths.wav.with_name(f"{paths.wav.name}.{job_id}.prep")
        try:
            extract_wav_16k_mono(
                paths.source,
                tmp_path,
                cpu_threads=job.cpu_threads,
                job_id=job_id,
            )
            os.replace(tmp_path, paths.wav)
        finally:
            if tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass

        # Keep the UI informative without changing the queue state. If the
        # GPU worker already claimed the job, its own stage wins.
        db.refresh(job)
        if job.status == "queued":
            job.stage = "audio_cached"
            job.message = "Audio cached on SSD"
            job.updated_at = datetime.now()
            db.commit()
        logger.info("audio-prep cached job=%s video=%s -> %s", job_id, video.id, paths.wav)
    except Exception:  # noqa: BLE001
        logger.warning("audio-prep failed job=%s (GPU worker will fall back)", job_id, exc_info=True)
    finally:
        db.close()


def _pending_job_ids(limit: int) -> list[str]:
    """Return the queue head, not just the oldest DB row.

    RQ consumes FIFO. Preparing the oldest DB job is useless if it sits at
    the tail of the queue. Read the actual queue order first so the WAV
    buffer lines up with the next jobs the GPU will claim.
    """
    candidates: list[str] = []
    try:
        from app.services.rq_client import ai_jobs_queue

        candidates = list(ai_jobs_queue().job_ids[: max(limit, 20)])
    except Exception:
        logger.debug("audio-prep cannot read RQ queue, falling back to DB", exc_info=True)

    if candidates:
        db = SessionLocal()
        try:
            rows = (
                db.query(AiJob.id)
                .filter(
                    AiJob.id.in_(candidates),
                    AiJob.status == "queued",
                    AiJob.summary_only.isnot(True),
                    (AiJob.stage.is_(None)) | (AiJob.stage != "audio_cached"),
                )
                .all()
            )
            ready = {row[0] for row in rows}
            return [job_id for job_id in candidates if job_id in ready][:limit]
        finally:
            db.close()

    db = SessionLocal()
    try:
        rows = (
            db.query(AiJob.id)
            .filter(
                AiJob.status == "queued",
                AiJob.summary_only.isnot(True),
                (AiJob.stage.is_(None)) | (AiJob.stage != "audio_cached"),
            )
            .order_by(AiJob.created_at.asc())
            .limit(limit)
            .all()
        )
        return [row[0] for row in rows]
    finally:
        db.close()


def _cache_usage(cache_dir: Path) -> tuple[int, int]:
    """Return (wav file count, total wav bytes) for the audio cache."""
    files = list(cache_dir.glob("*.wav"))
    total = 0
    for path in files:
        try:
            total += path.stat().st_size
        except OSError:
            pass
    return len(files), total


def _sync_pool_once() -> None:
    """Run the Docker-native queue pool refresh.

    This is intentionally hosted in the always-on audio-prep container, not
    in a Windows scheduled task: after a reboot the container comes back with
    restart: unless-stopped, then re-enqueues DB rows that RQ lost and
    recovers queued/running jobs whose worker registration expired.
    """
    try:
        from app.services.admin_ai_queue import reconcile_stuck_ai_jobs, sync_db_queue_to_rq

        pushed = sync_db_queue_to_rq()
        db = SessionLocal()
        try:
            recovered = reconcile_stuck_ai_jobs(db, limit=30)
        finally:
            db.close()
        if pushed or recovered:
            logger.info("pool refresh: pushed=%s recovered=%s", pushed, recovered)
    except Exception:  # noqa: BLE001
        logger.warning("pool refresh failed; audio prep continues", exc_info=True)


def main() -> None:
    from app.core.observability import setup_from_settings

    setup_from_settings("audio-prep")

    concurrency = max(1, int(os.getenv("AUDIO_PREP_CONCURRENCY", "2")))
    poll_seconds = max(1.0, float(os.getenv("AUDIO_PREP_POLL_SECONDS", "5")))
    max_files = int(os.getenv("AUDIO_PREP_MAX_FILES", "20000"))
    if max_files < 0:
        max_files = 0
    max_bytes = int(os.getenv("AUDIO_PREP_MAX_BYTES", str(400 * 1024**3)))
    lookahead = max(concurrency * 3, int(os.getenv("AUDIO_PREP_LOOKAHEAD", "2000")))
    once = os.getenv("AUDIO_PREP_ONCE", "0") == "1"
    cache_dir = Path(settings.audio_cache_dir or settings.work_dir)
    # 队列池刷新周期：0 表示关闭。默认 5 分钟，足够接住 worker 重启、
    # RQ 丢消息和 DB 里 queued 但未入队的任务，也不会每秒扫 4k+ 行。
    pool_sync_seconds = max(0.0, float(os.getenv("POOL_SYNC_SECONDS", "300")))

    if os.name != "nt":
        signal.signal(signal.SIGINT, _stop)
        signal.signal(signal.SIGTERM, _stop)

    logger.info(
        "audio-prep starting: concurrency=%s poll=%ss cache=%s max_files=%s max_bytes=%.2fGB lookahead=%s",
        concurrency,
        poll_seconds,
        settings.audio_cache_dir or settings.work_dir,
        "unlimited" if max_files == 0 else max_files,
        max_bytes / (1024**3) if max_bytes > 0 else 0,
        lookahead,
    )

    cache_full_logged = False
    in_flight: dict[str, Future] = {}
    last_pool_sync = 0.0
    with ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix="audio-prep") as pool:
        while _running:
            if pool_sync_seconds > 0:
                now = time.monotonic()
                if now - last_pool_sync >= pool_sync_seconds:
                    _sync_pool_once()
                    last_pool_sync = time.monotonic()

            for job_id, future in list(in_flight.items()):
                if future.done():
                    in_flight.pop(job_id, None)

            # Keep a look-ahead buffer. File count is a secondary guard; the
            # byte cap is what actually bounds SSD usage. A larger buffer lets
            # the CPU run ahead instead of waking up every time the GPU takes
            # one WAV.
            cache_files, cache_bytes = _cache_usage(cache_dir) if cache_dir.exists() else (0, 0)
            full_by_files = max_files > 0 and cache_files >= max_files
            full_by_bytes = max_bytes > 0 and cache_bytes >= max_bytes
            if full_by_files or full_by_bytes:
                if not cache_full_logged:
                    logger.info(
                        "audio-prep cache full: files=%s bytes=%.2fGB (limits files=%s bytes=%.2fGB), pausing",
                        cache_files,
                        cache_bytes / (1024**3),
                        "unlimited" if max_files == 0 else max_files,
                        max_bytes / (1024**3) if max_bytes > 0 else 0,
                    )
                    cache_full_logged = True
                if once:
                    break
                time.sleep(poll_seconds)
                continue
            cache_full_logged = False

            pending = _pending_job_ids(lookahead)
            submitted = 0
            for job_id in pending:
                if job_id in in_flight:
                    continue
                if len(in_flight) >= concurrency:
                    break
                in_flight[job_id] = pool.submit(_cache_wav, job_id)
                submitted += 1

            if submitted:
                logger.info("audio-prep queued %s extraction task(s)", submitted)
            if once:
                for future in in_flight.values():
                    future.result()
                break
            if not pending and not in_flight:
                time.sleep(poll_seconds)
            else:
                time.sleep(min(poll_seconds, 2.0))

    logger.info("audio-prep stopped")


if __name__ == "__main__":
    main()
