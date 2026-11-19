"""批量生成视频卡片 hover 用的雪碧图。

为什么单独做 CLI
----------------
`file_scanner.generate_missing_sprites()` 是后台慢速补图用的，只从
`limit*40` 条候选里挑，前几百条都有图后就不会继续往后扫。全库补图需要
一个能遍历全表、可中断、可重复执行的入口。

用法
----
    # 先看缺口，不生成
    docker compose exec -T backend python scripts/generate_sprites_batch.py --dry-run

    # 生成 1000 张（重复执行会跳过已有图）
    docker compose exec -T backend python scripts/generate_sprites_batch.py --limit 1000

    # 只处理指定视频
    docker compose exec -T backend python scripts/generate_sprites_batch.py --video-ids 38976,38970

注意
----
- 每张图要抽几十帧再拼图，实测 5–20 秒；不要在 Whisper 转写和它同时抢 CPU。
- 只跳过已有 `*.jpg` + `*.json` 的视频；低分辨率旧图按 `sprite.has_sprite` 的
  stale 规则会被重新生成。
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.services.sprite import generate_sprite, has_sprite  # noqa: E402
from app.utils.files import resolve_media_path  # noqa: E402


def _process_rows(db, rows, args, stats: dict) -> None:
    for row in rows:
        if stats["generated"] >= args.limit:
            return
        stats["scanned"] += 1
        if has_sprite(row.id):
            stats["skipped_has"] += 1
            continue
        source = resolve_media_path(row.filepath)
        if not source.exists():
            stats["skipped_source"] += 1
            continue
        if args.dry_run:
            stats["generated"] += 1
            continue
        meta = generate_sprite(str(source), row.id)
        if meta:
            stats["generated"] += 1
            elapsed = time.perf_counter() - stats["started_at"]
            print(
                f"  {stats['generated']}/{args.limit} video={row.id} "
                f"{meta.get('frame_width', '?')}x{meta.get('frame_height', '?')} "
                f"已用 {elapsed/60:.1f}min",
                flush=True,
            )
        else:
            stats["failed"] += 1


def main() -> int:
    parser = argparse.ArgumentParser(description="批量生成雪碧图")
    parser.add_argument("--limit", type=int, default=1000, help="最多生成多少张")
    parser.add_argument("--dry-run", action="store_true", help="只统计缺口，不生成")
    parser.add_argument("--video-ids", default="", help="指定视频 id，逗号分隔")
    parser.add_argument("--page-size", type=int, default=500, help="每页扫描多少条")
    args = parser.parse_args()

    ids = [int(x) for x in args.video_ids.split(",") if x.strip().isdigit()] if args.video_ids else None
    stats = {
        "generated": 0,
        "skipped_has": 0,
        "skipped_source": 0,
        "failed": 0,
        "scanned": 0,
        "started_at": time.perf_counter(),
    }

    db = SessionLocal()
    try:
        if ids:
            rows = db.execute(
                text("SELECT id, filepath FROM videos WHERE id = ANY(:ids) ORDER BY id"),
                {"ids": ids},
            ).fetchall()
            _process_rows(db, rows, args, stats)
        else:
            after_id = 0
            while stats["generated"] < args.limit:
                rows = db.execute(
                    text(
                        "SELECT id, filepath FROM videos WHERE duration IS NOT NULL "
                        "AND id > :after_id ORDER BY id LIMIT :limit"
                    ),
                    {"after_id": after_id, "limit": args.page_size},
                ).fetchall()
                if not rows:
                    break
                after_id = rows[-1].id
                _process_rows(db, rows, args, stats)
                if args.dry_run and stats["generated"] >= args.limit:
                    break
                # 整页既没有已有图、也没有可处理的源文件时继续翻页；
                # 不能因 generated 没变就退出，否则会停在前几百条。
    finally:
        db.close()

    print(
        f"完成 生成 {stats['generated']:,}，已有图跳过 {stats['skipped_has']:,}，"
        f"源文件缺失 {stats['skipped_source']:,}，失败 {stats['failed']:,}，"
        f"扫描 {stats['scanned']:,}"
    )
    if args.dry_run:
        print("（dry-run：没有生成）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
