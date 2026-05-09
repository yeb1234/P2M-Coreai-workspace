from __future__ import annotations

from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import logging
import signal
import threading
import time

from app.database import Base, engine, ensure_runtime_schema, settings
from app.services.ai_jobs import claim_next_ai_job, requeue_interrupted_ai_jobs, run_ai_job
from app.services.file_scanner import generate_missing_thumbnails

logger = logging.getLogger(__name__)

_running = True


def _stop(_signum, _frame) -> None:
    global _running
    _running = False


def main() -> None:
    logger.info("AI worker starting in thread: %s", threading.current_thread().name)
    if threading.current_thread() is threading.main_thread():
        signal.signal(signal.SIGINT, _stop)
        signal.signal(signal.SIGTERM, _stop)

    Base.metadata.create_all(bind=engine)
    ensure_runtime_schema()
    if settings.ai_worker_requeue_running_on_start:
        requeue_interrupted_ai_jobs()
    logger.info("AI worker initialized, polling for jobs...")

    max_workers = max(1, int(settings.ai_worker_concurrency or 1))
    idle_cycles = 0
    futures = set()

    with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="ai-worker") as executor:
        while _running:
            futures = {future for future in futures if not future.done()}

            claimed = False
            while len(futures) < max_workers:
                job_id = claim_next_ai_job()
                if not job_id:
                    break
                logger.info("Claimed job: %s", job_id)
                claimed = True
                futures.add(executor.submit(run_ai_job, job_id))
            if not claimed and not futures:
                logger.debug("No jobs to claim, sleeping...")

            if claimed:
                idle_cycles = 0
                continue

            if futures:
                done, futures = wait(
                    futures,
                    timeout=settings.ai_worker_poll_interval,
                    return_when=FIRST_COMPLETED,
                )
                for future in done:
                    future.result()
                continue

            idle_cycles += 1
            thumbnail_cycles = max(1, int(settings.thumbnail_background_idle_cycles or 10))
            thumbnail_limit = max(1, int(settings.thumbnail_background_limit or 1))
            if settings.thumbnail_background_enabled and idle_cycles % thumbnail_cycles == 0:
                generate_missing_thumbnails(limit=thumbnail_limit)
            time.sleep(settings.ai_worker_poll_interval)


if __name__ == "__main__":
    main()
