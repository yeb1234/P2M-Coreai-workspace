from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import User, UserData
from app.schemas import UserDataItem

router = APIRouter(prefix="/api/user-data", tags=["user-data"])


@router.get("/{store_key}")
def get_user_data(
    store_key: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(UserData).filter(
        UserData.user_id == user.id, UserData.store_key == store_key
    ).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return {"value": row.value}


@router.put("/{store_key}")
def set_user_data(
    store_key: str,
    body: UserDataItem,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(UserData).filter(
        UserData.user_id == user.id, UserData.store_key == store_key
    ).first()
    if row:
        row.value = body.value
    else:
        db.add(UserData(user_id=user.id, store_key=store_key, value=body.value))
    db.commit()
    return {"ok": True}


@router.delete("/{store_key}")
def delete_user_data(
    store_key: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(UserData).filter(
        UserData.user_id == user.id, UserData.store_key == store_key
    ).first()
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True}
