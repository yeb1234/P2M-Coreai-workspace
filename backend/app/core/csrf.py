"""CSRF 防护。

为什么需要
----------
令牌从 localStorage 搬进 httpOnly Cookie 后，浏览器会自动带上 Cookie，
这正好是 CSRF 成立的条件：恶意站点只要诱导用户发起一个跨站 POST，
请求就会带着有效 Cookie 打到我们这里。

三道防线，这里是第二、第三道：
1. Cookie 设 SameSite=Lax —— 跨站 POST 默认不带 Cookie
2. 本中间件：带会话 Cookie 的写请求，Origin/Referer 必须同源或命中白名单
3. 请求体统一 JSON —— 普通 HTML 表单发不出 application/json，
   而 `Content-Type: application/json` 的跨站请求会触发 CORS 预检，预检过不去

只检查写方法：GET 不该改数据，如果改了那是接口设计的问题。
没有 Origin 也没有 Referer 的请求（curl、服务端调用）放行 ——
这类请求不会自动带 Cookie，除非调用方主动塞，那就已经超出 CSRF 的威胁模型了。
"""

from __future__ import annotations

import logging
from urllib.parse import urlparse

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.database import settings

logger = logging.getLogger(__name__)

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def _hostname(value: str) -> str:
    """取主机名，丢掉端口。

    为什么丢端口：Cookie 的 SameSite 判定按主机名算，端口不参与。
    CSRF 白名单若按 host:port 严格比，同一台机器的 80 和 12302 会被当成两个站点，
    换端口后登录直接 403（2026-11-16 实测：127.0.0.1:12302 被拦，localhost:12302 放行），
    局域网用 IP 访问也全挂。对齐 SameSite 语义才是正确口径。
    """
    try:
        parsed = urlparse(value if "//" in value else f"//{value}")
        return (parsed.hostname or "").lower()
    except ValueError:
        return ""


def _origin_hosts() -> set[str]:
    hosts: set[str] = set()
    for item in settings.cors_origin_list:
        host = _hostname(item)
        if host:
            hosts.add(host)
    return hosts


class CSRFGuardMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method in SAFE_METHODS:
            return await call_next(request)

        # 没有会话 Cookie 就谈不上 CSRF：未认证的写请求本来就该被鉴权挡掉
        if not request.cookies.get(settings.session_cookie_name):
            return await call_next(request)

        source = request.headers.get("origin") or request.headers.get("referer") or ""
        if not source:
            # 非浏览器客户端（curl / 内部调用），不自动携带 Cookie，放行
            return await call_next(request)

        try:
            source_host = _hostname(source)
        except ValueError:
            source_host = ""

        allowed = _origin_hosts()
        request_host = _hostname(request.headers.get("host") or "")
        if request_host:
            allowed.add(request_host)

        if source_host and source_host in allowed:
            return await call_next(request)

        logger.warning(
            "CSRF 拦截：method=%s path=%s origin=%s", request.method, request.url.path, source[:120]
        )
        return JSONResponse(
            status_code=403,
            content={
                "error": {
                    "code": "csrf_rejected",
                    "message": "请求来源不被信任，请刷新页面后重试",
                }
            },
        )
