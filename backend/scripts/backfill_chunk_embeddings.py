"""回填 content_chunks 的向量。

说明：正常情况下**不需要跑这个脚本**。
转写完成后会自动投递索引任务，worker 也会定期扫描补齐，
进程重启不丢（见 app/services/embedding_pipeline.py）。

这个脚本是 CLI 版，用于：
  - 想手动全量补齐、看逐批进度
  - API 起不来但数据库和嵌入服务可用
两者的幂等判断一致（只补 embedding IS NULL 的块）。

用法：
    python scripts/backfill_chunk_embeddings.py
    python scripts/backfill_chunk_embeddings.py --limit 500   # 只跑一批验证
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from app.database import engine  # noqa: E402
from app.services.embeddings import EmbeddingError, get_embedding_client  # noqa: E402


def vector_literal(vec: list[float]) -> str:
    # halfvec 接受文本格式 [1,2,3]；用 half 精度存储，索引体积减半
    return "[" + ",".join(f"{x:.5f}" for x in vec) + "]"


def main() -> int:
    parser = argparse.ArgumentParser(description="回填语义块向量")
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--limit", type=int, default=0, help="最多处理多少块（调试用）")
    args = parser.parse_args()

    client = get_embedding_client()
    print(f"嵌入模型: {client.model}  dim={client.dim}")

    with engine.connect() as conn:
        pending = int(
            conn.execute(text("SELECT count(*) FROM content_chunks WHERE embedding IS NULL")).scalar()
            or 0
        )
    if not pending:
        print("没有待回填的块")
        return 0
    target = min(pending, args.limit) if args.limit else pending
    print(f"待回填 {pending:,} 块，本次处理 {target:,} 块")

    done = 0
    failed = 0
    started = time.perf_counter()

    while done < target:
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT id, text FROM content_chunks "
                    "WHERE embedding IS NULL ORDER BY id LIMIT :lim"
                ),
                {"lim": min(args.batch_size, target - done)},
            ).fetchall()
        if not rows:
            break

        try:
            vectors = client.embed([r.text for r in rows])
        except EmbeddingError as exc:
            failed += len(rows)
            print(f"  嵌入失败，跳过这批 {len(rows)} 块: {exc}")
            # 打标记避免死循环：置空文本以外的方式没法跳，直接退出
            break

        if len(vectors) != len(rows):
            print(f"  返回数量不匹配 {len(vectors)} != {len(rows)}，中止")
            return 2

        # 一条 UPDATE ... FROM (VALUES ...) 比逐条 UPDATE 快一个量级
        values = ", ".join(
            f"(:id{i}, CAST(:v{i} AS halfvec))" for i in range(len(rows))
        )
        params: dict = {}
        for i, (row, vec) in enumerate(zip(rows, vectors)):
            params[f"id{i}"] = row.id
            params[f"v{i}"] = vector_literal(vec)

        with engine.begin() as conn:
            conn.execute(
                text(
                    f"UPDATE content_chunks AS c SET embedding = v.emb "
                    f"FROM (VALUES {values}) AS v(id, emb) WHERE c.id = v.id"
                ),
                params,
            )

        done += len(rows)
        elapsed = time.perf_counter() - started
        rate = done / elapsed if elapsed else 0
        remaining = (target - done) / rate if rate else 0
        print(
            f"  {done:,}/{target:,}  {rate:.1f} 块/秒  "
            f"已用 {elapsed/60:.1f}min  剩余 {remaining/60:.1f}min",
            flush=True,
        )

    elapsed = time.perf_counter() - started
    print(f"\n完成 {done:,} 块，用时 {elapsed/60:.1f} 分钟" + (f"，失败 {failed}" if failed else ""))

    with engine.connect() as conn:
        covered = int(
            conn.execute(text("SELECT count(*) FROM content_chunks WHERE embedding IS NOT NULL")).scalar()
            or 0
        )
        total = int(conn.execute(text("SELECT count(*) FROM content_chunks")).scalar() or 0)
    print(f"覆盖率 {covered:,}/{total:,} = {covered/total*100:.1f}%" if total else "")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
