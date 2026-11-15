from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.database import Base

# SQLite 存 TEXT，PostgreSQL 用 JSONB（可索引、可查询内部字段）
JsonColumn = JSON().with_variant(JSONB, "postgresql")


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (
        UniqueConstraint("name", "parent_id", name="uix_category_name_parent"),
    )

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False)
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
    # 单个视频可能超过 2GB，int32 会溢出
    file_size = Column(BigInteger().with_variant(Integer, "sqlite"), default=0)
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
    # 多用户隔离键。历史数据迁移时统一归给系统 owner
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
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
    device_type = Column(String, nullable=True)
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
    started_at = Column(DateTime, nullable=True)
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
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    # 滑动窗口之外的历史压缩成摘要，避免上下文无限增长
    summary = Column(Text, nullable=True)
    summary_upto_message_id = Column(String, nullable=True)
    message_count = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(String, primary_key=True, index=True)
    session_id = Column(String, ForeignKey("chat_sessions.id"), nullable=False, index=True)
    role = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    references_json = Column(Text, nullable=True)
    tool_calls_json = Column(Text, nullable=True)
    model = Column(String, nullable=True)
    tokens_in = Column(Integer, nullable=True)
    tokens_out = Column(Integer, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.now, index=True)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    display_name = Column(String, nullable=True)
    # admin 可见管理端配置与队列操作；member 只能读写自己的学习数据
    role = Column(String, nullable=False, default="member", server_default="member")
    # 改密码时 +1，使此前签发的所有令牌立即失效（无状态 JWT 的唯一撤销手段）
    token_version = Column(Integer, nullable=False, default=0, server_default="0")
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    last_login_at = Column(DateTime, nullable=True)
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


# ============================================================
# 3.0 新增：学习行为记忆 / 用户画像 / 学习路径 / Agent 审计
# 注：segment_embeddings（pgvector 向量表）不在此映射，
#     由 app/migrations.py 用原生 DDL 创建，避免 SQLite 兼容问题。
# ============================================================


class WatchEvent(Base):
    """细粒度播放行为埋点。

    与 watch_history 的区别：watch_history 是「当前进度」快照，
    watch_events 是「发生过什么」的事件流，用于计算真实观看时长、
    重看次数、倍速习惯、卡点位置。
    """

    __tablename__ = "watch_events"
    __table_args__ = (
        Index("ix_watch_events_video_time", "video_id", "occurred_at"),
        Index("ix_watch_events_user_time", "user_id", "occurred_at"),
        Index("ix_watch_events_session", "session_id"),
        Index("ix_watch_events_type_time", "event_type", "occurred_at"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=False)
    # 一次连续播放（打开→关闭）的会话标识，用于聚合「这次看了多久」
    session_id = Column(String, nullable=True)
    # play / pause / seek / rate / heartbeat / ended / close
    event_type = Column(String, nullable=False)
    position_sec = Column(Float, nullable=False, default=0.0)
    duration_sec = Column(Float, nullable=True)
    playback_rate = Column(Float, nullable=False, default=1.0)
    # 本次事件的净观看增量（心跳按实际播放时间累加）
    delta_sec = Column(Float, nullable=False, default=0.0)
    occurred_at = Column(DateTime, default=datetime.now, nullable=False)


class UserProfile(Base):
    """由 WatchEvent / Note / ScheduleItem 聚合出的画像快照，定时或按需重算。"""

    __tablename__ = "user_profiles"

    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    total_watch_sec = Column(Float, nullable=False, default=0.0)
    videos_started = Column(Integer, nullable=False, default=0)
    videos_completed = Column(Integer, nullable=False, default=0)
    completion_rate = Column(Float, nullable=False, default=0.0)
    avg_session_min = Column(Float, nullable=False, default=0.0)
    active_days_30d = Column(Integer, nullable=False, default=0)
    streak_days = Column(Integer, nullable=False, default=0)
    notes_count = Column(Integer, nullable=False, default=0)
    # {"9": 120, "10": 95}  小时 -> 分钟
    active_hours = Column(JsonColumn, nullable=True)
    # [{"category_id": 3410, "name": "Python", "minutes": 320, "share": 0.42}]
    top_categories = Column(JsonColumn, nullable=True)
    # 最近 90 天接触过的技能关键词及频次
    top_keywords = Column(JsonColumn, nullable=True)
    last_active_at = Column(DateTime, nullable=True)
    computed_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)
    extra = Column(JsonColumn, nullable=True)


class LearningGoal(Base):
    """学习目标：路径规划的输入。"""

    __tablename__ = "learning_goals"
    __table_args__ = (
        Index("ix_learning_goals_user_status", "user_id", "status"),
    )

    id = Column(String, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    title = Column(String, nullable=False)
    target_role = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    deadline = Column(Date, nullable=True)
    weekly_hours = Column(Float, nullable=False, default=10.0)
    # active / paused / done / archived
    status = Column(String, nullable=False, default="active")
    # [{"skill": "FastAPI", "level": "beginner", "weight": 1.0}]
    skills = Column(JsonColumn, nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class LearningPath(Base):
    """一条可执行的学习路径（由 LangGraph 规划器产出）。"""

    __tablename__ = "learning_paths"
    __table_args__ = (
        Index("ix_learning_paths_goal", "goal_id"),
        Index("ix_learning_paths_user_status", "user_id", "status"),
    )

    id = Column(String, primary_key=True)
    goal_id = Column(String, ForeignKey("learning_goals.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    title = Column(String, nullable=False)
    summary = Column(Text, nullable=True)
    # draft / active / completed / archived
    status = Column(String, nullable=False, default="draft")
    total_est_minutes = Column(Integer, nullable=False, default=0)
    # LangGraph 运行结束时的图状态快照，用于中断恢复与二次调整
    graph_state = Column(JsonColumn, nullable=True)
    generated_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    steps = relationship(
        "LearningPathStep",
        back_populates="path",
        cascade="all, delete-orphan",
        order_by="LearningPathStep.order_index",
    )


class LearningPathStep(Base):
    __tablename__ = "learning_path_steps"
    __table_args__ = (
        Index("ix_learning_path_steps_path_order", "path_id", "order_index"),
    )

    id = Column(String, primary_key=True)
    path_id = Column(String, ForeignKey("learning_paths.id"), nullable=False)
    order_index = Column(Integer, nullable=False, default=0)
    title = Column(String, nullable=False)
    objective = Column(Text, nullable=True)
    # 关联到现有视频库：优先用真实存在的视频，避免规划出「不存在的课」
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    video_ids = Column(JsonColumn, nullable=True)
    est_minutes = Column(Integer, nullable=False, default=0)
    # pending / in_progress / done / skipped
    status = Column(String, nullable=False, default="pending")
    completed_at = Column(DateTime, nullable=True)
    reflection = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.now)

    path = relationship("LearningPath", back_populates="steps")


class MemoryItem(Base):
    """长期记忆条目：用户偏好、约束、事实。

    与 ChatSession.summary 的分工：summary 是对话过程压缩，
    MemoryItem 是跨会话仍然成立的稳定事实（如「目标岗位是 FDE」「不看纯运维内容」）。
    """

    __tablename__ = "memory_items"
    __table_args__ = (
        Index("ix_memory_items_user_kind", "user_id", "kind"),
    )

    id = Column(String, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    # preference / constraint / goal / fact / ability
    kind = Column(String, nullable=False, default="fact")
    content = Column(Text, nullable=False)
    # chat / manual / inferred
    source = Column(String, nullable=False, default="chat")
    importance = Column(SmallInteger, nullable=False, default=3)
    # 命中次数：越常被召回越重要
    hit_count = Column(Integer, nullable=False, default=0)
    last_hit_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class AgentRun(Base):
    """Agent 单次执行审计：输入、工具轨迹、token 与耗时。"""

    __tablename__ = "agent_runs"
    __table_args__ = (
        Index("ix_agent_runs_session", "session_id"),
        Index("ix_agent_runs_created", "created_at"),
    )

    id = Column(String, primary_key=True)
    session_id = Column(String, nullable=True)
    user_id = Column(Integer, nullable=True)
    # chat / plan / embed
    kind = Column(String, nullable=False, default="chat")
    status = Column(String, nullable=False, default="running")
    input_text = Column(Text, nullable=True)
    output_text = Column(Text, nullable=True)
    # [{"tool": "search_videos", "args": {...}, "ok": true, "ms": 120}]
    steps = Column(JsonColumn, nullable=True)
    model = Column(String, nullable=True)
    tokens_in = Column(Integer, nullable=True)
    tokens_out = Column(Integer, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.now)
