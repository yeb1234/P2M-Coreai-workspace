"""Schema 演进（幂等）。

PostgreSQL 是 3.0 的主库：
- pgvector 存字幕片段向量，HNSW 索引做近似最近邻，取代 SQLite 全表暴力扫描
- pg_trgm 做中文三元组模糊匹配，取代对中文无效的 FTS5 默认分词

SQLite 分支仅用于历史库回滚，不再新增能力。
"""

from __future__ import annotations

import logging

from sqlalchemy import text

from app.database import Base, settings

logger = logging.getLogger(__name__)


def _safe_dim() -> int:
    dim = int(settings.embedding_dim)
    if dim <= 0 or dim > 8192:
        raise ValueError(f"embedding_dim 非法: {dim}")
    return dim


def _claim_legacy_ownership(conn) -> None:
    """把多用户改造之前的数据归给 owner，并保证系统里有管理员。

    3.0 之前的表要么没有 user_id（watch_history），要么有但一直是 NULL。
    如果不做归属，改成按 user_id 过滤后 owner 自己的历史数据会全部消失。

    owner 的选取顺序：
    1. ADMIN_USERNAMES 白名单里第一个真实存在的账号
    2. 最早创建的非占位账号（username != 'local'）
    3. 最早创建的任何账号
    """
    rows = conn.execute(text("SELECT id, username, role FROM users ORDER BY id")).fetchall()
    if not rows:
        return

    admins = {name.strip().lower() for name in (settings.admin_usernames or "").split(",") if name.strip()}
    owner_id = None
    for row in rows:
        if row[1] and row[1].lower() in admins:
            owner_id = row[0]
            break
    if owner_id is None:
        for row in rows:
            if row[1] != "local":
                owner_id = row[0]
                break
    if owner_id is None:
        owner_id = rows[0][0]

    # 保证至少有一个管理员，否则升级后管理端没人能进
    has_admin = conn.execute(text("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1")).first()
    if not has_admin:
        conn.execute(
            text("UPDATE users SET role = 'admin' WHERE id = :uid"), {"uid": owner_id}
        )
        logger.info("已将用户 id=%s 提升为管理员", owner_id)

    # 历史数据归属
    for table, column in (
        ("watch_events", "user_id"),
        ("watch_history", "user_id"),
        ("learning_goals", "user_id"),
        ("learning_paths", "user_id"),
    ):
        try:
            result = conn.execute(
                text(f"UPDATE {table} SET {column} = :uid WHERE {column} IS NULL"),
                {"uid": owner_id},
            )
            if result.rowcount:
                logger.info("归属历史数据 %s.%s: %s 行 -> 用户 %s", table, column, result.rowcount, owner_id)
        except Exception as exc:
            logger.debug("归属 %s 失败（表或列可能不存在）: %s", table, exc)


def upgrade_postgres(engine) -> None:
    """建扩展、建表、建索引。可重复执行。"""
    from app import models  # noqa: F401  确保 metadata 已注册

    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))

    Base.metadata.create_all(bind=engine)

    # create_all 只补缺失的表，不会给已存在的表加列。
    # 多用户字段必须显式 ALTER，否则 upgrade 到新版后隔离条件会直接报列不存在。
    with engine.begin() as conn:
        # ---- users：角色 / 令牌版本 / 启停 ----
        for statement in (
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'member'",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP",
        ):
            conn.execute(text(statement))

        conn.execute(
            text("ALTER TABLE watch_history ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)")
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_watch_history_user ON watch_history (user_id, watched_at DESC)")
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_watch_events_user_time ON watch_events (user_id, occurred_at DESC)")
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_chat_sessions_user ON chat_sessions (user_id, updated_at DESC)")
        )

        # 大表让 autovacuum 更积极地更新统计信息。
        # 实测踩过：subtitle_segments 有 359 万行，但 last_analyze 一直是 NULL，
        # n_live_tup 显示 0 —— 规划器以为这是张空表，会选错连接方式。
        # 默认阈值是 0.1 × 行数，批量导入 359 万行要再改 36 万次才触发一次分析。
        # 修完手动 ANALYZE 只花 274ms，说明成本极低，没必要省。
        for table, analyze_scale in (
            ("subtitle_segments", 0.02),
            ("segment_embeddings", 0.02),
            ("videos", 0.05),
        ):
            try:
                conn.execute(
                    text(
                        f"ALTER TABLE {table} SET ("
                        f"autovacuum_analyze_scale_factor = {analyze_scale}, "
                        f"autovacuum_analyze_threshold = 1000, "
                        f"autovacuum_vacuum_scale_factor = {analyze_scale * 2})"
                    )
                )
            except Exception as exc:
                logger.debug("设置 %s 的 autovacuum 参数失败（表可能尚不存在）: %s", table, exc)

        _claim_legacy_ownership(conn)

    dim = _safe_dim()
    with engine.begin() as conn:
        # 向量表用原生 DDL：halfvec(半精度) 相比 float4 省一半磁盘与内存，
        # 对 1024 维句向量召回损失可忽略。
        conn.execute(
            text(
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
                """
            )
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_seg_emb_video ON segment_embeddings (video_id)")
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_seg_emb_category ON segment_embeddings (category_id)")
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_seg_emb_model ON segment_embeddings (model)")
        )

        # HNSW：m=16 平衡召回与内存，ef_construction=64 建索引质量
        conn.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_seg_emb_hnsw
                ON segment_embeddings USING hnsw (embedding halfvec_cosine_ops)
                WITH (m = 16, ef_construction = 64)
                """
            )
        )

        # 中文模糊检索：pg_trgm 的 GIN 索引支持 ILIKE '%词%' 走索引
        conn.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_subtitle_segments_text_trgm
                ON subtitle_segments USING gin (text gin_trgm_ops)
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_videos_title_trgm
                ON videos USING gin (title gin_trgm_ops)
                """
            )
        )

        # 业务查询索引
        for statement in (
            "CREATE INDEX IF NOT EXISTS ix_videos_category_sort ON videos (category_id, sort_key)",
            "CREATE INDEX IF NOT EXISTS ix_videos_favorite ON videos (is_favorite, favorited_at DESC)",
            "CREATE INDEX IF NOT EXISTS ix_watch_history_video_watched ON watch_history (video_id, watched_at DESC)",
            "CREATE INDEX IF NOT EXISTS ix_subtitle_segments_video_index ON subtitle_segments (video_id, segment_index)",
            "CREATE INDEX IF NOT EXISTS ix_ai_jobs_status_created ON ai_jobs (status, created_at DESC)",
        ):
            try:
                conn.execute(text(statement))
            except Exception:
                logger.debug("索引已存在或创建失败: %s", statement)

    logger.info("PostgreSQL schema 就绪（pgvector dim=%s）", dim)


def upgrade_sqlite_legacy(engine) -> None:
    """历史 SQLite 库的兼容迁移，仅在回滚场景使用。

    保留原有 PRAGMA 与手写 ALTER 逻辑，保证旧库仍能启动。
    """
    if not settings.database_url.startswith("sqlite"):
        return

    with engine.begin() as connection:
        video_columns = {
            row[1] for row in connection.exec_driver_sql("PRAGMA table_info(videos)").fetchall()
        }
        for column_name, column_sql in (
            ("sort_key", "TEXT"),
            ("is_favorite", "BOOLEAN DEFAULT 0"),
            ("favorited_at", "DATETIME"),
        ):
            if column_name not in video_columns:
                connection.exec_driver_sql(f"ALTER TABLE videos ADD COLUMN {column_name} {column_sql}")

        for statement in (
            "CREATE INDEX IF NOT EXISTS ix_videos_category_sort ON videos(category_id, sort_key)",
            "CREATE INDEX IF NOT EXISTS ix_watch_history_video_watched ON watch_history(video_id, watched_at)",
            "CREATE INDEX IF NOT EXISTS ix_subtitle_segments_video_index ON subtitle_segments(video_id, segment_index)",
            "CREATE INDEX IF NOT EXISTS ix_ai_jobs_status_created ON ai_jobs(status, created_at)",
        ):
            connection.exec_driver_sql(statement)

        connection.exec_driver_sql(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at DATETIME
            )
            """
        )

        ai_job_columns = {
            row[1] for row in connection.exec_driver_sql("PRAGMA table_info(ai_jobs)").fetchall()
        }
        for column_name, column_sql in (
            ("cpu_threads", "INTEGER"),
            ("compute_type", "TEXT"),
            ("beam_size", "INTEGER"),
            ("best_of", "INTEGER"),
            ("temperature", "FLOAT"),
            ("vad_filter", "BOOLEAN"),
            ("device_type", "TEXT"),
            ("subtitle_correction_enabled", "BOOLEAN"),
            ("subtitle_correction_scope", "TEXT"),
            ("subtitle_correction_prompt", "TEXT"),
            ("whisper_engine", "TEXT"),
        ):
            if column_name not in ai_job_columns:
                connection.exec_driver_sql(f"ALTER TABLE ai_jobs ADD COLUMN {column_name} {column_sql}")

        # FTS5 保留：SQLite 回滚场景下旧检索仍可用
        try:
            connection.exec_driver_sql(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS subtitle_segments_fts
                USING fts5(text, content='subtitle_segments', content_rowid='id')
                """
            )
            connection.exec_driver_sql(
                """
                CREATE TRIGGER IF NOT EXISTS subtitle_segments_ai AFTER INSERT ON subtitle_segments BEGIN
                    INSERT INTO subtitle_segments_fts(rowid, text) VALUES (new.id, new.text);
                END
                """
            )
            connection.exec_driver_sql(
                """
                CREATE TRIGGER IF NOT EXISTS subtitle_segments_ad AFTER DELETE ON subtitle_segments BEGIN
                    INSERT INTO subtitle_segments_fts(subtitle_segments_fts, rowid, text)
                    VALUES ('delete', old.id, old.text);
                END
                """
            )
            connection.exec_driver_sql(
                """
                CREATE TRIGGER IF NOT EXISTS subtitle_segments_au AFTER UPDATE ON subtitle_segments BEGIN
                    INSERT INTO subtitle_segments_fts(subtitle_segments_fts, rowid, text)
                    VALUES ('delete', old.id, old.text);
                    INSERT INTO subtitle_segments_fts(rowid, text) VALUES (new.id, new.text);
                END
                """
            )
        except Exception:
            logger.warning("SQLite FTS5 不可用，模糊检索退回 LIKE")

        # 复合唯一索引：同名分类可存在于不同父级下
        try:
            for idx in connection.exec_driver_sql("PRAGMA index_list(categories)").fetchall():
                if idx[2]:
                    info = connection.exec_driver_sql(f"PRAGMA index_info({idx[1]})").fetchall()
                    if [row[2] for row in info] == ["name"]:
                        connection.exec_driver_sql(f"DROP INDEX IF EXISTS {idx[1]}")
            connection.exec_driver_sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS uix_category_name_parent ON categories(name, parent_id)"
            )
        except Exception:
            logger.debug("categories 唯一索引调整跳过")

    logger.info("SQLite legacy schema 就绪")


def embedding_stats(engine) -> dict:
    """向量覆盖率统计，供 /health 与后台任务使用。"""
    with engine.connect() as conn:
        if settings.is_postgres:
            row = conn.execute(
                text(
                    """
                    SELECT
                      (SELECT count(*) FROM segment_embeddings) AS embedded,
                      (SELECT count(*) FROM subtitle_segments
                        WHERE length(text) >= :min_len) AS eligible
                    """
                ),
                {"min_len": settings.embedding_min_text_len},
            ).first()
        else:
            row = conn.execute(
                text(
                    """
                    SELECT
                      (SELECT count(*) FROM segment_embeddings) AS embedded,
                      (SELECT count(*) FROM subtitle_segments
                        WHERE length(text) >= :min_len) AS eligible
                    """
                ),
                {"min_len": settings.embedding_min_text_len},
            ).first()
    embedded = int(row[0] or 0) if row else 0
    eligible = int(row[1] or 0) if row else 0
    return {
        "embedded": embedded,
        "eligible": eligible,
        "coverage": round(embedded / eligible, 4) if eligible else 0.0,
    }
