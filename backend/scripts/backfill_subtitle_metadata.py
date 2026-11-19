"""把 subtitle_segments 回填成 videos 的 transcription / transcript_segments。

为什么需要
----------
历史数据里，字幕已经逐句导入 `subtitle_segments`（359 万条），但视频行上的
`transcription` / `transcript_segments` 还是空的。批量规则判断「有没有字幕」
看的是 `subtitle_path` 或 `transcript_segments`，所以：

- 批量「只补总结」只认得 4 条视频；
- 其余 8,700 多条即使有字幕，也会被当成「无字幕」或重新跑 Whisper。

这个脚本只补这两个字段，不重建块、不碰向量、不写文件，可重复执行。

用法
----
    # 先看缺口，不写库
    docker compose exec -T backend python scripts/backfill_subtitle_metadata.py

    # 正式回填（可先 --limit 5 验证）
    docker compose exec -T backend python scripts/backfill_subtitle_metadata.py --apply --limit 5
    docker compose exec -T backend python scripts/backfill_subtitle_metadata.py --apply

回滚
----
只更新原本为空的字段；已经存在的 transcription / transcript_segments 不会被覆盖。
需要回滚时，按 id 把这两个字段置空即可。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from app.database import engine  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="从字幕片段回填视频转录字段")
    parser.add_argument("--apply", action="store_true", help="真正写库；不加只统计")
    parser.add_argument("--limit", type=int, default=0, help="最多处理多少个视频")
    parser.add_argument("--video-ids", default="", help="只处理指定视频 id，逗号分隔")
    parser.add_argument("--batch-size", type=int, default=100, help="每多少条提交一次")
    args = parser.parse_args()

    ids = [int(x) for x in args.video_ids.split(",") if x.strip().isdigit()] if args.video_ids else None

    video_query = """
        SELECT v.id, v.title,
               (v.transcription IS NOT NULL AND length(v.transcription) > 0) AS has_text,
               (v.transcript_segments IS NOT NULL AND length(v.transcript_segments) > 0) AS has_segments
        FROM videos v
        WHERE EXISTS (SELECT 1 FROM subtitle_segments s WHERE s.video_id = v.id)
          AND (
              (v.transcription IS NULL OR length(v.transcription) = 0)
              OR (v.transcript_segments IS NULL OR length(v.transcript_segments) = 0)
          )
    """
    params: dict = {}
    if ids:
        video_query += " AND v.id = ANY(:ids)"
        params["ids"] = ids
    video_query += " ORDER BY v.id"
    if args.limit:
        video_query += f" LIMIT {int(args.limit)}"

    with engine.connect() as conn:
        rows = conn.execute(text(video_query), params).fetchall()

    print(f"待回填视频 {len(rows):,} 个" + ("（dry-run，不写库）" if not args.apply else ""))

    done = 0
    skipped = 0
    for row in rows:
        with engine.connect() as conn:
            segments = conn.execute(
                text(
                    "SELECT start_sec, end_sec, text FROM subtitle_segments "
                    "WHERE video_id = :vid ORDER BY segment_index, start_sec"
                ),
                {"vid": row.id},
            ).fetchall()

        if not segments:
            skipped += 1
            continue

        payload = [
            {
                "start": round(float(segment.start_sec or 0), 3),
                "end": round(float(segment.end_sec or 0), 3),
                "text": (segment.text or "").strip(),
            }
            for segment in segments
            if (segment.text or "").strip()
        ]
        if not payload:
            skipped += 1
            continue

        transcript = "\n".join(segment["text"] for segment in payload)
        import json

        segments_json = json.dumps(payload, ensure_ascii=False)

        if args.apply:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE videos SET "
                        "transcription = COALESCE(NULLIF(transcription, ''), :transcript), "
                        "transcript_segments = COALESCE(NULLIF(transcript_segments, ''), :segments) "
                        "WHERE id = :vid"
                    ),
                    {"transcript": transcript, "segments": segments_json, "vid": row.id},
                )
            done += 1
            if done % max(1, args.batch_size) == 0:
                print(f"  已回填 {done:,}/{len(rows):,}", flush=True)

    print(f"完成 {done:,} 个" + (f"，跳过空字幕 {skipped:,} 个" if skipped else ""))
    with engine.connect() as conn:
        covered = conn.execute(
            text(
                "SELECT count(*) FROM videos v WHERE EXISTS "
                "(SELECT 1 FROM subtitle_segments s WHERE s.video_id = v.id) "
                "AND v.transcript_segments IS NOT NULL AND length(v.transcript_segments) > 0"
            )
        ).scalar()
    print(f"可被批量规则识别的有字幕视频 {int(covered or 0):,} 个")
    if not args.apply:
        print("（dry-run：没有写入；确认后加 --apply）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
