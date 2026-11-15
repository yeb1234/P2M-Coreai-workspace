"""字幕片段向量回填（SQLite/PostgreSQL 通用入口 -> PostgreSQL pgvector）。

特性：
- 断点续跑：以 segment_embeddings 的已有记录为断点，重复执行不会重复计费/耗时
- 按 id 游标分页，避免 OFFSET 深翻页导致的线性变慢
- 支持按视频、按分类、全量三种范围
- 每批提交，进程被杀掉最多丢一批

用法：
    # 最小验证：3 个典型视频
    python scripts/backfill_embeddings.py --video-ids 1431,29305,2356

    # 某个分类（含子分类）
    python scripts/backfill_embeddings.py --category-ids 3411

    # 全量（长跑，建议放后台）
    python scripts/backfill_embeddings.py --all

    # 只看要处理多少条，不实际调用模型
    python scripts/backfill_embeddings.py --all --dry-run
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
from sqlalchemy import text

from app.database import engine, settings
from app.services.embeddings import EmbeddingError, get_embedding_client
from app.services.vector_store import stats, upsert_embeddings


def collect_category_ids(root_ids: list[int]) -> list[int]:
    """把顶层分类展开成它自己和全部后代分类。"""
    if not root_ids:
        return []
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                WITH RECURSIVE tree AS (
                    SELECT id FROM categories WHERE id = ANY(:roots)
                    UNION
                    SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id
                )
                SELECT id FROM tree
                """
            ),
            {"roots": root_ids},
        ).fetchall()
    return [row[0] for row in rows]


def build_scope(video_ids: list[int], category_ids: list[int]) -> tuple[str, dict]:
    """返回 SQL 片段与参数，用于限定待处理片段范围。"""
    clauses: list[str] = []
    params: dict = {}
    if video_ids:
        clauses.append("s.video_id = ANY(:video_ids)")
        params["video_ids"] = video_ids
    if category_ids:
        clauses.append("v.category_id = ANY(:category_ids)")
        params["category_ids"] = category_ids
    return (" AND " + " AND ".join(clauses)) if clauses else "", params


def count_pending(scope_sql: str, params: dict, min_len: int) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(
                text(
                    f"""
                    SELECT count(*)
                    FROM subtitle_segments s
                    JOIN videos v ON v.id = s.video_id
                    LEFT JOIN segment_embeddings e ON e.segment_id = s.id
                    WHERE e.segment_id IS NULL
                      AND length(s.text) >= :min_len
                      {scope_sql}
                    """
                ),
                {**params, "min_len": min_len},
            ).scalar()
            or 0
        )


def fetch_batch(last_id: int, scope_sql: str, params: dict, min_len: int, limit: int):
    with engine.connect() as conn:
        return conn.execute(
            text(
                f"""
                SELECT s.id, s.video_id, v.category_id, s.text
                FROM subtitle_segments s
                JOIN videos v ON v.id = s.video_id
                LEFT JOIN segment_embeddings e ON e.segment_id = s.id
                WHERE e.segment_id IS NULL
                  AND s.id > :last_id
                  AND length(s.text) >= :min_len
                  {scope_sql}
                ORDER BY s.id
                LIMIT :limit
                """
            ),
            {**params, "min_len": min_len, "limit": limit, "last_id": last_id},
        ).fetchall()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-ids", default="")
    parser.add_argument("--category-ids", default="")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--min-len", type=int, default=None)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--limit", type=int, default=0, help="只处理前 N 条，用于快速验证")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    video_ids = [int(x) for x in args.video_ids.split(",") if x.strip()] if args.video_ids else []
    root_categories = (
        [int(x) for x in args.category_ids.split(",") if x.strip()] if args.category_ids else []
    )
    if not (video_ids or root_categories or args.all):
        parser.error("必须指定 --video-ids / --category-ids / --all 之一")

    category_ids = collect_category_ids(root_categories) if root_categories else []
    min_len = args.min_len if args.min_len is not None else settings.embedding_min_text_len
    scope_sql, params = build_scope(video_ids, category_ids)

    pending = count_pending(scope_sql, params, min_len)
    print(f"待处理片段: {pending:,}（min_len={min_len}, 分类={len(category_ids)} 个, 视频={len(video_ids)} 个）")

    if args.dry_run or pending == 0:
        print(f"当前向量总量: {stats()}")
        return 0

    if args.limit:
        pending = min(pending, args.limit)
        print(f"本次上限: {pending:,}")

    client = get_embedding_client()
    print(f"嵌入模型: {client.model} dim={client.dim} batch={args.batch_size}")

    started = time.time()
    done = 0
    last_id = 0
    failed_batches = 0

    while done < pending:
        limit = min(args.batch_size, pending - done)
        rows = fetch_batch(last_id, scope_sql, params, min_len, limit)
        if not rows:
            break
        last_id = rows[-1][0]

        texts = [row[3] for row in rows]
        try:
            vectors = client.embed(texts)
        except EmbeddingError as exc:
            failed_batches += 1
            print(f"  批次失败（已跳过 {len(rows)} 条）: {exc}", flush=True)
            if failed_batches >= 5:
                print("连续失败过多，中止。请检查 embedding 服务。", file=sys.stderr)
                return 1
            continue
        failed_batches = 0

        payload = [
            (row[0], row[1], row[2], np.asarray(vector, dtype=np.float32))
            for row, vector in zip(rows, vectors)
        ]
        upsert_embeddings(payload, model=client.model)

        done += len(rows)
        if done % (args.batch_size * 4) == 0 or done >= pending:
            elapsed = time.time() - started
            rate = done / max(elapsed, 0.001)
            eta = (pending - done) / max(rate, 0.001)
            print(
                f"  {done:,}/{pending:,}  {rate:5.1f} 条/秒  已用 {elapsed/60:.1f}min  剩余 {eta/60:.1f}min",
                flush=True,
            )

    elapsed = time.time() - started
    print(f"\n完成 {done:,} 条，用时 {elapsed/60:.2f} 分钟，{done/max(elapsed,0.001):.1f} 条/秒")
    print(f"向量统计: {stats()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
