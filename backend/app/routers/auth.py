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
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.auth import (
    clear_session_cookie,
    create_token,
    get_current_user,
    hash_password,
    needs_rehash,
    require_admin,
    set_session_cookie,
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


def _issue_session(response: Response, user: User) -> TokenOut:
    """签发令牌并写入 httpOnly Cookie。

    响应体里仍然带 access_token，是为了让脚本/CLI 能直接用；
    前端不持久化它 —— 浏览器侧只依赖 Cookie，JS 读不到，XSS 也就偷不走。
    """
    token = create_token(user)
    set_session_cookie(response, token)
    return TokenOut(
        access_token=token,
        user=UserOut(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            role=user.role or "member",
        ),
    )


@router.post("/register", response_model=TokenOut)
def register(
    body: UserRegister,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
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

    return _issue_session(response, user)


@router.post("/login", response_model=TokenOut)
def login(
    body: UserLogin,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
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
    return _issue_session(response, user)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return UserOut(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        role=user.role or "member",
    )


@router.post("/logout")
def logout(response: Response):
    """清除会话 Cookie。

    令牌本身仍然有效直到过期（无状态），所以真正的强制下线要靠
    token_version：改密码或管理员踢人时 +1，旧令牌立刻作废。
    """
    clear_session_cookie(response)
    return {"ok": True}


@router.post("/change-password")
def change_password(
    body: PasswordChange,
    response: Response,
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
    # Cookie 里还是旧令牌，留着只会每次请求 401，直接清掉
    clear_session_cookie(response)
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

    历史迁移只允许发生在空库首次初始化：库里已有任何用户时直接拒绝，
    避免把同一份 kv_data 复制进多个账号，或覆盖已有账号的私有数据。
    """
    if db.query(User).count() > 0:
        raise HTTPException(status_code=403, detail="后端已有用户数据，迁移接口已关闭")

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
            # 注意：不要写成 u.get("passwordHash", hash_password(""))。
            # Python 会在调用 dict.get **之前**求值默认参数，而
            # hash_password("") 第一行就 raise ValueError，
            # 于是即使 passwordHash 存在，每个新用户也必抛异常 → 整个接口 500。
            raw_hash = u.get("passwordHash")
            if not raw_hash:
                # 没有旧哈希就生成一个随机密码占位：用户必须走「找回密码」，
                # 但绝不能因此让整批迁移失败。
                raw_hash = hash_password(secrets.token_urlsafe(24))
            user = User(
                username=normalized,
                password_hash=raw_hash,
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
