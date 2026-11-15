"""笔记接口。

两类笔记，权限不同：
  shared   AI 转写产物，属于系统共有。所有人可读，只有 admin 可改。
  private  用户自己写的。只有本人可读写。

以前没有这个区分，所有笔记混在一起、只有 admin 能改，
结果普通用户写不了自己的笔记，成就墙还把 8770 条 AI 产物算成「用户手写」。
"""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db, settings
from app.models import Note, User
from app.schemas import NoteOut, NoteUpdate

router = APIRouter(prefix="/api/notes", tags=["notes"])


class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    content: str = ""
    video_id: int | None = None


def _load_visible(note_id: int, user: User, db: Session) -> Note:
    """按可见性取笔记。取不到一律 404 —— 不区分「不存在」和「不属于你」。"""
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    if note.scope == "private" and note.user_id != user.id:
        # 私有笔记只有本人可见，admin 也不行
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@router.get("", response_model=list[NoteOut])
def list_notes(
    scope: str | None = None,
    video_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """当前用户能看到的：所有 shared + 自己的 private。"""
    q = db.query(Note).filter(
        or_(
            Note.scope == "shared",
            (Note.scope == "private") & (Note.user_id == user.id),
        )
    )
    if scope in ("shared", "private"):
        q = q.filter(Note.scope == scope)
    if video_id is not None:
        q = q.filter(Note.video_id == video_id)
    return q.order_by(Note.updated_at.desc()).limit(500).all()


@router.post("", response_model=NoteOut)
def create_note(
    payload: NoteCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """新建自己的笔记。永远 private —— 共享笔记只由 AI 转写流程产生。"""
    note = Note(
        title=payload.title.strip(),
        content=payload.content,
        video_id=payload.video_id,
        user_id=user.id,
        scope="private",
        source="manual",
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


@router.put("/{note_id}", response_model=NoteOut)
def update_note(
    note_id: int,
    payload: NoteUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    note = _load_visible(note_id, user, db)

    # 共享笔记是系统内容，改动要管理权限；私有笔记本人可改
    if note.scope == "shared" and (user.role or "") != "admin":
        raise HTTPException(status_code=403, detail="共享笔记需要管理员权限")

    if payload.title is not None:
        note.title = payload.title
    note.content = payload.content

    # 私有笔记写到按用户分目录，避免和共享笔记的 output/notes 混在一起
    if note.scope == "private":
        md_path = Path(settings.output_dir) / "user-notes" / str(note.user_id) / f"note-{note.id}.md"
    else:
        md_path = Path(note.markdown_path) if note.markdown_path else (
            Path(settings.output_dir) / "notes" / f"note-{note.id}.md"
        )
    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text(note.content, encoding="utf-8")
    note.markdown_path = str(md_path)

    db.commit()
    db.refresh(note)
    return note


@router.delete("/{note_id}")
def delete_note(
    note_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    note = _load_visible(note_id, user, db)
    if note.scope == "shared":
        # 共享笔记不删 —— 删了视频就少一段笔记；想改内容走 PUT
        raise HTTPException(status_code=403, detail="共享笔记不能删除，只能编辑")
    db.delete(note)
    db.commit()
    return {"ok": True, "id": note_id}
