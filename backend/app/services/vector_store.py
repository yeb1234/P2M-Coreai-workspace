"""Vector store service using sqlite-vec for subtitle segment embeddings."""

from __future__ import annotations

import struct
from typing import TYPE_CHECKING

from app.database import engine, settings

if TYPE_CHECKING:
    pass

# Lazy-load sqlite_vec so startup doesn't break if the extension isn't installed yet.
_vec = None

DEFAULT_DIM = 1024


def _load_vec():
    global _vec
    if _vec is None:
        import sqlite_vec
        _vec = sqlite_vec
    return _vec


def _pack_vector(values: list[float]) -> bytes:
    """Pack a list of floats into a binary blob for sqlite-vec."""
    return struct.pack(f"{len(values)}f", *values)


def _unpack_vector(blob: bytes) -> list[float]:
    """Unpack a binary blob back to a list of floats."""
    count = len(blob) // 4
    return list(struct.unpack(f"{count}f", blob))


def get_vec_db():
    """Get a raw DBAPI connection with sqlite-vec loaded."""
    raw = engine.raw_connection()
    _load_vec().load(raw)
    return raw


def ensure_vec_schema(dim: int = DEFAULT_DIM) -> None:
    """Create the sqlite-vec virtual table if it doesn't exist."""
    if not settings.database_url.startswith("sqlite"):
        return

    raw = get_vec_db()
    try:
        raw.execute(
            f"""
            CREATE VIRTUAL TABLE IF NOT EXISTS subtitle_segment_embeddings USING vec0(
                segment_id INTEGER PRIMARY KEY,
                embedding float[{dim}]
            )
            """
        )
    finally:
        raw.close()


def upsert_embedding(segment_id: int, embedding: list[float]) -> None:
    """Insert or replace an embedding for a subtitle segment."""
    raw = get_vec_db()
    try:
        raw.execute(
            "INSERT OR REPLACE INTO subtitle_segment_embeddings(segment_id, embedding) VALUES (?, ?)",
            (segment_id, _pack_vector(embedding)),
        )
        raw.commit()
    finally:
        raw.close()


def upsert_embeddings_batch(items: list[tuple[int, list[float]]]) -> None:
    """Batch insert/replace embeddings."""
    if not items:
        return
    raw = get_vec_db()
    try:
        raw.executemany(
            "INSERT OR REPLACE INTO subtitle_segment_embeddings(segment_id, embedding) VALUES (?, ?)",
            [(sid, _pack_vector(emb)) for sid, emb in items],
        )
        raw.commit()
    finally:
        raw.close()


def delete_embedding(segment_id: int) -> None:
    raw = get_vec_db()
    try:
        raw.execute(
            "DELETE FROM subtitle_segment_embeddings WHERE segment_id = ?",
            (segment_id,),
        )
        raw.commit()
    finally:
        raw.close()


def search_similar(
    query_embedding: list[float],
    video_id: int | None = None,
    top_k: int = 20,
) -> list[dict]:
    """Search for similar subtitle segments by vector similarity.

    Returns list of {segment_id, distance} dicts, ordered by closest first.
    """
    raw = get_vec_db()
    try:
        if video_id is not None:
            # sqlite-vec doesn't support JOIN in MATCH queries, so we
            # fetch more and filter in Python.
            cursor = raw.execute(
                """
                SELECT segment_id, distance
                FROM subtitle_segment_embeddings
                WHERE embedding MATCH ?
                ORDER BY distance
                LIMIT ?
                """,
                (_pack_vector(query_embedding), top_k * 4),
            )
            rows = cursor.fetchall()
            from app.database import SessionLocal
            db = SessionLocal()
            try:
                from app.models import SubtitleSegment
                segment_ids = [r[0] for r in rows]
                if not segment_ids:
                    return []
                valid_ids = {
                    sid for sid, in db.query(SubtitleSegment.id)
                    .filter(SubtitleSegment.id.in_(segment_ids))
                    .filter(SubtitleSegment.video_id == video_id)
                    .all()
                }
                return [
                    {"segment_id": r[0], "distance": r[1]}
                    for r in rows
                    if r[0] in valid_ids
                ][:top_k]
            finally:
                db.close()
        else:
            cursor = raw.execute(
                """
                SELECT segment_id, distance
                FROM subtitle_segment_embeddings
                WHERE embedding MATCH ?
                ORDER BY distance
                LIMIT ?
                """,
                (_pack_vector(query_embedding), top_k),
            )
            return [{"segment_id": r[0], "distance": r[1]} for r in cursor.fetchall()]
    finally:
        raw.close()


def count_embeddings() -> int:
    raw = get_vec_db()
    try:
        cursor = raw.execute("SELECT COUNT(*) FROM subtitle_segment_embeddings")
        return cursor.fetchone()[0]
    finally:
        raw.close()


def get_unindexed_segment_ids(limit: int = 1000) -> list[int]:
    """Get segment IDs that don't have an embedding yet."""
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        from app.models import SubtitleSegment
        from sqlalchemy import text as sql_text

        # Use SQL NOT IN to efficiently find unindexed segments
        rows = db.execute(
            sql_text(
                "SELECT s.id FROM subtitle_segments s "
                "WHERE s.id NOT IN (SELECT segment_id FROM subtitle_segment_embeddings) "
                "ORDER BY s.id LIMIT :limit"
            ),
            {"limit": limit},
        ).fetchall()
        return [r[0] for r in rows]
    finally:
        db.close()


def clear_all_embeddings() -> None:
    """Drop and recreate the vec table (full rebuild)."""
    raw = get_vec_db()
    try:
        raw.execute("DROP TABLE IF EXISTS subtitle_segment_embeddings")
        raw.commit()
    finally:
        raw.close()
    ensure_vec_schema()
