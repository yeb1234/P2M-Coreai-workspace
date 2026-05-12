from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import CalendarEvent, User
from app.schemas import CalendarEventCreate, CalendarEventListOut, CalendarEventOut, CalendarEventUpdate

router = APIRouter(prefix="/api/calendar-events", tags=["calendar-events"])


@router.get("", response_model=CalendarEventListOut)
def list_calendar_events(
    start: str | None = None,
    end: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(CalendarEvent).filter(CalendarEvent.user_id == user.id)
    if start is not None:
        query = query.filter(CalendarEvent.date >= start)
    if end is not None:
        query = query.filter(CalendarEvent.date <= end)
    items = query.order_by(CalendarEvent.date, CalendarEvent.start_time).all()
    return {"items": items}


@router.post("", response_model=CalendarEventOut, status_code=status.HTTP_201_CREATED)
def create_calendar_event(
    body: CalendarEventCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    now = datetime.now()
    event = CalendarEvent(
        id=body.id or uuid4().hex,
        user_id=user.id,
        title=body.title.strip(),
        date=body.date,
        start_time=body.start_time,
        end_time=body.end_time,
        type=body.type,
        color=body.color,
        todo_id=body.todo_id,
        pomodoro_session_id=body.pomodoro_session_id,
        description=body.description,
        created_at=now,
        updated_at=now,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.patch("/{event_id}", response_model=CalendarEventOut)
def update_calendar_event(
    event_id: str,
    body: CalendarEventUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = db.query(CalendarEvent).filter(
        CalendarEvent.id == event_id,
        CalendarEvent.user_id == user.id,
    ).first()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    updates = body.model_dump(exclude_unset=True)
    if "title" in updates and updates["title"] is not None:
        updates["title"] = updates["title"].strip()

    for key, value in updates.items():
        setattr(event, key, value)
    event.updated_at = datetime.now()
    db.commit()
    db.refresh(event)
    return event


@router.delete("/{event_id}")
def delete_calendar_event(
    event_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = db.query(CalendarEvent).filter(
        CalendarEvent.id == event_id,
        CalendarEvent.user_id == user.id,
    ).first()
    if not event:
        return {"ok": True}

    db.delete(event)
    db.commit()
    return {"ok": True}


@router.delete("")
def clear_calendar_events(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.query(CalendarEvent).filter(CalendarEvent.user_id == user.id).delete(synchronize_session=False)
    db.commit()
    return {"ok": True}
