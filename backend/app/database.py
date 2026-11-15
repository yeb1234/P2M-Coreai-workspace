"""Database configuration and schema bootstrap.

3.0 起主库为 PostgreSQL + pgvector：
- 业务数据（视频/字幕/笔记/计划）落 PostgreSQL，解决 SQLite 单写锁与 15GB 体积问题
- 向量检索走 pgvector 的 HNSW 索引，不再做全表暴力扫描

SQLite 仅作为迁移来源（settings.sqlite_source_url）与只读回滚点保留。
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import declarative_base, sessionmaker


ROOT_DIR = Path(__file__).resolve().parents[2]
logger = logging.getLogger(__name__)

DEFAULT_CORS_ORIGINS = "http://localhost:5002,http://localhost:5173,http://localhost"


class Settings(BaseSettings):
    # ---------------- 数据库 ----------------
    database_url: str = "postgresql+psycopg://p2user:p2user@localhost:5432/p2learning"
    sqlite_source_url: str = ""
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_pool_recycle_s: int = 1800
    db_echo: bool = False

    # ---------------- 路径 ----------------
    video_folder: str = str(ROOT_DIR / "videos")
    # ---- 日志 ----
    log_level: str = "INFO"
    # 为空则只走 stdout（交给 docker 采集）；设了目录就额外写一份 JSONL 到磁盘。
    # 为什么两处都写：stdout 给 docker logs 用，文件给「重建容器后还能查历史」用。
    log_dir: str = ""
    # 进程名，决定文件名：{log_dir}/{log_file_name}.jsonl
    # backend 和 worker 必须用不同文件 —— RotatingFileHandler 不是多进程安全的，
    # 两个进程同时轮转同一个文件会互相截断。
    log_file_name: str = "app"
    log_max_bytes: int = 20 * 1024 * 1024
    log_backup_count: int = 5

    work_dir: str = ""
    output_dir: str = ""
    thumbnail_dir: str = ""
    sprite_dir: str = ""
    # 宿主机路径 -> 容器内路径的映射，多个用 ; 分隔，最长前缀优先。
    # 例：D:/ITJC/thumbnails=/data/thumbnails;D:/ITJC=/videos
    # 数据库里的 filepath 是容器化之前写入的 Windows 绝对路径，需要这层转换
    path_map: str = ""

    # ---------------- 本地 LLM ----------------
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:7b-instruct"
    openai_base_url: str = "http://localhost:1234/v1"
    openai_api_key: str = "lm-studio"
    openai_model: str = "qwen3-4b"
    assistant_llm_provider: str = "openai"

    # ---------------- 外部 LLM ----------------
    external_llm_base_url: str = "https://discovery-api.intern-ai.org.cn/v1"
    external_llm_api_key: str = ""
    external_llm_model: str = "deepseek-v4.1-flash-1017"
    external_llm_thinking: bool = False
    external_llm_timeout_s: int = 120
    llm_usage_policy: str = "external_first"
    llm_context_token_limit: int = 32000

    # ---------------- 向量与重排 ----------------
    embedding_base_url: str = "http://localhost:1234/v1"
    embedding_api_key: str = "lm-studio"
    embedding_model: str = "text-embedding-bge-m3@q8_0"
    embedding_dim: int = 1024
    embedding_batch_size: int = 16
    embedding_timeout_s: int = 120
    rerank_enabled: bool = True
    rerank_top_n: int = 20
    rerank_keep: int = 6

    # 专用 reranker（cross-encoder）。留空则回退到原来的 LLM listwise 重排。
    # 用 API 而不是本地 LM Studio：后者 /v1/rerank 支持不一致。
    rerank_api_url: str = "https://api.siliconflow.cn/v1/rerank"
    rerank_api_key: str = ""
    rerank_model: str = "BAAI/bge-reranker-v2-m3"
    # cross-encoder 的分数区分度极大（相关 0.99 / 无关 0.00002），
    # 所以这里的阈值是真正可用的 —— 向量余弦分做不到这一点
    rerank_min_score: float = 0.02

    # ---------------- Whisper ----------------
    default_whisper_model: str = "small"
    default_language: str = "zh"
    whisper_engine: str = "faster-whisper"
    whisper_cpp_exe: str = ""
    whisper_cpp_model: str = ""
    whisper_cpp_extra_args: str = ""
    whisper_cpu_threads: int = min(6, max(1, (os.cpu_count() or 4) - 2))
    whisper_compute_type: str = "int8"
    whisper_beam_size: int = 5
    whisper_best_of: int = 5
    whisper_temperature: float = 0.0
    whisper_vad_filter: bool = True
    subtitle_correction_enabled: bool = False
    subtitle_correction_scope: str = "full"
    subtitle_correction_batch_size: int = 60
    subtitle_correction_timeout_s: int = 180
    device_type: str = "auto"

    # ---------------- 队列 ----------------
    redis_url: str = "redis://localhost:6379/0"
    # 是否在 API 进程里内嵌一个 worker 子进程。
    #
    # True（默认）：单进程部署时也能跑转写，起一个子进程 + 监督线程，崩了重拉。
    # False：worker 由外部编排负责（docker compose 的 worker 服务）。
    #
    # **两种模式不能同时开**。两个 RQ worker 会抢同一个队列，
    # 还会互相把对方的注册记录当僵尸清掉（_clean_dead_workers），
    # 表现为「明明有 worker 在跑，任务却一直排队」。
    # 这个冲突实际发生过：容器里的 worker 和后端拉起的 worker 同时活着，
    # Redis 里只剩一个注册。
    ai_worker_embedded: bool = True
    ai_worker_concurrency: int = 1
    ai_worker_poll_interval: float = 2.0
    ai_worker_requeue_running_on_start: bool = True
    thumbnail_background_enabled: bool = False
    thumbnail_background_idle_cycles: int = 10
    thumbnail_background_limit: int = 1
    sprite_background_enabled: bool = False
    sprite_frame_width: int = 320
    sprite_frame_interval: int = 5
    sprite_columns: int = 10
    sprite_jpeg_quality: int = 2

    # ---------------- 安全 ----------------
    jwt_secret: str = "dev-only-change-me-please-set-JWT_SECRET-in-env"
    jwt_algorithm: str = "HS256"
    # 缩短到 12 小时：令牌泄露的暴露窗口直接砍半，配合 token_version 可强制下线
    jwt_expire_hours: int = 12
    cors_origins: str = DEFAULT_CORS_ORIGINS
    enable_docs: bool = False
    # 关闭后只有管理员能建号。个人/小团队部署建议关，避免公网被灌号
    allow_registration: bool = False
    # 逗号分隔的用户名白名单，命中即以 admin 角色注册
    admin_usernames: str = ""
    # 会话 Cookie：令牌放 httpOnly Cookie，JS 读不到，XSS 也偷不走
    session_cookie_name: str = "p2m_session"
    # 生产必须是 true（只走 HTTPS）。本地 http 调试要设 false，否则浏览器不发送
    cookie_secure: bool = False
    cookie_samesite: str = "lax"
    # ---- 多用户每日配额（防单账号跑光外部 LLM 额度）----
    quota_chat_daily: int = 200
    quota_plan_daily: int = 20
    # 管理员倍率：要能压测和排查，但也不是无限
    quota_admin_multiplier: int = 5

    # 额外要求：非 GET 请求必须带 Origin 且命中白名单（挡 CSRF，SameSite 之外的第二道）

    model_config = SettingsConfigDict(
        env_file=str(ROOT_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    @property
    def is_postgres(self) -> bool:
        return self.database_url.startswith("postgresql")

    @property
    def cors_origin_list(self) -> list[str]:
        items = [part.strip() for part in (self.cors_origins or "").split(",") if part.strip()]
        return items or ["http://localhost:5002"]

    @property
    def admin_username_set(self) -> set[str]:
        return {
            part.strip().lower()
            for part in (self.admin_usernames or "").split(",")
            if part.strip()
        }

    @property
    def resolved_work_dir(self) -> str:
        return self.work_dir or str(Path(self.video_folder) / "work")

    @property
    def resolved_output_dir(self) -> str:
        return self.output_dir or str(Path(self.video_folder) / "output")

    @property
    def resolved_thumbnail_dir(self) -> str:
        return self.thumbnail_dir or str(Path(self.video_folder) / "thumbnails")

    @property
    def resolved_sprite_dir(self) -> str:
        return self.sprite_dir or str(Path(self.video_folder) / "sprites")


settings = Settings()

# 兼容既有代码里 settings.work_dir / output_dir / thumbnail_dir / sprite_dir 的读取
if not settings.work_dir:
    settings.work_dir = str(Path(settings.video_folder) / "work")
if not settings.output_dir:
    settings.output_dir = str(Path(settings.video_folder) / "output")
if not settings.thumbnail_dir:
    settings.thumbnail_dir = str(Path(settings.video_folder) / "thumbnails")
if not settings.sprite_dir:
    settings.sprite_dir = str(Path(settings.video_folder) / "sprites")

for folder in (
    settings.video_folder,
    settings.work_dir,
    settings.output_dir,
    settings.thumbnail_dir,
    settings.sprite_dir,
):
    try:
        Path(folder).mkdir(parents=True, exist_ok=True)
    except OSError:
        # 视频盘未挂载时不应阻塞 API 启动
        logger.warning("无法创建目录 %s，跳过", folder)


def _build_engine():
    url = settings.database_url
    if url.startswith("sqlite"):
        return create_engine(
            url,
            connect_args={"check_same_thread": False, "timeout": 30},
            echo=settings.db_echo,
        )
    return create_engine(
        url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_pre_ping=True,
        pool_recycle=settings.db_pool_recycle_s,
        echo=settings.db_echo,
        future=True,
    )


engine = _build_engine()


@event.listens_for(engine, "connect")
def _configure_connection(dbapi_connection, _connection_record):
    """SQLite 仅用于迁移读取，保留 WAL 以提升并发读性能；PG 无需额外设置。"""
    if not settings.database_url.startswith("sqlite"):
        return
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=30000")
    cursor.close()


SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
    bind=engine,
)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_database(deep: bool = True) -> dict:
    """返回数据库连通性摘要。

    deep=False 时不统计向量相关行数：那些表很大，
    而探针每 30 秒被打一次，把 count(*) 放进探针等于给数据库加了一份
    与业务无关的持续负载。存活探针只需要知道「连得上、查得动」。
    """
    info: dict = {"backend": "postgresql" if settings.is_postgres else "sqlite"}
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
        if settings.is_postgres:
            row = connection.execute(
                text(
                    "SELECT current_setting('server_version'), "
                    "(SELECT extversion FROM pg_extension WHERE extname='vector'), "
                    "(SELECT extversion FROM pg_extension WHERE extname='pg_trgm')"
                )
            ).first()
            if row:
                info.update(
                    server_version=row[0],
                    pgvector_version=row[1],
                    pg_trgm_version=row[2],
                )
            if deep:
                # 深探针才查，浅探针每 30 秒一次，不该给库加无关负载
                from app.tables import CONTENT_CHUNKS

                info["content_chunks"] = connection.execute(
                    text(f"SELECT count(*) FROM {CONTENT_CHUNKS.name}")
                ).scalar()
    return info


# 长事务判定阈值。
#
# 60 秒：正常业务事务都是毫秒级；60 秒还没结束，基本就是
# 「把网络请求 / 子进程 / 文件 IO 夹在 SELECT 和 commit 之间」。
# 30 秒：有查询在等锁超过 30 秒，说明已经有人堵住了别人。
LONG_TX_WARN_SECONDS = 60
BLOCKED_WARN_SECONDS = 30


def check_transactions() -> dict:
    """事务健康度：长事务和锁等待。

    为什么要专门监控这个
    ------------------
    2026-11-16 实际故障：缩略图 worker 把 ffmpeg 夹在
    `db.query(Video)` 和 `db.commit()` 之间，4 个线程各占一个
    videos 表的 ACCESS SHARE 锁。结果迁移里的
    `ALTER TABLE videos ADD COLUMN` 等了 12 分 30 秒，
    后端卡在「初始化 schema」，healthcheck 一直失败，整站 502。

    这个故障的特点：**应用日志里一个字都没有**。
    不报错、不超时、不打日志，只是让别的东西无声地排队。
    唯一的线索就在 pg_stat_activity 里。

    所以把它放进 /health：docker 会把探针输出存下来，
    出问题时 `docker inspect` 就能看到，不用再去连数据库。

    查询本身很便宜（读一个系统视图），可以每 30 秒跑一次。
    """
    if not settings.is_postgres:
        return {"level": "ok", "reason": "sqlite"}

    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT
                  count(*) FILTER (WHERE state = 'idle in transaction'),
                  COALESCE(max(EXTRACT(EPOCH FROM now() - state_change))
                           FILTER (WHERE state = 'idle in transaction'), 0),
                  count(*) FILTER (WHERE wait_event_type = 'Lock'),
                  COALESCE(max(EXTRACT(EPOCH FROM now() - query_start))
                           FILTER (WHERE wait_event_type = 'Lock'), 0)
                FROM pg_stat_activity
                WHERE datname = current_database()
                  AND pid <> pg_backend_pid()
                """
            )
        ).first()

    idle_tx = int(row[0] or 0) if row else 0
    longest_idle = float(row[1] or 0) if row else 0.0
    blocked = int(row[2] or 0) if row else 0
    longest_blocked = float(row[3] or 0) if row else 0.0

    warnings: list[str] = []
    if idle_tx and longest_idle >= LONG_TX_WARN_SECONDS:
        warnings.append(
            f"{idle_tx} 个会话 idle in transaction，最长 {longest_idle:.0f}s"
            f"（会阻塞 ALTER TABLE / CREATE INDEX，进而卡死迁移）"
        )
    if blocked and longest_blocked >= BLOCKED_WARN_SECONDS:
        warnings.append(
            f"{blocked} 个查询在等锁，最长 {longest_blocked:.0f}s"
        )

    return {
        "level": "warn" if warnings else "ok",
        "idle_in_transaction": idle_tx,
        "longest_idle_tx_sec": round(longest_idle, 1),
        "blocked_queries": blocked,
        "longest_blocked_sec": round(longest_blocked, 1),
        "warnings": warnings,
    }


def ensure_runtime_schema() -> None:
    """建表与索引（幂等）。PostgreSQL 走 pgvector + pg_trgm，SQLite 仅保留最小结构。"""
    if settings.is_postgres:
        from app.migrations import upgrade_postgres

        upgrade_postgres(engine)
        return

    from app.migrations import upgrade_sqlite_legacy

    upgrade_sqlite_legacy(engine)
