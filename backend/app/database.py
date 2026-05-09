import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import declarative_base, sessionmaker


ROOT_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    database_url: str = f"sqlite:///{ROOT_DIR / 'learning_os.db'}"
    video_folder: str = str(ROOT_DIR / "videos")
    work_dir: str = str(ROOT_DIR / "work")
    output_dir: str = str(ROOT_DIR / "output")
    thumbnail_dir: str = str(ROOT_DIR / "thumbnails")
    sprite_dir: str = str(ROOT_DIR / "sprites")
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:7b-instruct"
    default_whisper_model: str = "small"
    default_language: str = "zh"
    external_llm_base_url: str = "https://token.sensenova.cn/v1"
    external_llm_api_key: str = ""
    external_llm_model: str = "sensenova-6.7-flash-lite"
    assistant_llm_provider: str = "local"
    openai_base_url: str = "http://localhost:1234/v1"
    openai_api_key: str = "lm-studio"
    openai_model: str = "qwen3-vl-8b"
    ai_worker_concurrency: int = 1
    ai_worker_poll_interval: float = 2.0
    ai_worker_requeue_running_on_start: bool = False
    thumbnail_background_enabled: bool = False
    thumbnail_background_idle_cycles: int = 10
    thumbnail_background_limit: int = 1
    whisper_cpu_threads: int = min(4, os.cpu_count() or 4)
    whisper_compute_type: str = "int8"
    whisper_beam_size: int = 5
    whisper_best_of: int = 5
    whisper_temperature: float = 0.0
    whisper_vad_filter: bool = True
    subtitle_correction_enabled: bool = True
    subtitle_correction_batch_size: int = 60
    subtitle_correction_timeout_s: int = 180
    whisper_engine: str = "faster-whisper"
    whisper_cpp_exe: str = ""
    whisper_cpp_model: str = ""
    whisper_cpp_extra_args: str = ""

    model_config = SettingsConfigDict(env_file=str(ROOT_DIR / ".env"), env_file_encoding="utf-8", extra="ignore")


settings = Settings()

for folder in (settings.video_folder, settings.work_dir, settings.output_dir, settings.thumbnail_dir, settings.sprite_dir):
    Path(folder).mkdir(parents=True, exist_ok=True)

engine = create_engine(settings.database_url, connect_args={"check_same_thread": False})


@event.listens_for(engine, "connect")
def configure_sqlite_connection(dbapi_connection, _connection_record):
    if not settings.database_url.startswith("sqlite"):
        return
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, expire_on_commit=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_runtime_schema() -> None:
    """Small SQLite migrations for the local MVP without introducing Alembic yet."""
    if not settings.database_url.startswith("sqlite"):
        return

    with engine.begin() as connection:
        video_columns = {
            row[1]
            for row in connection.exec_driver_sql("PRAGMA table_info(videos)").fetchall()
        }
        if "sort_key" not in video_columns:
            connection.exec_driver_sql("ALTER TABLE videos ADD COLUMN sort_key TEXT")

        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_videos_category_sort ON videos(category_id, sort_key)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_videos_sort_key ON videos(sort_key)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_watch_history_video_watched ON watch_history(video_id, watched_at)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_subtitle_segments_video_index ON subtitle_segments(video_id, segment_index)"
        )
        ai_job_columns = {
            row[1]
            for row in connection.exec_driver_sql("PRAGMA table_info(ai_jobs)").fetchall()
        }
        for column_name, column_sql in (
            ("cpu_threads", "INTEGER"),
            ("compute_type", "TEXT"),
            ("beam_size", "INTEGER"),
            ("best_of", "INTEGER"),
            ("temperature", "FLOAT"),
            ("vad_filter", "BOOLEAN"),
            ("subtitle_correction_enabled", "BOOLEAN"),
            ("subtitle_correction_prompt", "TEXT"),
            ("whisper_engine", "TEXT"),
        ):
            if column_name not in ai_job_columns:
                connection.exec_driver_sql(f"ALTER TABLE ai_jobs ADD COLUMN {column_name} {column_sql}")

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
            fts_count = connection.exec_driver_sql("SELECT count(*) FROM subtitle_segments_fts").scalar() or 0
            segment_count = connection.exec_driver_sql("SELECT count(*) FROM subtitle_segments").scalar() or 0
            if segment_count and not fts_count:
                connection.execute(text("INSERT INTO subtitle_segments_fts(subtitle_segments_fts) VALUES ('rebuild')"))
        except Exception:
            # Some SQLite builds omit FTS5; substring fallback search remains available.
            pass
