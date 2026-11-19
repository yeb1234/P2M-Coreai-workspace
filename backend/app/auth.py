"""认证与授权。

密码哈希
--------
早期版本用无盐 SHA-256，彩虹表可以直接反查，相同密码哈希也完全相同。
现在改为 PBKDF2-HMAC-SHA256（标准库实现，不增加镜像依赖）：
    pbkdf2_sha256$<迭代数>$<salt_hex>$<hash_hex>

为什么带算法前缀：以后换 argon2 时，可以在登录路径上按前缀分流并透明升级，
不需要强制所有用户重置密码。旧格式（64 位十六进制）仍可校验，
校验成功后立即重写为 PBKDF2 —— 用户无感知，存量弱哈希自然消失。

令牌撤销
--------
JWT 是无状态的，签发后无法收回。users.token_version 提供一个廉价出口：
令牌里带 ver，校验时与库里的值比对。改密码时 version + 1，
此前签发的所有令牌立刻失效。
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.database import get_db, settings
from app.models import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

ALGORITHM_PREFIX = "pbkdf2_sha256"
DEFAULT_ITERATIONS = 600_000
_SALT_BYTES = 16


# --------------------------------------------------------------------------
# 密码哈希
# --------------------------------------------------------------------------


def hash_password(password: str, *, iterations: int = DEFAULT_ITERATIONS) -> str:
    """生成带算法标识的 PBKDF2 哈希。"""
    if not isinstance(password, str) or not password:
        raise ValueError("密码不能为空")
    salt = secrets.token_bytes(_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"{ALGORITHM_PREFIX}${iterations}${salt.hex()}${digest.hex()}"


def _looks_like_legacy_sha256(stored: str) -> bool:
    """旧格式：裸的 64 位十六进制，没有算法前缀。"""
    if len(stored) != 64:
        return False
    try:
        int(stored, 16)
    except ValueError:
        return False
    return True


def verify_password(password: str, stored_hash: str) -> bool:
    """常数时间校验，兼容旧的无盐 SHA-256。"""
    if not stored_hash:
        return False

    if stored_hash.startswith(f"{ALGORITHM_PREFIX}$"):
        parts = stored_hash.split("$")
        if len(parts) != 4:
            return False
        _, iterations_raw, salt_hex, digest_hex = parts
        try:
            iterations = int(iterations_raw)
            salt = bytes.fromhex(salt_hex)
        except (ValueError, TypeError):
            return False
        candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        return hmac.compare_digest(candidate.hex(), digest_hex)

    if _looks_like_legacy_sha256(stored_hash):
        legacy = hashlib.sha256(password.encode("utf-8")).hexdigest()
        return hmac.compare_digest(legacy, stored_hash.lower())

    return False


def needs_rehash(stored_hash: str) -> bool:
    """是否需要升级哈希格式（旧格式或迭代数偏低）。"""
    if not stored_hash.startswith(f"{ALGORITHM_PREFIX}$"):
        return True
    parts = stored_hash.split("$")
    if len(parts) != 4:
        return True
    try:
        return int(parts[1]) < DEFAULT_ITERATIONS
    except ValueError:
        return True


# --------------------------------------------------------------------------
# JWT
# --------------------------------------------------------------------------


def create_token(user: User, *, expires_hours: int | None = None) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(hours=expires_hours or settings.jwt_expire_hours)
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role or "member",
        "ver": int(user.token_version or 0),
        "typ": "access",
        "jti": secrets.token_hex(8),
        "iat": now,
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录已过期，请重新登录",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录凭证无效",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _user_from_token(token: str, db: Session) -> User:
    payload = decode_token(token)
    if payload.get("typ") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录凭证类型不正确",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        user_id = int(payload.get("sub", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录凭证无效")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号不存在")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账号已被停用")

    # 令牌版本不一致，说明密码改过或管理员强制下线
    if int(payload.get("ver", -1)) != int(user.token_version or 0):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录状态已失效，请重新登录",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def extract_token(request: Request, bearer: str | None = None) -> str | None:
    """从请求里取令牌，Cookie 优先于 Authorization。

    Cookie 是主路径：httpOnly 意味着 JS（包括被注入的脚本）读不到它，
    XSS 拿不到令牌就没法把会话带出去。
    Authorization 头保留给脚本/CLI 调用，也兼容升级前还存着旧令牌的浏览器。
    """
    cookie_token = request.cookies.get(settings.session_cookie_name)
    if cookie_token:
        return cookie_token
    return bearer


def set_session_cookie(response: Response, token: str) -> None:
    max_age = int(settings.jwt_expire_hours * 3600)
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
    )


def get_current_user(
    request: Request,
    bearer: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """必须登录。未登录一律 401。"""
    token = extract_token(request, bearer)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="需要登录",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _user_from_token(token, db)


def get_optional_user(
    request: Request,
    bearer: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    """可匿名访问的端点用这个。

    注意：这里对无效令牌返回 None 而不是抛错。埋点这类端点宁可丢一条统计，
    也不能因为令牌过期就让播放器开始报错。
    """
    token = extract_token(request, bearer)
    if not token:
        return None
    try:
        return _user_from_token(token, db)
    except HTTPException:
        return None


def require_admin(user: User = Depends(get_current_user)) -> User:
    """管理端专用。角色必须是 admin。"""
    if (user.role or "member") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限",
        )
    return user
