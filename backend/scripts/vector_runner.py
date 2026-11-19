"""Poll for newly transcribed videos and build chunks + embeddings on the desktop.

Runs inside the P2 backend container. It does not wait for the whole
transcription batch: every few seconds it picks the next video whose
`chunk_indexed_at` is still NULL and whose transcription/segments are present,
then calls the existing `index_video()` pipeline (same chunker and same
chunk-size rules as P2). The desktop LM Studio bge-m3 endpoint is used.
"""
from __future__ import annotations

import logging
import os
import time

from sqlalchemy import or_

from app.database import SessionLocal, settings
from app.models import Video
from app.services import embeddings
from app.services.embedding_pipeline import index_video
from app.services.embeddings import EmbeddingClient

LOG = logging.getLogger("vector_runner")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

BASE_URL = os.getenv("VECTOR_BASE_URL", settings.embedding_base_url or "http://host.docker.internal:1235/v1")
# 和 settings/版本清单保持一致；不要再用 text-embedding-bge-m3@q8_0 这个旧名。
MODEL = os.getenv("VECTOR_MODEL", settings.embedding_model or "bge-m3")
DIM = int(os.getenv("VECTOR_DIM", str(settings.embedding_dim or 1024)))
POLL_SECONDS = float(os.getenv("VECTOR_POLL_SECONDS", "5"))
MAX_VIDEOS = int(os.getenv("VECTOR_MAX_VIDEOS", "0"))  # 0 = unlimited

_client = EmbeddingClient(base_url=BASE_URL, api_key="lm-studio", model=MODEL, dim=DIM)
# index_video() uses the module singleton; point it at this client once.
embeddings._default_client = _client


def _next_video_id() -> int | None:
    db = SessionLocal()
    try:
        row = (
            db.query(Video.id)
            .filter(
                Video.chunk_indexed_at.is_(None),
                or_(Video.transcription.isnot(None), Video.transcript_segments.isnot(None)),
                Video.transcription != "",
            )
            .order_by(Video.id.asc())
            .first()
        )
        return row[0] if row else None
    finally:
        db.close()


def main() -> None:
    LOG.info("vector runner started base=%s model=%s dim=%s", BASE_URL, MODEL, DIM)
    count = 0
    while True:
        video_id = _next_video_id()
        if video_id is None:
            if MAX_VIDEOS and count >= MAX_VIDEOS:
                LOG.info("reached VECTOR_MAX_VIDEOS=%s", MAX_VIDEOS)
                return
            time.sleep(POLL_SECONDS)
            continue
        started = time.perf_counter()
        try:
            result = index_video(video_id)
            LOG.info(
                "video=%s status=%s chunks=%s embedded=%s pending=%s %.1fs",
                video_id,
                result.get("status"),
                result.get("chunks"),
                result.get("embedded"),
                result.get("pending_vectors"),
                time.perf_counter() - started,
            )
        except Exception as exc:  # noqa: BLE001
            LOG.warning("video=%s failed %.1fs: %s", video_id, time.perf_counter() - started, str(exc)[:300])
            time.sleep(10)
        count += 1
        if MAX_VIDEOS and count >= MAX_VIDEOS:
            LOG.info("reached VECTOR_MAX_VIDEOS=%s", MAX_VIDEOS)
            return


if __name__ == "__main__":
    main()
