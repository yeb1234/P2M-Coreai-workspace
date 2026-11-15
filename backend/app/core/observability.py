"""可观测性：结构化 JSON 日志 + 请求 ID 贯穿。

日志只输出白名单字段，不记录 prompt 全文、密钥与用户隐私内容。
"""

from __future__ import annotations

import contextvars
import json
import logging
import sys
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")

# 敏感字段名，落日志前替换
SENSITIVE_KEYS = {
    "password", "passwd", "token", "access_token", "refresh_token",
    "api_key", "apikey", "authorization", "secret", "jwt_secret",
}


class JsonFormatter(logging.Formatter):
    """单行 JSON，便于后续被 Loki/ELK 采集，也方便 grep。"""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(record.created))
            + f".{int(record.msecs):03d}",
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)[:2000]
        extra = getattr(record, "extra_fields", None)
        if isinstance(extra, dict):
            payload.update({k: v for k, v in extra.items() if k.lower() not in SENSITIVE_KEYS})
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: str = "INFO", json_output: bool = True) -> None:
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(JsonFormatter() if json_output else logging.Formatter(
        "%(asctime)s %(levelname)s [%(name)s] %(message)s"
    ))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    # 这些库的 INFO 日志噪声太大
    for noisy in ("httpx", "httpcore", "openai", "urllib3", "watchdog"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


class RequestContextMiddleware(BaseHTTPMiddleware):
    """为每个请求生成 request_id，并记录方法、路径、状态码与耗时。

    响应头返回 X-Request-ID，便于用户报错时直接给出定位线索。
    """

    async def dispatch(self, request: Request, call_next):
        incoming = request.headers.get("x-request-id", "")
        request_id = incoming[:64] if incoming else uuid.uuid4().hex[:16]
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            response.headers["X-Request-ID"] = request_id
            return response
        finally:
            elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
            path = request.url.path
            # 静态资源与 SPA 兜底路由不记，避免刷屏
            if not path.startswith(("/assets/", "/thumbnails/", "/sprites/", "/output/")):
                logging.getLogger("access").info(
                    "%s %s -> %s",
                    request.method,
                    path,
                    status_code,
                    extra={
                        "extra_fields": {
                            "method": request.method,
                            "path": path,
                            "status": status_code,
                            "ms": elapsed_ms,
                            "client": request.client.host if request.client else None,
                        }
                    },
                )
            request_id_var.reset(token)
