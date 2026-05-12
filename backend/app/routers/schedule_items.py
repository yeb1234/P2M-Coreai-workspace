from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import ScheduleItem, User
from app.schemas import ScheduleItemCreate, ScheduleItemListOut, ScheduleItemOut, ScheduleItemUpdate

router = APIRouter(prefix="/api/schedule-items", tags=["schedule-items"])


def _minute_precision(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(second=0, microsecond=0)


def _validate_time_range(item_type: str, start_at: datetime | None, due_at: datetime | None) -> None:
    if start_at is None or due_at is None:
        if item_type == "event":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="event start_at and due_at are required",
            )
        if start_at is not None or due_at is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="start_at and due_at must be provided together",
            )
        return
    if due_at <= start_at:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="due_at must be later than start_at",
        )


@router.get("", response_model=ScheduleItemListOut)
def list_schedule_items(
    start: datetime | None = None,
    end: datetime | None = None,
    include_deleted: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(ScheduleItem).filter(ScheduleItem.user_id == user.id)
    if not include_deleted:
        query = query.filter(ScheduleItem.deleted_at.is_(None))
    if start is not None and end is not None:
        query = query.filter(
            ScheduleItem.start_at < end,
            ScheduleItem.due_at > start,
        )
    elif start is not None:
        query = query.filter(ScheduleItem.due_at > start)
    elif end is not None:
        query = query.filter(ScheduleItem.start_at < end)

    items = query.order_by(
        ScheduleItem.deleted_at.isnot(None),
        ScheduleItem.sort_order,
        ScheduleItem.start_at.is_(None),
        ScheduleItem.start_at,
        ScheduleItem.created_at,
    ).all()
    return {"items": items}


@router.post("", response_model=ScheduleItemOut, status_code=status.HTTP_201_CREATED)
def create_schedule_item(
    body: ScheduleItemCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    start_at = _minute_precision(body.start_at)
    due_at = _minute_precision(body.due_at)
    reminder_at = _minute_precision(body.reminder_at)
    _validate_time_range(body.type, start_at, due_at)
    now = datetime.now()
    completed_at = _minute_precision(body.completed_at) if body.status == "completed" else None

    item = ScheduleItem(
        id=body.id or uuid4().hex,
        user_id=user.id,
        type=body.type,
        title=body.title.strip(),
        description=body.description,
        status=body.status,
        priority=body.priority,
        start_at=start_at,
        due_at=due_at,
        reminder_at=reminder_at,
        pomodoro_count=body.pomodoro_count,
        pomodoro_rounds=body.pomodoro_rounds,
        total_focus_minutes=body.total_focus_minutes,
        completed_at=completed_at,
        deleted_at=_minute_precision(body.deleted_at),
        sort_order=body.sort_order,
        created_at=now,
        updated_at=now,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=ScheduleItemOut)
def update_schedule_item(
    item_id: str,
    body: ScheduleItemUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.query(ScheduleItem).filter(
        ScheduleItem.id == item_id,
        ScheduleItem.user_id == user.id,
    ).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    updates = body.model_dump(exclude_unset=True)
    for field in ("start_at", "due_at", "reminder_at", "completed_at", "deleted_at"):
        if field in updates:
            updates[field] = _minute_precision(updates[field])

    next_type = updates.get("type", item.type)
    next_start = updates.get("start_at", item.start_at)
    next_due = updates.get("due_at", item.due_at)
    _validate_time_range(next_type, next_start, next_due)

    if updates.get("status") == "completed" and "completed_at" not in updates:
        updates["completed_at"] = _minute_precision(datetime.now())
    elif updates.get("status") and updates.get("status") != "completed" and "completed_at" not in updates:
        updates["completed_at"] = None

    if "title" in updates and updates["title"] is not None:
        updates["title"] = updates["title"].strip()

    for key, value in updates.items():
        setattr(item, key, value)
    item.updated_at = datetime.now()
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}")
def delete_schedule_item(
    item_id: str,
    permanent: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.query(ScheduleItem).filter(
        ScheduleItem.id == item_id,
        ScheduleItem.user_id == user.id,
    ).first()
    if not item:
        return {"ok": True}

    if permanent:
        db.delete(item)
    else:
        item.deleted_at = _minute_precision(datetime.now())
        item.updated_at = datetime.now()
    db.commit()
    return {"ok": True}


@router.post("/{item_id}/restore", response_model=ScheduleItemOut)
def restore_schedule_item(
    item_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.query(ScheduleItem).filter(
        ScheduleItem.id == item_id,
        ScheduleItem.user_id == user.id,
    ).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    item.deleted_at = None
    item.updated_at = datetime.now()
    db.commit()
    db.refresh(item)
    return item


@router.delete("")
def clear_schedule_items(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(ScheduleItem).filter(ScheduleItem.user_id == user.id)
    query.delete(synchronize_session=False)
    db.commit()
    return {"ok": True}
