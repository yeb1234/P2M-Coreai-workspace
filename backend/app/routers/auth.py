"""认证路由。

安全要点
--------
1. 注册默认关闭（ALLOW_REGISTRATION=false），避免公网被灌号。
   首次部署时临时开启注册自己，之后关掉，后续账号由管理员创建。
2. 登录失败不区分「用户不存在」和「密码错误」，避免账号枚举。
3. 登录成功后如果发现是旧的无盐 SHA-256 哈希，立刻重写为 PBKDF2。
4. 改密码会递增 token_version，把此前签发的所有令牌一次性作废。
"""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.auth import (
    create_token,
    get_current_user,
    hash_password,
    needs_rehash,
    require_admin,
    verify_password,
)
from app.database import get_db, settings
from app.models import User, UserData
from app.schemas import (
    PasswordChange,
    TokenOut,
    UserDataBulkImport,
    UserLogin,
    UserOut,
    UserRegister,
)
from app.services.rate_limit import (
    login_ip_limiter,
    login_user_limiter,
    register_limiter,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _normalize(username: str) -> str:
    return (username or "").strip().lower()


def _client_ip(request: Request) -> str:
    """取真实客户端 IP。

    只有一层 nginx，且它用 $remote_addr 覆盖 X-Real-IP，
    所以这个头在这里可信。若将来前面再加 CDN，需要改成取可信链的最后一跳。
    """
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()[:64]
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "unknown")[:64]


def _should_be_admin(db: Session, username: str) -> bool:
    """谁能成为管理员。

    两条路径：
    - 用户名在 ADMIN_USERNAMES 白名单里（推荐，部署时显式配置）
    - 系统里还没有任何管理员（首次部署的引导路径）
    """
    if username in settings.admin_username_set:
        return True
    has_admin = db.query(User.id).filter(User.role == "admin").first()
    return has_admin is None


def _token_response(user: User) -> TokenOut:
    return TokenOut(
        access_token=create_token(user),
        user=UserOut(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            role=user.role or "member",
        ),
    )


@router.post("/register", response_model=TokenOut)
def register(body: UserRegister, request: Request, db: Session = Depends(get_db)):
    if not settings.allow_registration:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="注册已关闭，请联系管理员开通账号",
        )

    allowed, _ = register_limiter.hit(_client_ip(request))
    if not allowed:
        raise HTTPException(status_code=429, detail="注册过于频繁，请稍后再试")

    normalized = _normalize(body.username)
    existing = db.query(User).filter(User.username == normalized).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已存在")

    role = "admin" if _should_be_admin(db, normalized) else "member"
    user = User(
        username=normalized,
        password_hash=hash_password(body.password),
        display_name=body.username.strip(),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    logger.info("新用户注册 id=%s role=%s", user.id, role)

    return _token_response(user)


@router.post("/login", response_model=TokenOut)
def login(body: UserLogin, request: Request, db: Session = Depends(get_db)):
    ip = _client_ip(request)
    normalized = _normalize(body.username)

    ip_ok, _ = login_ip_limiter.hit(ip)
    if not ip_ok:
        raise HTTPException(status_code=429, detail="尝试过于频繁，请 15 分钟后再试")

    user_ok, remaining = login_user_limiter.hit(normalized)
    if not user_ok:
        raise HTTPException(
            status_code=429,
            detail="该账号尝试次数过多，请 15 分钟后再试",
        )

    user = db.query(User).filter(User.username == normalized).first()
    if not user or not verify_password(body.password, user.password_hash):
        logger.warning("登录失败 user=%s ip=%s 剩余尝试=%s", normalized, ip, remaining)
        # 不区分「用户不存在」与「密码错误」，避免账号枚举
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账号已被停用")

    # 旧的无盐 SHA-256 在这里透明升级，用户无感知
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
        logger.info("升级用户 %s 的密码哈希到 PBKDF2", user.username)

    user.last_login_at = datetime.now()
    db.commit()
    db.refresh(user)

    login_user_limiter.reset(normalized)
    return _token_response(user)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return UserOut(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        role=user.role or "member",
    )


@router.post("/change-password")
def change_password(
    body: PasswordChange,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前密码不正确")
    if body.current_password == body.new_password:
        raise HTTPException(status_code=422, detail="新密码不能与当前密码相同")

    user.password_hash = hash_password(body.new_password)
    # 使所有已签发的令牌失效，包括当前这台设备，强制重新登录
    user.token_version = int(user.token_version or 0) + 1
    db.commit()
    logger.info("用户 %s 修改密码，旧令牌已全部作废", user.username)
    return {"ok": True, "message": "密码已更新，请重新登录"}


@router.post("/create-user", response_model=UserOut)
def create_user_by_admin(
    body: UserRegister,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """管理员开通账号。注册关闭后，这是唯一的建号入口。"""
    normalized = _normalize(body.username)
    if db.query(User).filter(User.username == normalized).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已存在")

    user = User(
        username=normalized,
        password_hash=hash_password(body.password),
        display_name=body.username.strip(),
        role="member",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserOut(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        role=user.role or "member",
    )


@router.post("/migrate")
def migrate(
    body: UserDataBulkImport,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """从旧的本地存储导入账号与键值数据。

    必须管理员调用：这个接口能创建账号并覆盖任意用户的 user_data，
    早期版本没有任何鉴权，等于把写入权限完全开放。
    """
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
            # 旧数据里的 passwordHash 是裸 SHA-256，保持原样以便原密码仍能登录，
            # 首次登录时会自动升级为 PBKDF2
            user = User(
                username=normalized,
                password_hash=u.get("passwordHash", hash_password("")),
                display_name=u.get("displayName") or normalized,
                role="member",
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
