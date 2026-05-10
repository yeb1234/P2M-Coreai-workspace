from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import create_token, get_current_user, hash_password, verify_password
from app.database import get_db
from app.models import User, UserData
from app.schemas import TokenOut, UserLogin, UserOut, UserRegister, UserDataBulkImport

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _normalize(username: str) -> str:
    return username.strip().lower()


@router.post("/register", response_model=TokenOut)
def register(body: UserRegister, db: Session = Depends(get_db)):
    normalized = _normalize(body.username)
    existing = db.query(User).filter(User.username == normalized).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已存在")

    user = User(
        username=normalized,
        password_hash=hash_password(body.password),
        display_name=body.username.strip(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_token(user.id, user.username)
    return TokenOut(
        access_token=token,
        user=UserOut(id=user.id, username=user.username, display_name=user.display_name),
    )


@router.post("/login", response_model=TokenOut)
def login(body: UserLogin, db: Session = Depends(get_db)):
    normalized = _normalize(body.username)
    user = db.query(User).filter(User.username == normalized).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    token = create_token(user.id, user.username)
    return TokenOut(
        access_token=token,
        user=UserOut(id=user.id, username=user.username, display_name=user.display_name),
    )


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return UserOut(id=user.id, username=user.username, display_name=user.display_name)


@router.post("/migrate")
def migrate(body: UserDataBulkImport, db: Session = Depends(get_db)):
    migrated_users = 0
    total_kv = 0

    for u in body.users:
        normalized = _normalize(u.get("username", ""))
        if not normalized:
            continue
        existing = db.query(User).filter(User.username == normalized).first()
        if existing:
            user = existing
        else:
            user = User(
                username=normalized,
                password_hash=u.get("passwordHash", hash_password("")),
                display_name=u.get("displayName") or normalized,
            )
            db.add(user)
            db.flush()
            migrated_users += 1

        for store_key, value in body.kv_data.items():
            if not value:
                continue
            row = db.query(UserData).filter(
                UserData.user_id == user.id, UserData.store_key == store_key
            ).first()
            if row:
                row.value = value
            else:
                db.add(UserData(user_id=user.id, store_key=store_key, value=value))
            total_kv += 1

    db.commit()
    return {"migrated_users": migrated_users, "kv_imported": total_kv}
