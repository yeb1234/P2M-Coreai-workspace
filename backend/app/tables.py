"""pgvector 检索表的 SQLAlchemy Core 定义。

## 为什么单独一个文件，不放进 models.py

这两张表用了 pgvector 的 `halfvec` 类型，只能在 PostgreSQL 上建。
项目还要支持 SQLite（本地跑测试、轻量部署），如果把它们挂到
`Base.metadata`，`Base.metadata.create_all()` 在 SQLite 上会直接抛
`CompileError` —— 整个应用起不来。

所以用独立的 `MetaData`：

- 查询代码能引用**强类型的列对象**，不再拼 `f"FROM {table}"` 字符串
- `Base.metadata.create_all()` 永远碰不到它们，SQLite 不受影响

## DDL 归谁管

`app/migrations.py`。因为要用运行时的 `embedding_dim` 拼 `halfvec(N)`、
要指定 HNSW 的 `m` / `ef_construction`，这些 SQLAlchemy 的类型渲染表达不了。

**这是本项目唯一有意保留的重复**：DDL 需要 PG 方言特性，Core 定义需要
跨方言可导入。改列名或加列时，两处都要改。

## 为什么表名切换必须走 retrieval_table()

`content_chunks` 和 `subtitle_segments` 的 id 空间是重叠的（都从 1 开始）。
用 chunk id 去查字幕表**不会报错**，只会静默返回**另一个片段的文本** ——
表现为「检索结果莫名其妙」，日志里什么都没有。这个坑实际踩过一次
（见 hybrid_search.fetch_segments 的注释）。

所以表名不允许是随处拼接的字符串字面量，只能从这张映射表里取。
"""

from __future__ import annotations

from sqlalchemy import BigInteger, Column, DateTime, Float, Integer, MetaData, SmallInteger, Table, Text, func
from pgvector.sqlalchemy import HALFVEC

from app.models import SubtitleSegment

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
    # 真正的 halfvec(N) 在 migrations.py 里按运行时配置拼。
    Column("embedding", HALFVEC(), nullable=True),
    Column("created_at", DateTime, server_default=func.now()),
)


SEGMENT_EMBEDDINGS = Table(
    "segment_embeddings",
    pgvector_metadata,
    Column("segment_id", BigInteger, primary_key=True),
    Column("video_id", Integer, nullable=False),
    Column("category_id", Integer, nullable=True),
    Column("model", Text, nullable=False),
    Column("dim", SmallInteger, nullable=False),
    Column("embedding", HALFVEC(), nullable=False),
    Column("created_at", DateTime, server_default=func.now()),
)


# 检索源 → 表对象。subtitle_segments 直接复用 ORM 模型定义的表，
# 保证「字幕表的列」只有一个来源。
#
# 加新的检索源时在这里注册，不要在下游再写 if/else 拼字符串。
RETRIEVAL_TABLES: dict[str, Table] = {
    "chunks": CONTENT_CHUNKS,
    "segments": SubtitleSegment.__table__,
}


def retrieval_table(source: str | None = None) -> Table:
    """返回检索用的表对象。

    source 为空时读 settings.retrieval_source。未知取值直接抛错 ——
    静默回退到默认表正是「查错表还返回数据」的来源，宁可启动即失败。
    """
    if source is None:
        from app.database import settings

        source = settings.retrieval_source

    table = RETRIEVAL_TABLES.get(source)
    if table is None:
        raise ValueError(
            f"未知的 retrieval_source: {source!r}，可选：{sorted(RETRIEVAL_TABLES)}"
        )
    return table


def retrieval_table_name(source: str | None = None) -> str:
    """表名。给必须手写 SQL 的地方用（动态 WHERE / COPY 等）。

    即使手写 SQL，表名也不要自己拼 —— 从对象取。
    """
    return retrieval_table(source).name


# ─────────────────────────────────────────────────────────────────────
# DDL
#
# 为什么 DDL 也放这里：scripts/build_content_chunks.py 需要建 content_chunks，
# migrations.py 也需要建 —— 两处各写一份必然漂移（这次就已经漂了：
# 表只在脚本里建，而默认 retrieval_source 就是 chunks，新部署直接查不存在的表）。
#
# 为什么不用 create_all：halfvec(N) 的 N 来自运行时配置，
# HNSW 的 m / ef_construction 也不是 SQLAlchemy 类型系统能表达的。
# 原生 DDL 是这段唯一合理的写法，但可以做到「只写一次」。
# ─────────────────────────────────────────────────────────────────────


def segment_embeddings_ddl(dim: int) -> list[str]:
    """向量表的建表 + 索引 DDL（全部幂等，可重复执行）。"""
    return [
        f"""
        CREATE TABLE IF NOT EXISTS segment_embeddings (
            segment_id  BIGINT PRIMARY KEY,
            video_id    INTEGER NOT NULL,
            category_id INTEGER,
            model       TEXT NOT NULL,
            dim         SMALLINT NOT NULL,
            embedding   halfvec({dim}) NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_seg_emb_video ON segment_embeddings (video_id)",
        "CREATE INDEX IF NOT EXISTS ix_seg_emb_category ON segment_embeddings (category_id)",
        "CREATE INDEX IF NOT EXISTS ix_seg_emb_model ON segment_embeddings (model)",
        # HNSW：m=16 平衡召回与内存，ef_construction=64 建索引质量
        "CREATE INDEX IF NOT EXISTS ix_seg_emb_hnsw "
        "ON segment_embeddings USING hnsw (embedding halfvec_cosine_ops) "
        "WITH (m = 16, ef_construction = 64)",
    ]


def content_chunks_ddl(dim: int) -> list[str]:
    """语义块表的建表 + 索引 DDL（全部幂等）。"""
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
