import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import declarative_base, sessionmaker


ROOT_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    database_url: str = f"sqlite:///{ROOT_DIR / 'learning_os.db'}"
    video_folder: str = str(ROOT_DIR / "videos")
    work_dir: str = ""
    output_dir: str = ""
    thumbnail_dir: str = ""
    sprite_dir: str = ""
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:7b-instruct"
    default_whisper_model: str = "small"
    default_language: str = "zh"
    external_llm_base_url: str = "https://token.sensenova.cn/v1"
    external_llm_api_key: str = ""
    external_llm_model: str = "deepseek-v4-flash"
    llm_usage_policy: str = "local_first"
    llm_context_token_limit: int = 8000
    assistant_llm_provider: str = "local"
    openai_base_url: str = "http://192.168.3.161:1234/v1"
    openai_api_key: str = "lm-studio"
    openai_model: str = "qwen3-vl-8b"
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
    whisper_engine: str = "faster-whisper"
    device_type: str = "auto"
    whisper_cpp_exe: str = ""
    whisper_cpp_model: str = ""
    whisper_cpp_extra_args: str = ""
    jwt_secret: str = "p2m-local-dev-secret-change-in-prod"
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 2160

    model_config = SettingsConfigDict(env_file=str(ROOT_DIR / ".env"), env_file_encoding="utf-8", extra="ignore")


settings = Settings()

if not settings.work_dir:
    settings.work_dir = str(Path(settings.video_folder) / "work")
if not settings.output_dir:
    settings.output_dir = str(Path(settings.video_folder) / "output")
if not settings.thumbnail_dir:
    settings.thumbnail_dir = str(Path(settings.video_folder) / "thumbnails")
if not settings.sprite_dir:
    settings.sprite_dir = str(Path(settings.video_folder) / "sprites")

for folder in (settings.video_folder, settings.work_dir, settings.output_dir, settings.thumbnail_dir, settings.sprite_dir):
    Path(folder).mkdir(parents=True, exist_ok=True)

engine = create_engine(
    settings.database_url,
    connect_args={
        "check_same_thread": False,
        "timeout": 30,
    } if settings.database_url.startswith("sqlite") else {},
)


@event.listens_for(engine, "connect")
def configure_sqlite_connection(dbapi_connection, _connection_record):
    if not settings.database_url.startswith("sqlite"):
        return
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=30000")
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
        if "is_favorite" not in video_columns:
            connection.exec_driver_sql("ALTER TABLE videos ADD COLUMN is_favorite BOOLEAN DEFAULT 0")
        if "favorited_at" not in video_columns:
            connection.exec_driver_sql("ALTER TABLE videos ADD COLUMN favorited_at DATETIME")

        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_videos_category_sort ON videos(category_id, sort_key)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_videos_sort_key ON videos(sort_key)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_videos_favorite ON videos(is_favorite, favorited_at)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_watch_history_video_watched ON watch_history(video_id, watched_at)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_watch_history_watched ON watch_history(watched_at)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_subtitle_segments_video_index ON subtitle_segments(video_id, segment_index)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_ai_jobs_status_created ON ai_jobs(status, created_at)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_ai_jobs_video_status ON ai_jobs(video_id, status)"
        )
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
            ("device_type", "TEXT"),
            ("subtitle_correction_enabled", "BOOLEAN"),
            ("subtitle_correction_scope", "TEXT"),
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

        connection.exec_driver_sql(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                display_name TEXT,
                created_at DATETIME,
                updated_at DATETIME
            )
            """
        )
        connection.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users(username)"
        )
        connection.exec_driver_sql(
            """
            CREATE TABLE IF NOT EXISTS user_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                store_key TEXT NOT NULL,
                value TEXT NOT NULL,
                updated_at DATETIME
            )
            """
        )
        connection.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_user_data_user_store ON user_data(user_id, store_key)"
        )
        connection.exec_driver_sql(
            """
            CREATE TABLE IF NOT EXISTS schedule_items (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                priority TEXT NOT NULL DEFAULT 'green',
                start_at DATETIME,
                due_at DATETIME,
                reminder_at DATETIME,
                pomodoro_count INTEGER NOT NULL DEFAULT 0,
                pomodoro_rounds INTEGER NOT NULL DEFAULT 0,
                total_focus_minutes INTEGER NOT NULL DEFAULT 0,
                completed_at DATETIME,
                deleted_at DATETIME,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME,
                updated_at DATETIME
            )
            """
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_schedule_items_user_type ON schedule_items(user_id, type)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_schedule_items_user_start ON schedule_items(user_id, start_at)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_schedule_items_user_due ON schedule_items(user_id, due_at)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_schedule_items_user_status ON schedule_items(user_id, status)"
        )
        schedule_columns = {
            row[1]: row
            for row in connection.exec_driver_sql("PRAGMA table_info(schedule_items)").fetchall()
        }
        if schedule_columns.get("start_at", (None, None, None, 0))[3] or schedule_columns.get("due_at", (None, None, None, 0))[3]:
            connection.exec_driver_sql("DROP TABLE IF EXISTS schedule_items_nullable_time")
            connection.exec_driver_sql(
                """
                CREATE TABLE schedule_items_nullable_time (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'pending',
                    priority TEXT NOT NULL DEFAULT 'green',
                    start_at DATETIME,
                    due_at DATETIME,
                    reminder_at DATETIME,
                    pomodoro_count INTEGER NOT NULL DEFAULT 0,
                    pomodoro_rounds INTEGER NOT NULL DEFAULT 0,
                    total_focus_minutes INTEGER NOT NULL DEFAULT 0,
                    completed_at DATETIME,
                    deleted_at DATETIME,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at DATETIME,
                    updated_at DATETIME
                )
                """
            )
            connection.exec_driver_sql(
                """
                INSERT INTO schedule_items_nullable_time (
                    id, user_id, type, title, description, status, priority,
                    start_at, due_at, reminder_at, pomodoro_count, pomodoro_rounds,
                    total_focus_minutes, completed_at, deleted_at, sort_order,
                    created_at, updated_at
                )
                SELECT
                    id, user_id, type, title, description, status, priority,
                    start_at, due_at, reminder_at, pomodoro_count, pomodoro_rounds,
                    total_focus_minutes, completed_at, deleted_at, sort_order,
                    created_at, updated_at
                FROM schedule_items
                """
            )
            connection.exec_driver_sql("DROP TABLE schedule_items")
            connection.exec_driver_sql("ALTER TABLE schedule_items_nullable_time RENAME TO schedule_items")
            connection.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_schedule_items_user_type ON schedule_items(user_id, type)"
            )
            connection.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_schedule_items_user_start ON schedule_items(user_id, start_at)"
            )
            connection.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_schedule_items_user_due ON schedule_items(user_id, due_at)"
            )
            connection.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_schedule_items_user_status ON schedule_items(user_id, status)"
            )
