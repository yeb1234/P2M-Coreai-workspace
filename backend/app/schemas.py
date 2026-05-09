from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


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
    markdown_path: Optional[str] = None
    subtitle_path: Optional[str] = None
    subtitle_url: Optional[str] = None
    ai_status: str = "idle"
    ai_stage: Optional[str] = None
    ai_error: Optional[str] = None
    active_job_id: Optional[str] = None
    watch_progress: Optional[float] = None
    completed: bool = False
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


class AiJobCreate(BaseModel):
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
    subtitle_correction_enabled: Optional[bool] = None


class AiJobOut(BaseModel):
    id: str
    video_id: int
    status: str
    stage: str
    message: str
    error: Optional[str] = None
    whisper_model: str
    language: str
    do_summary: bool
    word_limit: int
    ollama_model: Optional[str] = None
    transcript: Optional[str] = None
    transcript_segments: list[TranscriptSegment] = Field(default_factory=list)
    summary: Optional[str] = None
    summary_error: Optional[str] = None
    markdown_path: Optional[str] = None
    subtitle_path: Optional[str] = None
    subtitle_url: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class NoteOut(BaseModel):
    id: int
    video_id: Optional[int] = None
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


class AssistantChatCreate(BaseModel):
    message: str = Field(min_length=1)
    session_id: str | None = None
    video_id: int | None = None
    depth: str = "basic"
    use_rag: bool = False
    use_web_search: bool = False
    use_deep_research: bool = False
    limit: int = Field(default=6, ge=1, le=20)


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
