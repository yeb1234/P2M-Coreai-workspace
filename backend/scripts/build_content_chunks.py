"""把逐句字幕重建成语义块（content_chunks）。

为什么必须做
------------
现有检索单元是 `subtitle_segments`——一条一条字幕。实测：

    片段时间  3,592,399 条
    平均长度  9 字
    中位数    8 字
    65.3% 少于 10 字

拿 8 个字的文本做检索单元，三个环节同时失效：

1. **向量是噪声**：bge-m3 对 8 字输入的编码几乎由字面重叠决定，不是语义。
   「那我们就来看一下」这类过渡句会以随机相似度混进结果。
2. **RRF 放大噪声**：词法和向量两条通路都在噪声上排序，融合后噪声叠加。
3. **Rerank 无从判断**：候选是一行 180 字截断的碎片，模型看不出相关性。

合理区间是 200–500 中文字（约 300–700 tokens）。这个脚本按句子边界合并，
目标 400 字、硬上限 600 字、块间重叠 60 字。

顺带的收益：359 万条 → 约 10 万块，向量回填从 6 小时降到 20 分钟。

用法
----
    # 先看分块效果，不写库
    python scripts/build_content_chunks.py --dry-run --limit 20

    # 正式建块
    python scripts/build_content_chunks.py --rebuild

    # 只处理指定视频
    python scripts/build_content_chunks.py --videos 123,456
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from app.database import engine, settings  # noqa: E402
from app.services.chunker import split_into_chunks  # noqa: E402,F401  （分块逻辑在服务层）
from app.services.subtitle_cleaner import clean_segments  # noqa: E402
from app.services.vector_version import VECTOR_VERSION  # noqa: E402

def ensure_table(conn) -> None:
    """建表 + 索引。DDL 来自 app.tables，和 migrations 用同一份。

    之前这里自己写了一份 DDL，而 migrations 里没有 ——
    结果新部署（没跑过这个脚本）时默认检索源 chunks 查的是不存在的表。
    """
    from app.tables import content_chunks_ddl, content_chunks_history_ddl

    dim = int(settings.embedding_dim or 1024)
    conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    for statement in content_chunks_ddl(dim):
        conn.execute(text(statement))
    for statement in content_chunks_history_ddl(dim):
        conn.execute(text(statement))
    # 旧库的 content_chunks 可能没有版本列；手工建块脚本也必须幂等补列。
    conn.execute(
        text(
            "ALTER TABLE content_chunks ADD COLUMN IF NOT EXISTS "
            "vector_version TEXT NOT NULL DEFAULT '1.0.0'"
        )
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="重建语义块")
    parser.add_argument("--dry-run", action="store_true", help="只统计，不写库")
    parser.add_argument("--limit", type=int, default=0, help="只处理前 N 个视频")
    parser.add_argument("--videos", default="", help="指定视频 id，逗号分隔")
    parser.add_argument("--rebuild", action="store_true", help="先清空 content_chunks")
    args = parser.parse_args()

    ids = [int(x) for x in args.videos.split(",") if x.strip().isdigit()] if args.videos else None

    if not args.dry_run:
        with engine.begin() as conn:
            ensure_table(conn)
            if args.rebuild:
                conn.execute(text("TRUNCATE content_chunks"))
        if args.rebuild:
            print("已清空 content_chunks")

    with engine.connect() as conn:
        video_query = "SELECT id, title FROM videos WHERE id IN (SELECT DISTINCT video_id FROM subtitle_segments)"
        params: dict = {}
        if ids:
            video_query += " AND id = ANY(:ids)"
            params["ids"] = ids
        video_query += " ORDER BY id"
        if args.limit:
            video_query += f" LIMIT {int(args.limit)}"
        videos = conn.execute(text(video_query), params).fetchall()

        if not videos:
            print("没有带字幕的视频")
            return 1

        print(f"待处理视频 {len(videos)} 个" + ("（dry-run）" if args.dry_run else ""))

        total_segments = 0
        total_chunks = 0
        total_chars = 0
        samples: list[dict] = []

        for video in videos:
            rows = conn.execute(
                text(
                    "SELECT start_sec, end_sec, text FROM subtitle_segments "
                    "WHERE video_id = :vid ORDER BY start_sec"
                ),
                {"vid": video.id},
            ).fetchall()
            segments = [(r.start_sec, r.end_sec, r.text) for r in rows]
            # 脚本和后台索引管线必须走同一套清洗/版本，否则手工重建
            # 会静默把未清洗文本写回向量库，版本号也会说错。
            segments = clean_segments(segments, mode="vector_safe")
            chunks = split_into_chunks(segments)

            total_segments += len(segments)
            total_chunks += len(chunks)
            total_chars += sum(c["char_count"] for c in chunks)

            if len(samples) < 2 and chunks:
                samples.append({"title": video.title, "chunks": chunks[:2]})

            if not args.dry_run:
                conn.execute(text("DELETE FROM content_chunks WHERE video_id = :vid"), {"vid": video.id})
                for index, chunk in enumerate(chunks):
                    conn.execute(
                        text(
                            "INSERT INTO content_chunks "
                            "(video_id, chunk_index, start_sec, end_sec, text, char_count, segment_count, vector_version) "
                            "VALUES (:vid, :idx, :s, :e, :t, :c, :n, :v)"
                        ),
                        {
                            "vid": video.id,
                            "idx": index,
                            "s": chunk["start_sec"],
                            "e": chunk["end_sec"],
                            "t": chunk["text"],
                            "c": chunk["char_count"],
                            "n": chunk["segment_count"],
                            "v": VECTOR_VERSION,
                        },
                    )
                conn.commit()

    avg_seg = total_chars / total_segments if total_segments else 0
    avg_chunk = total_chars / total_chunks if total_chunks else 0
    print()
    print(f"  字幕片段 {total_segments:,} 条，平均 {avg_seg:.0f} 字")
    print(f"  语义块   {total_chunks:,} 个，平均 {avg_chunk:.0f} 字")
    print(f"  压缩比   {total_segments / total_chunks:.1f} : 1" if total_chunks else "")
    print()

    for sample in samples:
        print(f"  ── 《{(sample['title'] or '')[:40]}》──")
        for chunk in sample["chunks"]:
            print(f"  [{chunk['start_sec']:.0f}s-{chunk['end_sec']:.0f}s] {chunk['char_count']}字")
            print(f"    {chunk['text'][:150]}…")
        print()

    if args.dry_run:
        print("（dry-run：没有写入）")
        return 0

    print("完成。下一步：对 content_chunks 回填向量（见 docs/retrieval-tuning.md）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
