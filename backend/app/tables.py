"""pgvector 检索表（content_chunks）的 SQLAlchemy Core 定义。

## 为什么单独一个文件，不放进 models.py

这张表用了 pgvector 的 `halfvec` 类型，只能在 PostgreSQL 上建。
项目还要支持 SQLite（本地跑测试、轻量部署），如果挂到 `Base.metadata`，
`Base.metadata.create_all()` 在 SQLite 上会直接抛 `CompileError` ——
整个应用起不来。

所以用独立的 `MetaData`：

- 查询代码能引用**强类型的列对象**，不再拼 `f"FROM {table}"` 字符串
- `Base.metadata.create_all()` 永远碰不到它，SQLite 不受影响

## DDL 归谁管

本文件。`app/migrations.py` 和 `scripts/build_content_chunks.py` 都调用
`content_chunks_ddl()` —— 之前 DDL 只写在脚本里、migrations 没有，
而默认检索源就是它，新部署直接查不存在的表。

## 为什么表名不能写字面量

`content_chunks` 和 `subtitle_segments` 的 id 空间是重叠的（都从 1 开始）。
用 chunk id 去查字幕表**不会报错**，只会静默返回**另一个片段的文本** ——
表现为「检索结果莫名其妙」，日志里什么都没有。这个坑实际踩过一次。

所以凡是查这张表，表名一律从 `CONTENT_CHUNKS` 取，不写字符串。
"""

from __future__ import annotations

from pgvector.sqlalchemy import HALFVEC
from sqlalchemy import BigInteger, Column, DateTime, Float, Integer, MetaData, Table, Text, func

# 独立元数据：create_all 不会碰它，SQLite 环境安全
pgvector_metadata = MetaData()


CONTENT_CHUNKS = Table(
    "content_chunks",
    pgvector_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("video_id", Integer, nullable=False),
    Column("chunk_index", Integer, nullable=False),
    Column("start_sec", Float, nullable=False),
    Column("end_sec", Float, nullable=False),
    Column("text", Text, nullable=False),
    Column("char_count", Integer, nullable=False),
    Column("segment_count", Integer, nullable=False, server_default="1"),
    # 维度由 settings.embedding_dim 决定，这里不写死 —— 类型只用于结果转换，
    # 真正的 halfvec(N) 在 content_chunks_ddl() 里按运行时配置拼。
    Column("embedding", HALFVEC(), nullable=True),
    Column("created_at", DateTime, server_default=func.now()),
)


def content_chunks_ddl(dim: int) -> list[str]:
    """建表 + 索引 DDL（全部幂等，可重复执行）。"""
    return [
        f"""
        CREATE TABLE IF NOT EXISTS content_chunks (
            id            BIGSERIAL PRIMARY KEY,
            video_id      INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
            chunk_index   INTEGER NOT NULL,
            start_sec     DOUBLE PRECISION NOT NULL,
            end_sec       DOUBLE PRECISION NOT NULL,
            text          TEXT NOT NULL,
            char_count    INTEGER NOT NULL,
            segment_count INTEGER NOT NULL DEFAULT 1,
            -- 向量先留空，由回填脚本填。放同一张表省一次 JOIN
            embedding     halfvec({dim}),
            created_at    TIMESTAMP DEFAULT now()
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_content_chunks_video "
        "ON content_chunks (video_id, chunk_index)",
        "CREATE INDEX IF NOT EXISTS ix_content_chunks_embedding "
        "ON content_chunks USING hnsw (embedding halfvec_cosine_ops)",
        # 词法检索要用 trigram，和 subtitle_segments 保持一致
        "CREATE INDEX IF NOT EXISTS ix_content_chunks_text_trgm "
        "ON content_chunks USING gin (text gin_trgm_ops)",
    ]
