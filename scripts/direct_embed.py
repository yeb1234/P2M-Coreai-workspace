"""直接向量化脚本，绕过 HTTP 端点，不会崩。"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'backend')

from app.database import SessionLocal, engine
from app.models import SubtitleSegment
from app.services.embedding import generate_embeddings_batch
from app.services.vector_store import _load_vec, _pack_vector, ensure_vec_schema
from sqlalchemy import text as sql_text
import time

BATCH_SIZE = 512

def get_unindexed_ids(db, limit=5000):
    rows = db.execute(
        sql_text(
            "SELECT s.id FROM subtitle_segments s "
            "WHERE s.id NOT IN (SELECT segment_id FROM subtitle_segment_embeddings) "
            "ORDER BY s.id LIMIT :limit"
        ),
        {"limit": limit},
    ).fetchall()
    return [r[0] for r in rows]

def upsert_batch(items):
    raw = engine.raw_connection()
    _load_vec().load(raw)
    try:
        raw.executemany(
            "INSERT OR REPLACE INTO subtitle_segment_embeddings(segment_id, embedding) VALUES (?, ?)",
            [(sid, _pack_vector(emb)) for sid, emb in items],
        )
        raw.commit()
    finally:
        raw.close()

def main():
    ensure_vec_schema()
    db = SessionLocal()

    total = db.query(SubtitleSegment).count()

    while True:
        # Check how many are indexed
        raw = engine.raw_connection()
        _load_vec().load(raw)
        cursor = raw.execute("SELECT COUNT(*) FROM subtitle_segment_embeddings")
        indexed = cursor.fetchone()[0]
        raw.close()

        pct = round(indexed / total * 100, 2) if total else 0
        print(f"[{time.strftime('%H:%M:%S')}] {indexed}/{total} ({pct}%)", flush=True)

        if indexed >= total:
            print("Done!", flush=True)
            break

        ids = get_unindexed_ids(db, limit=5000)
        if not ids:
            print("No more unindexed segments.", flush=True)
            break

        for i in range(0, len(ids), BATCH_SIZE):
            chunk = ids[i:i+BATCH_SIZE]
            segments = db.query(SubtitleSegment).filter(SubtitleSegment.id.in_(chunk)).all()
            texts = [seg.text for seg in segments]

            try:
                embeddings = generate_embeddings_batch(texts)
                items = [(seg.id, emb) for seg, emb in zip(segments, embeddings)]
                upsert_batch(items)
                print(f"  batch {i//BATCH_SIZE+1}: {len(items)} done", flush=True)
            except Exception as e:
                print(f"  batch {i//BATCH_SIZE+1} ERROR: {e}", flush=True)
                time.sleep(5)

    db.close()

if __name__ == "__main__":
    main()
