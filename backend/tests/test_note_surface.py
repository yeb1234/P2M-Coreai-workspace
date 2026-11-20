"""便签 / Markdown 笔记的归属字段。纯 schema 与规范化测试，不碰数据库。"""

from app.agents.tools import _current_note, set_tool_note_context
from app.routers.notes import NoteCreate
from app.schemas import AssistantPageNote
from app.services.note_library import normalize_note_surface


def test_page_note_defaults_to_markdown():
    note = AssistantPageNote(title="标题", markdown="# 正文")
    assert note.surface == "md"


def test_page_note_accepts_sticky():
    note = AssistantPageNote(title="标题", markdown="短句", surface="sticky")
    assert note.surface == "sticky"


def test_create_note_accepts_surface_and_rejects_unknown():
    assert NoteCreate(title="便签", content="短句", surface="sticky").surface == "sticky"
    assert NoteCreate(title="笔记", content="# 正文").surface == "md"


def test_normalize_note_surface_falls_back_to_markdown():
    assert normalize_note_surface("sticky") == "sticky"
    assert normalize_note_surface("md") == "md"
    assert normalize_note_surface("unknown") == "md"
    assert normalize_note_surface(None) == "md"


def test_tool_note_context_preserves_surface():
    set_tool_note_context({"title": "便签", "markdown": "短句", "surface": "sticky"})
    try:
        assert _current_note()["surface"] == "sticky"
    finally:
        set_tool_note_context(None)
