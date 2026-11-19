"""笔记库写入的统一入口。

聊天助手、MCP 和普通笔记接口都走这里，避免三处各自拼 `Note`。
只创建 private 笔记；shared 笔记仍然只由视频转写流程产生。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Note

MAX_NOTE_TITLE = 240
MAX_NOTE_CONTENT = 60_000


def save_private_note(
    *,
    user_id: int,
    title: str,
    content: str,
    source: str = "assistant",
    video_id: int | None = None,
    db: Session | None = None,
) -> Note:
    title = (title or "").strip()[:MAX_NOTE_TITLE] or "未命名笔记"
    body = (content or "").strip()
    if len(body) > MAX_NOTE_CONTENT:
        raise ValueError(f"笔记正文太长（超过 {MAX_NOTE_CONTENT} 字符）")

    owns_session = db is None
    if db is None:
        db = SessionLocal()
    try:
        now = datetime.now()
        note = Note(
            title=title,
            content=body,
            video_id=video_id,
            user_id=user_id,
            scope="private",
            source=source,
            created_at=now,
            updated_at=now,
        )
        db.add(note)
        db.flush()
        if owns_session:
            db.commit()
            db.refresh(note)
            db.expunge(note)
        return note
    finally:
        if owns_session:
            db.close()
