"""按 content_chunks_history 回滚指定视频的向量版本。

安全默认：只打印计划，不写库。确认后加 `--apply`。
回滚只恢复旧块和旧向量，不重新转写、不重新 embedding。

用法：
    python scripts/vector_version_rollback.py --version 1.0.0 --videos 123,456
    python scripts/vector_version_rollback.py --version 1.0.0 --videos 123 --apply
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from app.database import engine  # noqa: E402
from app.services.vector_version import VECTOR_VERSION  # noqa: E402


def _latest_batches(conn, video_ids: list[int], version: str) -> list[dict]:
    rows = conn.execute(
        text(
            """
            SELECT video_id,
                   max(archived_at) AS archived_at,
                   count(*) AS chunks
            FROM content_chunks_history
            WHERE vector_version = :version
              AND video_id = ANY(:vids)
            GROUP BY video_id
            ORDER BY video_id
            """
        ),
        {"version": version, "vids": video_ids},
    ).fetchall()
    return [
        {"video_id": int(r[0]), "archived_at": r[1], "chunks": int(r[2] or 0)}
        for r in rows
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="按历史快照回滚向量版本")
    parser.add_argument("--version", required=True, help="要恢复的旧版本，例如 1.0.0")
    parser.add_argument("--videos", required=True, help="视频 id，逗号分隔")
    parser.add_argument("--apply", action="store_true", help="真正写库；默认只预览")
    args = parser.parse_args()

    ids = [int(x) for x in args.videos.split(",") if x.strip().isdigit()]
    if not ids:
        print("没有有效的视频 id")
        return 1

    with engine.connect() as conn:
        batches = _latest_batches(conn, ids, args.version)
        current = conn.execute(
            text(
                "SELECT video_id, vector_version, count(*) "
                "FROM content_chunks WHERE video_id = ANY(:vids) "
                "GROUP BY video_id, vector_version ORDER BY video_id"
            ),
            {"vids": ids},
        ).fetchall()

    print(f"当前生产版本: {VECTOR_VERSION}")
    print(f"准备恢复: {args.version}；目标视频 {len(ids)} 个")
    print("当前块:")
    for row in current:
        print(f"  video={row[0]} version={row[1]} chunks={row[2]}")
    print("可用历史快照:")
    if not batches:
        print("  没有找到该版本的历史快照，无法回滚")
        return 1
    for b in batches:
        print(f"  video={b['video_id']} archived_at={b['archived_at']} chunks={b['chunks']}")

    if not args.apply:
        print("\n预览模式，未写库。确认后加 --apply。")
        return 0

    restored = 0
    with engine.begin() as conn:
        for b in batches:
            conn.execute(
                text("DELETE FROM content_chunks WHERE video_id = :vid"),
                {"vid": b["video_id"]},
            )
            result = conn.execute(
                text(
                    """
                    INSERT INTO content_chunks
                        (video_id, chunk_index, start_sec, end_sec, text,
                         char_count, segment_count, embedding, vector_version, created_at)
                    SELECT video_id, chunk_index, start_sec, end_sec, text,
                           char_count, segment_count, embedding, vector_version, now()
                    FROM content_chunks_history
                    WHERE video_id = :vid
                      AND vector_version = :version
                      AND archived_at = :batch
                    ORDER BY chunk_index
                    """
                ),
                {"vid": b["video_id"], "version": args.version, "batch": b["archived_at"]},
            )
            conn.execute(
                text("UPDATE videos SET chunk_indexed_at = now() WHERE id = :vid"),
                {"vid": b["video_id"]},
            )
            restored += int(result.rowcount or 0)
    print(f"\n已回滚 {restored:,} 个块，涉及 {len(batches)} 个视频。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
