from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db, settings
from app.models import Note
from app.schemas import NoteOut, NoteUpdate


router = APIRouter(prefix="/api/notes", tags=["notes"])


@router.put("/{note_id}", response_model=NoteOut)
def update_note(note_id: int, payload: NoteUpdate, db: Session = Depends(get_db)):
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    if payload.title is not None:
        note.title = payload.title
    note.content = payload.content

    markdown_path = Path(note.markdown_path) if note.markdown_path else Path(settings.output_dir) / "notes" / f"note-{note.id}.md"
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_path.write_text(note.content, encoding="utf-8")
    note.markdown_path = str(markdown_path)
    db.commit()
    db.refresh(note)
    return note
