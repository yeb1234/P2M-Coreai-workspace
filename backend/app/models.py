from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    path = Column(String, unique=True, nullable=False)
    sort_order = Column(Integer, default=0)
    parent_id = Column(Integer, ForeignKey("categories.id"), nullable=True)

    videos = relationship("Video", back_populates="category")
    children = relationship("Category", backref="parent", remote_side=[id])


class Video(Base):
    __tablename__ = "videos"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True, nullable=False)
    filename = Column(String, nullable=False)
    filepath = Column(String, unique=True, nullable=False)
    sort_key = Column(String, index=True, nullable=True)
    file_size = Column(Integer, default=0)
    duration = Column(Float, nullable=True)
    thumbnail = Column(String, nullable=True)
    tags = Column(String, nullable=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    transcription = Column(Text, nullable=True)
    transcript_segments = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    markdown_path = Column(String, nullable=True)
    subtitle_path = Column(String, nullable=True)
    ai_status = Column(String, default="idle")
    ai_stage = Column(String, nullable=True)
    ai_error = Column(Text, nullable=True)
    is_favorite = Column(Boolean, default=False, index=True)
    favorited_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    category = relationship("Category", back_populates="videos")
    watch_history = relationship("WatchHistory", back_populates="video", cascade="all, delete-orphan")
    notes = relationship("Note", back_populates="video", cascade="all, delete-orphan")
    ai_jobs = relationship("AiJob", back_populates="video", cascade="all, delete-orphan")
    subtitle_segments = relationship("SubtitleSegment", back_populates="video", cascade="all, delete-orphan")


class WatchHistory(Base):
    __tablename__ = "watch_history"

    id = Column(Integer, primary_key=True, index=True)
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=False)
    progress = Column(Float, default=0)
    duration = Column(Float, default=0)
    completed = Column(Boolean, default=False)
    watched_at = Column(DateTime, default=datetime.now)

    video = relationship("Video", back_populates="watch_history")


class AiJob(Base):
    __tablename__ = "ai_jobs"

    id = Column(String, primary_key=True, index=True)
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=False)
    status = Column(String, default="queued")
    stage = Column(String, default="queued")
    message = Column(String, default="Queued")
    error = Column(Text, nullable=True)
    whisper_engine = Column(String, nullable=True)
    whisper_model = Column(String, default="small")
    language = Column(String, default="zh")
    do_summary = Column(Boolean, default=True)
    word_limit = Column(Integer, default=200)
    ollama_model = Column(String, nullable=True)
    cpu_threads = Column(Integer, nullable=True)
    compute_type = Column(String, nullable=True)
    beam_size = Column(Integer, nullable=True)
    best_of = Column(Integer, nullable=True)
    temperature = Column(Float, nullable=True)
    vad_filter = Column(Boolean, nullable=True)
    subtitle_correction_enabled = Column(Boolean, nullable=True)
    subtitle_correction_scope = Column(String, nullable=True)
    subtitle_correction_prompt = Column(Text, nullable=True)
    transcript = Column(Text, nullable=True)
    transcript_segments = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    summary_error = Column(Text, nullable=True)
    markdown_path = Column(String, nullable=True)
    subtitle_path = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    video = relationship("Video", back_populates="ai_jobs")


class AppSetting(Base):
    __tablename__ = "app_settings"

    key = Column(String, primary_key=True, index=True)
    value = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class Note(Base):
    __tablename__ = "notes"

    id = Column(Integer, primary_key=True, index=True)
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=True)
    title = Column(String, nullable=False)
    content = Column(Text, default="")
    source = Column(String, default="manual")
    markdown_path = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    video = relationship("Video", back_populates="notes")


class SubtitleSegment(Base):
    __tablename__ = "subtitle_segments"
    __table_args__ = (
        Index("ix_subtitle_segments_video_index", "video_id", "segment_index"),
    )

    id = Column(Integer, primary_key=True, index=True)
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=False, index=True)
    segment_index = Column(Integer, nullable=False)
    start_sec = Column(Float, nullable=False)
    end_sec = Column(Float, nullable=False)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.now)

    video = relationship("Video", back_populates="subtitle_segments")


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(String, primary_key=True, index=True)
    title = Column(String, nullable=False, default="Learning Assistant")
    scope = Column(String, nullable=False, default="global")
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(String, primary_key=True, index=True)
    session_id = Column(String, ForeignKey("chat_sessions.id"), nullable=False, index=True)
    role = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    references_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.now)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    display_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    data = relationship("UserData", back_populates="user", cascade="all, delete-orphan")


class UserData(Base):
    __tablename__ = "user_data"
    __table_args__ = (
        Index("ix_user_data_user_store", "user_id", "store_key", unique=True),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    store_key = Column(String, nullable=False)
    value = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    user = relationship("User", back_populates="data")


class ScheduleItem(Base):
    __tablename__ = "schedule_items"
    __table_args__ = (
        Index("ix_schedule_items_user_type", "user_id", "type"),
        Index("ix_schedule_items_user_start", "user_id", "start_at"),
        Index("ix_schedule_items_user_due", "user_id", "due_at"),
        Index("ix_schedule_items_user_status", "user_id", "status"),
    )

    id = Column(String, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, default="")
    status = Column(String, nullable=False, default="pending")
    priority = Column(String, nullable=False, default="green")
    start_at = Column(DateTime, nullable=True)
    due_at = Column(DateTime, nullable=True)
    reminder_at = Column(DateTime, nullable=True)
    pomodoro_count = Column(Integer, nullable=False, default=0)
    pomodoro_rounds = Column(Integer, nullable=False, default=0)
    total_focus_minutes = Column(Integer, nullable=False, default=0)
    completed_at = Column(DateTime, nullable=True)
    deleted_at = Column(DateTime, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class CalendarEvent(Base):
    __tablename__ = "calendar_events"
    __table_args__ = (
        Index("ix_calendar_events_user_date", "user_id", "date"),
    )

    id = Column(String, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    date = Column(String, nullable=False)
    start_time = Column(String, nullable=True)
    end_time = Column(String, nullable=True)
    type = Column(String, nullable=False, default="event")
    color = Column(String, nullable=False, default="#8b5cf6")
    todo_id = Column(String, nullable=True)
    pomodoro_session_id = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)
