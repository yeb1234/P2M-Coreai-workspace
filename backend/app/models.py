import uuid
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

    # 主键自带唯一索引，不再额外建 ix_videos_id（重复索引只增加写放大）
    id = Column(Integer, primary_key=True)
    title = Column(String, index=True, nullable=False)
    filename = Column(String, nullable=False)
    filepath = Column(String, unique=True, nullable=False)
    sort_key = Column(String, index=True, nullable=True)
    # 单个视频可能超过 2GB，int32 会溢出
    file_size = Column(BigInteger().with_variant(Integer, "sqlite"), default=0)
    duration = Column(Float, nullable=True)
    thumbnail = Column(String, nullable=True)
    # 最后一次「建块 + 向量化」完成的时间。
    #
    # 为什么需要这个标记：语义块和向量都是派生数据，但它们**无法自证新鲜**。
    # 视频重转过、字幕变了，旧块还在、旧向量也在，光看 content_chunks
    # 扫不出「过期」。用这个时间戳和字幕的 max(created_at) 比，才知道要不要重建。
    #
    # 缩略图不需要这个 —— thumbnail IS NULL 本身就是「还没做」的完整信号。
    chunk_indexed_at = Column(DateTime, nullable=True)
    # 缩略图生成失败计数。
    #
    # 为什么需要：扫描条件是「thumbnail IS NULL」，而损坏的视频文件
    # 永远生成不出缩略图 —— 它会被每一轮扫描重新投递，无限重试，
    # 白烧 ffmpeg 还刷日志。实测有一个文件（路径里带全角括号）
    # 每 5 分钟失败一次。
    #
    # 到上限就不再自动重试；要重试走 admin 的 retry 接口（会清零）。
    thumbnail_attempts = Column(Integer, nullable=False, server_default="0")
    thumbnail_failed_at = Column(DateTime, nullable=True)
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
    # 已废弃：这是视频库的全局字段，不代表当前用户收藏。
    # 新代码读写 user_video_favorites；保留列只为兼容旧库/回滚。
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


class UserVideoFavorite(Base):
    """用户个人收藏。

    原来的 `videos.is_favorite` 是共享库字段，谁改都影响所有人。
    多用户语义下收藏必须是 (user_id, video_id) 的关联表；共享库如果
    还需要“运营精选”，应另设 admin-only 字段，不能复用收藏。
    """

    __tablename__ = "user_video_favorites"
    __table_args__ = (
        Index("ix_user_video_favorites_video", "video_id"),
    )

    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    video_id = Column(
        Integer, ForeignKey("videos.id", ondelete="CASCADE"), primary_key=True
    )
    favorited_at = Column(DateTime, default=datetime.now, nullable=False)


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
    # 只补总结：视频已有字幕时跳过抽音频/Whisper，直接用现有字幕文本总结。
    # 这是批量「只补总结」和普通重转写的区分标记，避免把全库总结又跑成转写。
    summary_only = Column(Boolean, default=False, nullable=False, server_default="false")
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
    """学习笔记。

    scope 区分两种笔记，这是多用户下的核心概念：
      shared  AI 转写视频时自动生成，属于系统共有内容，所有用户可见，
              只有 admin 能改（因为它服务于共享视频库）
      private 用户自己写的，只属于该用户，别人看不到

    surface 区分前端两个功能面：
      sticky  便签墙的轻量速记
      md      Markdown 长文档笔记
    老数据默认 md；便签页只同步 sticky，笔记页只同步 md，互不污染。

    以前没有这个区分，所有笔记混在一起，导致两件事说不清：
    成就墙的「手写笔记」把 8770 条 AI 产物也算成用户写的；
    用户想写自己的笔记时，会和系统笔记混在一个列表里。
    """

    __tablename__ = "notes"

    id = Column(Integer, primary_key=True, index=True)
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=True)
    # private 笔记的归属；shared 笔记为 NULL（属于所有人）
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    # shared / private
    scope = Column(String, nullable=False, default="shared", index=True)
    # sticky / md：便签墙与 Markdown 笔记是两个功能面。
    # 老数据与视频笔记统一落到 md，避免升级后突然铺满便签墙。
    surface = Column(String(20), nullable=False, default="md", index=True)
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

    # 主键自带唯一索引，不再额外建 ix_subtitle_segments_id
    id = Column(Integer, primary_key=True)
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
    title = Column(String, nullable=False, default="新对话")
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
# 注：content_chunks（pgvector 语义块表）不在此映射，
#     定义在 app/tables.py —— halfvec 类型在 SQLite 上无法编译，
#     挂到 Base.metadata 会让 create_all 直接抛错。
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
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
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
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
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
    # ---- 记忆治理相关 ----
    # 置顶：用户手动锁定，自动提取永远不能改、不能删。这是防止
    # 「用户改过的记忆被 LLM 冲回去」的最后一道闸。
    pinned = Column(Boolean, nullable=False, default=False)
    # 置信度：user_stated 通常 0.9+，inferred 0.5-0.7
    confidence = Column(Float, nullable=False, default=0.8)
    # 软删除：被哪条替代了。不物理删，保留「用户改主意」的历史
    superseded_by = Column(String, nullable=True)
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
    # 审计必须能定位到人：无主运行不是“公共”，而是迁移/隔离区。
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
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

class AgentAction(Base):
    """助手个人动作审计：笔记、日历、Todo 的写入与撤回记录。

    和 AgentRun 的分工：
      AgentRun    记录「模型这一轮怎么想、调了哪些工具」；
      AgentAction 记录「用户真正被改动了什么、能不能撤回」。

    只记录已执行的写动作（apply / failed / undone）。用户取消的确认不在这里，
    因为它没有改变任何用户数据。
    """

    __tablename__ = "agent_actions"
    __table_args__ = (
        Index("ix_agent_actions_user_created", "user_id", "created_at"),
        Index("ix_agent_actions_run", "run_id"),
        Index("ix_agent_actions_status", "status"),
    )

    id = Column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    run_id = Column(String, nullable=True)
    session_id = Column(String, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # note / calendar / todo
    action_type = Column(String, nullable=False, index=True)
    # applied / failed / undone
    status = Column(String, nullable=False, default="applied")
    title = Column(String, nullable=False, default="")
    summary = Column(Text, nullable=True)
    # 给前端和历史消息看的轻量快照，不存完整长正文
    payload = Column(JsonColumn, nullable=True)
    target_id = Column(String, nullable=True)
    result = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.now, index=True)
    undone_at = Column(DateTime, nullable=True)


class BackgroundTask(Base):
    """通用后台任务。任何「跑到一半断了要能接着跑」的活都挂这里。

    和 AiJob 的分工：AiJob 专用于转写（字段和转写流程强绑定），
    这张表是通用的 —— 缩略图、向量化、索引重建都能用。

    状态机：
        queued → running → done
                   ↓ 失败且未达重试上限
                 queued（重试）
                   ↓ 达上限
                 failed

    worker 启动时会把 running / queued 的全部重新投递，
    所以进程崩溃、机器重启都不会丢任务。
    """

    __tablename__ = "background_tasks"
    __table_args__ = (
        Index("ix_background_tasks_kind_status", "kind", "status"),
        Index("ix_background_tasks_target", "kind", "target_id"),
    )

    # 主键必须自己生成。
    # 之前只写了 primary_key=True，没有任何默认值 —— 建表时 PG 不给 String
    # 主键加序列，插入直接 NotNullViolation。而 enqueue_task 里的
    # except 把这个异常吞成了日志，于是「投递永远成功、任务永远不来」。
    id = Column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    kind = Column(String, nullable=False, index=True)
    target_id = Column(String, nullable=False)
    payload = Column(JSON, default=dict)
    status = Column(String, nullable=False, default="queued", index=True)
    attempts = Column(Integer, default=0)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)


class InterviewAttempt(Base):
    """一次面试题作答 + AI 评估结果。

    题库本身是版本化静态数据（src/data/interview/questions.json），
    这张表只存「我答过什么、AI 怎么评、薄弱点在哪」，方便后面做错题本、
    能力雷达和面试 Agent 的长期记忆。
    """

    __tablename__ = "interview_attempts"
    __table_args__ = (
        Index("ix_interview_attempts_user_question", "user_id", "question_id"),
        Index("ix_interview_attempts_created", "created_at"),
    )

    id = Column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    question_id = Column(String, nullable=False, index=True)
    group_key = Column(String, nullable=True)
    question_title = Column(String, nullable=False)
    # evaluate / followup / reference
    mode = Column(String, nullable=False, default="evaluate")
    answer = Column(Text, nullable=False)
    score = Column(Integer, nullable=True)
    # pass / borderline / fail
    verdict = Column(String, nullable=True)
    # {"dimensions": [...], "strengths": [...], "gaps": [...], "rewrite": "..."}
    feedback = Column(JsonColumn, nullable=True)
    provider = Column(String, nullable=True)
    model = Column(String, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.now, index=True)


class InterviewCardState(Base):
    """题目级学习状态：收藏、掌握、最近一次评分、练习次数。"""

    __tablename__ = "interview_card_states"
    __table_args__ = (
        UniqueConstraint("user_id", "question_id", name="uq_interview_state_user_question"),
        Index("ix_interview_state_user_starred", "user_id", "starred"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    question_id = Column(String, nullable=False, index=True)
    starred = Column(Boolean, nullable=False, default=False)
    mastered = Column(Boolean, nullable=False, default=False)
    # 0 不会 / 1 模糊 / 2 掌握；和 mastered 是两个维度：自评是主观，mastered 是收口
    confidence = Column(SmallInteger, nullable=False, default=0)
    last_score = Column(Integer, nullable=True)
    practice_count = Column(Integer, nullable=False, default=0)
    last_practiced_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class InterviewQuestionReport(Base):
    """用户对题目内容的纠错反馈。

    题库是静态 JSON，改题需要人工；没有反馈入口时，错题只能靠使用者自己
    记下来。这里单独存一张报告表，保留用户、题目、错误类型和补充说明，
    `status` 预留给后台按 open / fixed / ignored 处理。
    """

    __tablename__ = "interview_question_reports"
    __table_args__ = (
        Index("ix_interview_reports_user_created", "user_id", "created_at"),
        Index("ix_interview_reports_question_status", "question_id", "status"),
    )

    id = Column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    question_id = Column(String, nullable=False, index=True)
    question_title = Column(String, nullable=False, default="")
    # stem / answer / rubric / classification / typo / other
    reason = Column(String, nullable=False, index=True)
    detail = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="open", index=True)
    created_at = Column(DateTime, default=datetime.now, index=True)
    resolved_at = Column(DateTime, nullable=True)


# ─────────────────────────────────────────────────────────────
# 7.0 配置资产版本库（DB-native Git）
#
# 为什么不直接用外部 Git 服务：提示词、检索参数、LLM 路由这些资产属于
# 应用运行时的一部分，需要在设置页里直接提交/对比/发布，并且和生产库
# 的生命周期绑定。这里用 PostgreSQL 存内容快照与提交图，不依赖 Git
# 二进制，也不把密钥写进版本库。
# ─────────────────────────────────────────────────────────────


class AssetRepository(Base):
    __tablename__ = "asset_repositories"

    id = Column(Integer, primary_key=True)
    slug = Column(String(80), unique=True, nullable=False, index=True)
    name = Column(String(160), nullable=False)
    description = Column(Text, nullable=True)
    default_branch = Column(String(80), nullable=False, default="main")
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class AssetBranch(Base):
    __tablename__ = "asset_branches"
    __table_args__ = (
        UniqueConstraint("repo_id", "name", name="uix_asset_branch_repo_name"),
    )

    id = Column(Integer, primary_key=True)
    repo_id = Column(Integer, ForeignKey("asset_repositories.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(80), nullable=False)
    head_hash = Column(String(64), nullable=True)
    is_default = Column(Boolean, nullable=False, default=False)
    protected = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class AssetCommit(Base):
    __tablename__ = "asset_commits"
    __table_args__ = (
        Index("ix_asset_commits_repo_created", "repo_id", "created_at"),
        Index("ix_asset_commits_parent", "repo_id", "parent_hash"),
    )

    hash = Column(String(64), primary_key=True)
    repo_id = Column(Integer, ForeignKey("asset_repositories.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_hash = Column(String(64), nullable=True)
    # 合并提交的第二个父提交；普通提交为空。
    parent2_hash = Column(String(64), nullable=True)
    tree_hash = Column(String(64), nullable=False, index=True)
    message = Column(Text, nullable=False, default="")
    author_id = Column(Integer, nullable=True)
    author_name = Column(String(120), nullable=False, default="system")
    kind = Column(String(20), nullable=False, default="commit")  # seed/commit/merge/rollback
    created_at = Column(DateTime, default=datetime.now, index=True)


class AssetBlob(Base):
    __tablename__ = "asset_blobs"

    hash = Column(String(64), primary_key=True)
    size = Column(Integer, nullable=False, default=0)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.now)


class AssetEntry(Base):
    __tablename__ = "asset_entries"
    __table_args__ = (
        UniqueConstraint("commit_hash", "path", name="uix_asset_entry_commit_path"),
        Index("ix_asset_entries_path", "path"),
    )

    id = Column(Integer, primary_key=True)
    commit_hash = Column(String(64), ForeignKey("asset_commits.hash", ondelete="CASCADE"), nullable=False, index=True)
    path = Column(String(400), nullable=False)
    blob_hash = Column(String(64), ForeignKey("asset_blobs.hash", ondelete="RESTRICT"), nullable=False)
    mode = Column(String(20), nullable=False, default="100644")
    size = Column(Integer, nullable=False, default=0)


class AssetTag(Base):
    __tablename__ = "asset_tags"
    __table_args__ = (
        UniqueConstraint("repo_id", "name", name="uix_asset_tag_repo_name"),
    )

    id = Column(Integer, primary_key=True)
    repo_id = Column(Integer, ForeignKey("asset_repositories.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(80), nullable=False)
    commit_hash = Column(String(64), ForeignKey("asset_commits.hash", ondelete="CASCADE"), nullable=False)
    message = Column(Text, nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.now)


class AssetAuditEvent(Base):
    __tablename__ = "asset_audit_events"
    __table_args__ = (
        Index("ix_asset_audit_repo_created", "repo_id", "created_at"),
    )

    id = Column(Integer, primary_key=True)
    repo_id = Column(Integer, ForeignKey("asset_repositories.id", ondelete="CASCADE"), nullable=False, index=True)
    action = Column(String(40), nullable=False, index=True)
    actor_id = Column(Integer, nullable=True)
    actor_name = Column(String(120), nullable=False, default="system")
    detail = Column(JsonColumn, nullable=True)
    created_at = Column(DateTime, default=datetime.now, index=True)


class AssetPublication(Base):
    __tablename__ = "asset_publications"
    __table_args__ = (
        Index("ix_asset_publications_repo_created", "repo_id", "created_at"),
    )

    id = Column(Integer, primary_key=True)
    repo_id = Column(Integer, ForeignKey("asset_repositories.id", ondelete="CASCADE"), nullable=False, index=True)
    commit_hash = Column(String(64), ForeignKey("asset_commits.hash", ondelete="CASCADE"), nullable=False)
    branch = Column(String(80), nullable=True)
    status = Column(String(20), nullable=False, default="published")
    files_count = Column(Integer, nullable=False, default=0)
    actor_id = Column(Integer, nullable=True)
    detail = Column(JsonColumn, nullable=True)
    created_at = Column(DateTime, default=datetime.now, index=True)
