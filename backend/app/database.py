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
    embedding_min_text_len: int = 8
    rerank_enabled: bool = True
    rerank_top_n: int = 20
    rerank_keep: int = 6

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
    jwt_expire_hours: int = 24
    cors_origins: str = DEFAULT_CORS_ORIGINS
    enable_docs: bool = True

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


def check_database() -> dict:
    """返回数据库连通性摘要，供 /health 与 /ready 使用。"""
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
            info["segment_embeddings"] = connection.execute(
                text("SELECT count(*) FROM segment_embeddings")
            ).scalar()
    return info


def ensure_runtime_schema() -> None:
    """建表与索引（幂等）。PostgreSQL 走 pgvector + pg_trgm，SQLite 仅保留最小结构。"""
    if settings.is_postgres:
        from app.migrations import upgrade_postgres

        upgrade_postgres(engine)
        return

    from app.migrations import upgrade_sqlite_legacy

    upgrade_sqlite_legacy(engine)
