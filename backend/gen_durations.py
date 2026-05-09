"""Batch extract duration for all videos missing it."""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))

from app.database import SessionLocal
from app.models import Video
from app.services.file_scanner import get_video_duration


def main():
    db = SessionLocal()
    videos = db.query(Video).filter(Video.duration.is_(None)).all()
    if not videos:
        print("All videos have duration.")
        db.close()
        return

    print(f"Extracting duration for {len(videos)} videos...")
    updated = 0
    start = time.time()
    for i, v in enumerate(videos):
        if not os.path.exists(v.filepath):
            continue
        dur = get_video_duration(v.filepath)
        if dur:
            v.duration = dur
            updated += 1
            db.commit()
        if (i + 1) % 50 == 0:
            elapsed = time.time() - start
            speed = (i + 1) / elapsed if elapsed > 0 else 0
            eta = (len(videos) - i - 1) / speed if speed > 0 else 0
            print(f"  {i+1}/{len(videos)} done ({updated} OK, {elapsed:.0f}s, ETA {eta:.0f}s)")

    elapsed = time.time() - start
    db.close()
    print(f"Done: {updated}/{len(videos)} durations extracted in {elapsed:.0f}s")


if __name__ == "__main__":
    main()
