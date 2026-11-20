from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


class TranscriptSegment(BaseModel):
    start: float
    end: float
    text: str


class SubtitleSegmentOut(BaseModel):
    id: int
    video_id: int
    segment_index: int
    start_sec: float
    end_sec: float
    text: str

    model_config = {"from_attributes": True}


class SubtitleSegmentUpdate(BaseModel):
    text: str = Field(min_length=1)


class CategoryOut(BaseModel):
    id: int
    name: str
    path: str
    sort_order: int = 0
    parent_id: Optional[int] = None
    video_count: int = 0

    model_config = {"from_attributes": True}


class CategoryTreeOut(CategoryOut):
    full_path: str
    level: int = 0
    children: list["CategoryTreeOut"] = Field(default_factory=list)


class CategoryTreeWithVideosOut(CategoryTreeOut):
    video_ids: list[int] = Field(default_factory=list)


class VideoOut(BaseModel):
    id: int
    title: str
    filename: str
    filepath: str
    file_size: int
    duration: Optional[float] = None
    thumbnail: Optional[str] = None
    tags: Optional[str] = None
    category_id: Optional[int] = None
    category_path: Optional[str] = None
    transcription: Optional[str] = None
    transcript_segments: list[TranscriptSegment] = Field(default_factory=list)
    summary: Optional[str] = None
    has_subtitles: bool = False
    has_summary: bool = False
    markdown_path: Optional[str] = None
    subtitle_path: Optional[str] = None
    subtitle_url: Optional[str] = None
    ai_status: str = "idle"
    ai_stage: Optional[str] = None
    ai_error: Optional[str] = None
    active_job_id: Optional[str] = None
    watch_progress: Optional[float] = None
    completed: bool = False
    is_favorite: bool = False
    favorited_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class VideoPage(BaseModel):
    items: list[VideoOut]
    total: int
    page: int
    page_size: int
    total_pages: int


class WatchHistoryIn(BaseModel):
    video_id: int
    progress: float = Field(ge=0)
    duration: float = Field(ge=0)


class VideoFavoriteIn(BaseModel):
    is_favorite: bool


class AiJobCreate(BaseModel):
    whisper_engine: Optional[str] = None
    whisper_model: str = "small"
    language: str = "zh"
    do_summary: bool = True
    word_limit: int = Field(default=200, ge=50, le=2000)
    ollama_model: Optional[str] = None
    cpu_threads: Optional[int] = Field(default=None, ge=1, le=128)
    compute_type: Optional[str] = None
    beam_size: Optional[int] = Field(default=None, ge=1, le=10)
    best_of: Optional[int] = Field(default=None, ge=1, le=10)
    temperature: Optional[float] = Field(default=None, ge=0, le=1)
    vad_filter: Optional[bool] = None
    device_type: Optional[Literal["auto", "cuda", "cpu"]] = None
    subtitle_correction_enabled: Optional[bool] = None
    subtitle_correction_scope: Optional[Literal["full", "off"]] = None
    subtitle_correction_prompt: Optional[str] = None


class AiJobOut(BaseModel):
    id: str
    video_id: int
    status: str
    stage: str
    message: str
    error: Optional[str] = None
    whisper_engine: Optional[str] = None
    whisper_model: str
    language: str
    do_summary: bool
    summary_only: bool = False
    word_limit: int
    ollama_model: Optional[str] = None
    device_type: Optional[Literal["auto", "cuda", "cpu"]] = None
    transcript: Optional[str] = None
    transcript_segments: list[TranscriptSegment] = Field(default_factory=list)
    subtitle_correction_scope: Optional[str] = None
    summary: Optional[str] = None
    summary_error: Optional[str] = None
    markdown_path: Optional[str] = None
    subtitle_path: Optional[str] = None
    subtitle_url: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AiJobListItem(BaseModel):
    id: str
    video_id: int
    video_title: str | None = None
    duration: Optional[float] = None
    status: str
    stage: str
    message: str
    error: Optional[str] = None
    whisper_engine: Optional[str] = None
    whisper_model: str
    language: str
    do_summary: bool
    summary_only: bool = False
    word_limit: int
    cpu_threads: Optional[int] = None
    compute_type: Optional[str] = None
    device_type: Optional[Literal["auto", "cuda", "cpu"]] = None
    subtitle_correction_enabled: Optional[bool] = None
    subtitle_correction_scope: Optional[str] = None
    subtitle_correction_prompt: Optional[str] = None
    summary_error: Optional[str] = None
    created_at: datetime
    started_at: datetime | None = None
    updated_at: datetime


class AiJobListOut(BaseModel):
    items: list[AiJobListItem]
    total: int
    running: int
    queued: int
    failed: int
    completed: int


class AiJobBatchCreate(AiJobCreate):
    video_ids: list[int] = Field(min_length=1, max_length=999999)
    mode: str = "missing_subtitles"
    max_enqueue: int = Field(default=20, ge=1, le=999999)
    dry_run: bool = True
    # 插队到队首。前端「点开某个视频手动生成」时传 true ——
    # 用户正盯着这个视频等结果，不该排在 10 个批量任务后面等两小时。
    # 批量处理（选中一批）保持 false，按提交顺序排队。
    at_front: bool = False


class AiJobBatchSkippedItem(BaseModel):
    video_id: int
    title: str
    reason: str


class AiJobBatchOut(BaseModel):
    mode: str
    requested: int
    eligible: int
    enqueued: int
    skipped: int
    active: int
    already_done: int
    failed: int
    limited: bool
    max_enqueue: int
    job_ids: list[str] = Field(default_factory=list)
    skipped_items: list[AiJobBatchSkippedItem] = Field(default_factory=list)


class TranscriptionSettingsOut(BaseModel):
    whisper_engine: str
    whisper_model: str
    language: str
    do_summary: bool
    word_limit: int
    cpu_threads: int
    compute_type: str
    beam_size: int
    best_of: int
    temperature: float
    vad_filter: bool
    subtitle_correction_enabled: bool
    subtitle_correction_scope: Literal["full", "off"]
    subtitle_correction_prompt: str
    llm_usage_policy: Literal["local_first", "external_first", "local_only", "external_only"]
    device_type: Literal["auto", "cuda", "cpu"]


class TranscriptionSettingsIn(BaseModel):
    whisper_engine: Optional[str] = None
    whisper_model: Optional[str] = None
    language: Optional[str] = None
    do_summary: Optional[bool] = None
    word_limit: Optional[int] = Field(default=None, ge=50, le=2000)
    cpu_threads: Optional[int] = Field(default=None, ge=1, le=128)
    compute_type: Optional[str] = None
    beam_size: Optional[int] = Field(default=None, ge=1, le=10)
    best_of: Optional[int] = Field(default=None, ge=1, le=10)
    temperature: Optional[float] = Field(default=None, ge=0, le=1)
    vad_filter: Optional[bool] = None
    subtitle_correction_enabled: Optional[bool] = None
    subtitle_correction_scope: Optional[Literal["full", "off"]] = None
    subtitle_correction_prompt: Optional[str] = None
    llm_usage_policy: Optional[Literal["local_first", "external_first", "local_only", "external_only"]] = None
    device_type: Optional[Literal["auto", "cuda", "cpu"]] = None


class AssistantRuntimeSettingsOut(BaseModel):
    local_base_url: str
    local_api_key: str
    local_model: str
    external_base_url: str
    external_api_key: str
    external_model: str
    llm_usage_policy: Literal["local_first", "external_first", "local_only", "external_only"]


class AssistantRuntimeSettingsIn(BaseModel):
    local_base_url: Optional[str] = None
    local_api_key: Optional[str] = None
    local_model: Optional[str] = None
    external_base_url: Optional[str] = None
    external_api_key: Optional[str] = None
    external_model: Optional[str] = None
    llm_usage_policy: Optional[Literal["local_first", "external_first", "local_only", "external_only"]] = None


class NoteOut(BaseModel):
    id: int
    video_id: Optional[int] = None
    # 私有笔记的归属；共享笔记为 None
    user_id: Optional[int] = None
    # shared（AI 转写产物，系统共有）/ private（用户自己写的）
    scope: str = "shared"
    # sticky（便签墙）/ md（Markdown 笔记）
    surface: str = "md"
    title: str
    content: str
    source: str
    markdown_path: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: str


class StatsOut(BaseModel):
    total_videos: int
    total_categories: int
    total_watch_time: float
    completed_videos: int
    ai_completed: int


class RescanOut(BaseModel):
    status: str
    added: int
    removed: int
    total: int


class SegmentSearchResult(BaseModel):
    video_id: int
    video_title: str
    category_id: int | None = None
    start_sec: float
    end_sec: float
    text: str
    subtitle_url: str | None = None
    score_hint: float = 0
    # 元数据线索：课程 / 章 / 课时 / 第 N/M 节。
    # 由 retrieval_meta 从磁盘路径解析，不含系统路径。
    folder_path: str | None = None
    meta: dict | None = None


class AssistantPageNote(BaseModel):
    """当前笔记的保存上下文。只在用户要求保存时由聊天工具读取。"""

    title: str = Field(default="", max_length=240)
    markdown: str = Field(default="", max_length=60_000)
    # 当前页面属于便签墙还是 Markdown 笔记；决定保存后的归属与回填目标。
    surface: Literal["sticky", "md"] = "md"


class AssistantResume(BaseModel):
    """HITL 中断后继续执行。

    run_id 是 LangGraph checkpoint 的 thread_id；前端从 interrupt 事件拿回。
    selected 是 A/B/C 选项 id，text 是「其它」里的自定义补充。
    original_message 只用于恢复引用检索和指代消解，不会重新写进历史。
    """

    run_id: str = Field(min_length=1)
    interrupt_id: str = ""
    selected: str = ""
    text: str = ""
    original_message: str = ""


class AssistantChatCreate(BaseModel):
    message: str = Field(min_length=1)
    page_context: str = ""
    page_note: AssistantPageNote | None = None
    system_prompt: str = ""
    session_id: str | None = None
    video_id: int | None = None
    depth: str = "basic"
    use_rag: bool = False
    use_web_search: bool = False
    # 前端 detectIntent() 识别出的意图模板 id。
    # 由前端算是因为模板定义在前端（prompts/clientPrompts.ts），
    # 后端只负责随消息一起持久化，历史会话加载时才能还原「当时用的策略」。
    intent: str | None = None
    use_deep_research: bool = False
    limit: int = Field(default=6, ge=1, le=20)
    resume: AssistantResume | None = None


class AssistantReference(BaseModel):
    video_id: int
    video_title: str
    start_sec: float
    end_sec: float
    text: str
    score_hint: float = 0


class AssistantChatOut(BaseModel):
    session_id: str
    answer: str
    mode: str
    depth: str = "basic"
    rag_enabled: bool = False
    web_search_enabled: bool = False
    deep_research_enabled: bool = False
    references: list[AssistantReference] = Field(default_factory=list)


class AssistantModelListCreate(BaseModel):
    base_url: str
    api_key: str = ""


class AssistantModelListOut(BaseModel):
    models: list[str] = Field(default_factory=list)


class AssistantConnectionTestCreate(BaseModel):
    base_url: str
    model: str
    api_key: str = ""
    message: str = Field(min_length=1)
    system_prompt: str = ""
    temperature: float = 0.2


class AssistantConnectionTestOut(BaseModel):
    status: str
    content_type: str = "application/json"
    answer: str = ""
    received_text: bool = False


class UserRegister(BaseModel):
    username: str = Field(min_length=2, max_length=50, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def password_strength(cls, value: str) -> str:
        """只挡最差的一批：纯数字、纯字母、纯符号。

        不做「必须含大写+特殊字符」那套，实测只会逼出 Password1! 这种更差的东西。
        """
        if value.isdigit() or value.isalpha():
            raise ValueError("密码需要同时包含字母和数字")
        if value.lower() in {"password", "12345678", "qwertyui", "admin123"}:
            raise ValueError("这个密码太常见了，换一个")
        return value


class UserLogin(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=128)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, value: str) -> str:
        if value.isdigit() or value.isalpha():
            raise ValueError("密码需要同时包含字母和数字")
        return value


class UserOut(BaseModel):
    id: int
    username: str
    display_name: str | None = None
    role: str = "member"
    model_config = {"from_attributes": True}


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserDataItem(BaseModel):
    value: str


# ---------------- 管理员：用户管理 ----------------


class AdminUserOut(BaseModel):
    id: int
    username: str
    display_name: Optional[str] = None
    role: str = "member"
    is_active: bool = True
    last_login_at: Optional[str] = None
    created_at: Optional[str] = None
    # 便于管理员判断「这个号到底有没有在用」
    watch_events: int = 0
    learning_paths: int = 0


class AdminUserUpdate(BaseModel):
    role: Optional[Literal["admin", "member"]] = None
    is_active: Optional[bool] = None
    display_name: Optional[str] = Field(default=None, max_length=50)


class AdminPasswordReset(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, value: str) -> str:
        if value.isdigit() or value.isalpha():
            raise ValueError("密码需要同时包含字母和数字")
        return value


class UserDataBulkImport(BaseModel):
    users: list[dict]
    kv_data: dict[str, str]


class ScheduleItemBase(BaseModel):
    type: Literal["todo", "event"] = "todo"
    title: str = Field(min_length=1, max_length=240)
    description: str = ""
    status: Literal["pending", "in_progress", "completed"] = "pending"
    priority: Literal["high", "medium", "low", "green"] = "green"
    start_at: Optional[datetime] = None
    due_at: Optional[datetime] = None
    reminder_at: Optional[datetime] = None
    pomodoro_count: int = Field(default=0, ge=0)
    pomodoro_rounds: int = Field(default=0, ge=0)
    total_focus_minutes: int = Field(default=0, ge=0)
    completed_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None
    sort_order: int = 0


class ScheduleItemCreate(ScheduleItemBase):
    id: Optional[str] = None


class ScheduleItemUpdate(BaseModel):
    type: Optional[Literal["todo", "event"]] = None
    title: Optional[str] = Field(default=None, min_length=1, max_length=240)
    description: Optional[str] = None
    status: Optional[Literal["pending", "in_progress", "completed"]] = None
    priority: Optional[Literal["high", "medium", "low", "green"]] = None
    start_at: Optional[datetime] = None
    due_at: Optional[datetime] = None
    reminder_at: Optional[datetime] = None
    pomodoro_count: Optional[int] = Field(default=None, ge=0)
    pomodoro_rounds: Optional[int] = Field(default=None, ge=0)
    total_focus_minutes: Optional[int] = Field(default=None, ge=0)
    completed_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None
    sort_order: Optional[int] = None


class ScheduleItemOut(ScheduleItemBase):
    id: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ScheduleItemListOut(BaseModel):
    items: list[ScheduleItemOut]


class CalendarEventBase(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    date: str = Field(min_length=10, max_length=10)
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    type: str = "event"
    color: str = "#8b5cf6"
    todo_id: Optional[str] = None
    pomodoro_session_id: Optional[str] = None
    description: Optional[str] = None


class CalendarEventCreate(CalendarEventBase):
    id: Optional[str] = None


class CalendarEventUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=240)
    date: Optional[str] = Field(default=None, min_length=10, max_length=10)
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    type: Optional[str] = None
    color: Optional[str] = None
    todo_id: Optional[str] = None
    pomodoro_session_id: Optional[str] = None
    description: Optional[str] = None


class CalendarEventOut(CalendarEventBase):
    id: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CalendarEventListOut(BaseModel):
    items: list[CalendarEventOut]


# ==================== 混合检索 ====================


class HybridSearchHit(BaseModel):
    segment_id: int
    video_id: int
    video_title: str
    category_id: int | None = None
    start_sec: float
    end_sec: float
    text: str
    score: float
    lexical_score: float | None = None
    vector_score: float | None = None
    rerank_score: float | None = None
    sources: list[str] = []
    # 上下文扩展后：text 是合并出的段落，原始命中片段留在 raw_text。
    # 少了这两个字段，前端无法判断这条结果覆盖了多长时间的内容，
    # 也没法在高亮时区分「命中的是这一句」还是「展开的整段」。
    raw_text: str | None = None
    segment_count: int = 1
    # 路径线索（视频级）。命中来自「元数据通道」时才有 meta_score；
    # meta 里带 display（资料库/课程/章）、lesson_no、position/total、prev/next。
    # 之前不加这两个字段，hybrid_search 算出来的东西会被 Pydantic 静默丢掉，
    # 前端拿不到「这条属于哪门课、第几节」。
    meta: Optional[dict] = None
    meta_score: Optional[float] = None


class HybridSearchOut(BaseModel):
    query: str
    hits: list[HybridSearchHit]
    # timings 里除了毫秒数还有查询向量缓存状态（"hit"/"miss"），
    # 不能只声明 float，否则匿名/首次搜索会被 Pydantic 校验成 500。
    timings: dict[str, float | str] = {}
    degraded: list[str] = []
    rerank_used: bool = False
    rerank_mode: str | None = None
