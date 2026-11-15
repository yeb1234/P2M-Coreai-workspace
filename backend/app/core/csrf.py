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


def _origin_hosts() -> set[str]:
    hosts: set[str] = set()
    for item in settings.cors_origin_list:
        try:
            parsed = urlparse(item)
            if parsed.netloc:
                hosts.add(parsed.netloc.lower())
        except ValueError:
            continue
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
            source_host = urlparse(source).netloc.lower()
        except ValueError:
            source_host = ""

        allowed = _origin_hosts()
        request_host = (request.headers.get("host") or "").lower()
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
