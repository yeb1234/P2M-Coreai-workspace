"""视频库去重：同一个文件被入库两次的清理。

## 为什么会重复

项目从「本机直跑」迁到 Docker 时，扫描器的根路径变了：

    旧：D:\\ITJC\\产品经理\\...\\01、xxx.mp4     ← 宿主机绝对路径
    新：/videos/产品经理/.../01、xxx.mp4         ← 容器内挂载路径

同一个文件被当成两个视频又入了一次库。实测 28654 条 / 13995 个唯一标题，
多出 14659 行 —— 整个库是双份的。

## 保留哪条

优先保留 **filepath 以 /videos/ 开头**的那条：只有它在容器里能播。
旧记录的 chunks 更全（当时跑过向量化），所以要**把 chunks 迁过来**，
而不是删掉重建 —— 重建要重跑约 6 小时。

有 37 组两条都带容器路径（极端情况），退到「id 最大」。

## 迁移哪些表

行为数据（必须保留，否则用户进度丢失）：
    watch_history / watch_events / notes / chat_sessions / ai_jobs
派生数据（keep 已有就不要，没有就迁）：
    content_chunks / subtitle_segments
直接丢弃：
    无

watch_history 迁移后同一个 (user, video) 可能有多条，按 progress_sec 取大的。

## 用法

    python scripts/dedupe_videos.py            # 只统计，不动数据
    python scripts/dedupe_videos.py --apply    # 真正执行

先跑 dry-run 看数字，确认后再 --apply。
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict

sys.path.insert(0, "/app")

from sqlalchemy import text  # noqa: E402

from app.database import SessionLocal  # noqa: E402

# 这些表的外键指向 videos.id，迁移时要一起改
MIGRATE_ALWAYS = ("watch_history", "watch_events", "notes", "chat_sessions", "ai_jobs")
# 派生数据：keep 里没有才迁
MIGRATE_IF_EMPTY = ("content_chunks", "subtitle_segments")


def load_duplicate_groups(db) -> dict[str, list[dict]]:
    rows = db.execute(
        text(
            """
            SELECT id, title, filepath
            FROM videos
            WHERE title IN (
                SELECT title FROM videos GROUP BY title HAVING count(*) > 1
            )
            ORDER BY title, id
            """
        )
    ).mappings().all()

    groups: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        groups[row["title"]].append(dict(row))
    return groups


def has_rows(db, table: str, video_id: int) -> bool:
    return bool(
        db.execute(
            text(f"SELECT 1 FROM {table} WHERE video_id = :vid LIMIT 1"),
            {"vid": video_id},
        ).first()
    )


def pick_keeper(db, rows: list[dict]) -> dict:
    """能播的优先，其次有 chunks 的，最后 id 最大。"""
    container = [r for r in rows if str(r["filepath"] or "").startswith("/videos/")]
    pool = container or rows
    return max(pool, key=lambda r: (has_rows(db, "content_chunks", r["id"]), r["id"]))


def count_rows(db, table: str, video_ids: list[int]) -> int:
    if not video_ids:
        return 0
    return int(
        db.execute(
            text(f"SELECT count(*) FROM {table} WHERE video_id = ANY(:ids)"),
            {"ids": video_ids},
        ).scalar()
        or 0
    )


def plan(db):
    """算出每个重复组怎么处理，不落库。"""
    groups = load_duplicate_groups(db)
    plan_rows = []
    for title, rows in groups.items():
        if len(rows) < 2:
            continue
        keeper = pick_keeper(db, rows)
        drops = [r for r in rows if r["id"] != keeper["id"]]
        plan_rows.append({"title": title, "keeper": keeper, "drops": drops})
    return plan_rows


def summarize(db, plan_rows) -> dict:
    drop_ids = [d["id"] for item in plan_rows for d in item["drops"]]
    stats = {
        "重复组": len(plan_rows),
        "待删除视频": len(drop_ids),
        "chunks 将迁入": 0,
        "chunks 将丢弃": 0,
        "字幕将迁入": 0,
    }
    for item in plan_rows:
        keeper = item["keeper"]
        keeper_has_chunks = has_rows(db, "content_chunks", keeper["id"])
        keeper_has_sub = has_rows(db, "subtitle_segments", keeper["id"])
        for drop in item["drops"]:
            n_chunk = count_rows(db, "content_chunks", [drop["id"]])
            if keeper_has_chunks:
                stats["chunks 将丢弃"] += n_chunk
            else:
                stats["chunks 将迁入"] += n_chunk
            if not keeper_has_sub:
                stats["字幕将迁入"] += count_rows(db, "subtitle_segments", [drop["id"]])
    for table in MIGRATE_ALWAYS:
        stats[f"{table} 迁移"] = count_rows(db, table, drop_ids)
    return stats


def apply_plan(db, plan_rows, batch_size: int = 500) -> None:
    drop_ids: list[int] = []
    for item in plan_rows:
        keeper_id = item["keeper"]["id"]
        keeper_has_chunks = has_rows(db, "content_chunks", keeper_id)
        keeper_has_sub = has_rows(db, "subtitle_segments", keeper_id)

        for drop in item["drops"]:
            drop_id = drop["id"]

            for table, keeper_has in (
                ("content_chunks", keeper_has_chunks),
                ("subtitle_segments", keeper_has_sub),
            ):
                if keeper_has:
                    db.execute(
                        text(f"DELETE FROM {table} WHERE video_id = :vid"), {"vid": drop_id}
                    )
                else:
                    db.execute(
                        text(f"UPDATE {table} SET video_id = :keep WHERE video_id = :drop"),
                        {"keep": keeper_id, "drop": drop_id},
                    )

            for table in MIGRATE_ALWAYS:
                db.execute(
                    text(f"UPDATE {table} SET video_id = :keep WHERE video_id = :drop"),
                    {"keep": keeper_id, "drop": drop_id},
                )

            drop_ids.append(drop_id)

        if len(drop_ids) >= batch_size:
            db.execute(text("DELETE FROM videos WHERE id = ANY(:ids)"), {"ids": drop_ids})
            db.commit()
            drop_ids = []

    if drop_ids:
        db.execute(text("DELETE FROM videos WHERE id = ANY(:ids)"), {"ids": drop_ids})

    # watch_history 迁移后同一 (user, video) 可能有多条，保留进度最新的。
    #
    # 必须放在所有迁移之后只跑一次。原来写在组循环里 —— 13995 个重复组
    # 就是 13995 次全表自连接，脚本会跑到天亮。
    db.execute(
        text(
            """
            DELETE FROM watch_history a
            USING watch_history b
            WHERE a.video_id = b.video_id
              AND a.user_id  = b.user_id
              AND a.id <> b.id
              AND (a.updated_at, a.id) < (b.updated_at, b.id)
            """
        )
    )
    db.commit()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="真正执行（默认只统计）")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        plan_rows = plan(db)
        stats = summarize(db, plan_rows)

        print("=" * 56)
        print("视频库去重" + ("（执行模式）" if args.apply else "（仅统计）"))
        print("=" * 56)
        for key, value in stats.items():
            print(f"  {key:20} {value}")

        print("\n  保留策略样例（前 3 组）：")
        for item in plan_rows[:3]:
            keep = item["keeper"]
            print(f"    《{item['title'][:34]}》")
            print(f"      keep id={keep['id']}  {keep['filepath'][:56]}")
            for drop in item["drops"]:
                print(f"      drop id={drop['id']}  {drop['filepath'][:56]}")

        if args.apply:
            apply_plan(db, plan_rows)
            print("\n  已执行。")
        else:
            print("\n  未改动任何数据。确认后加 --apply 执行。")
    finally:
        db.close()


if __name__ == "__main__":
    main()
