"""Batch generate thumbnails for all videos missing them."""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))

from app.database import SessionLocal
from app.models import Video
from app.services.file_scanner import generate_thumbnail


def main():
    db = SessionLocal()
    videos = db.query(Video).filter(Video.thumbnail.is_(None)).all()
    if not videos:
        print("All videos have thumbnails.")
        db.close()
        return

    print(f"Generating thumbnails for {len(videos)} videos...")
    generated = 0
    skipped = 0
    start = time.time()
    for i, v in enumerate(videos):
        if not os.path.exists(v.filepath):
            skipped += 1
            continue
        result = generate_thumbnail(v.filepath, v.id)
        if result:
            v.thumbnail = result
            generated += 1
            db.commit()
        if (i + 1) % 50 == 0:
            elapsed = time.time() - start
            speed = (i + 1) / elapsed if elapsed > 0 else 0
            eta = (len(videos) - i - 1) / speed if speed > 0 else 0
            print(f"  {i+1}/{len(videos)} done ({generated} OK, {skipped} skip, {elapsed:.0f}s, ETA {eta:.0f}s)")

    elapsed = time.time() - start
    db.close()
    print(f"Done: {generated} generated, {skipped} skipped, {len(videos)}-generated total in {elapsed:.0f}s")


if __name__ == "__main__":
    main()
