"""类型化错误体系与全局异常处理。

客户端只会看到 {error: {code, message, request_id}}，
堆栈与内部细节只进服务端日志。
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.observability import request_id_var

logger = logging.getLogger(__name__)


class AppError(Exception):
    """业务异常基类。"""

    code = "internal_error"
    status_code = 500
    message = "服务内部错误"

    def __init__(self, message: str | None = None, *, detail: object = None):
        self.message = message or self.message
        self.detail = detail
        super().__init__(self.message)


class NotFoundError(AppError):
    code = "not_found"
    status_code = 404
    message = "资源不存在"


class InvalidInputError(AppError):
    code = "invalid_input"
    status_code = 422
    message = "参数不合法"


class UpstreamError(AppError):
    code = "upstream_error"
    status_code = 502
    message = "上游服务不可用"


class ServiceUnavailableError(AppError):
    code = "service_unavailable"
    status_code = 503
    message = "服务暂不可用"


def _payload(code: str, message: str, detail: object = None) -> dict:
    body: dict = {"error": {"code": code, "message": message, "request_id": request_id_var.get()}}
    if detail is not None:
        body["error"]["detail"] = detail
    return body


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError):
        if exc.status_code >= 500:
            logger.error("业务异常 %s: %s", exc.code, exc.message, exc_info=exc)
        else:
            logger.info("业务异常 %s: %s", exc.code, exc.message)
        return JSONResponse(
            status_code=exc.status_code,
            content=_payload(exc.code, exc.message, exc.detail),
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation(_request: Request, exc: RequestValidationError):
        # 只回传字段与原因，不回显原始输入（可能含敏感内容）
        simplified = [
            {"loc": ".".join(str(x) for x in err.get("loc", [])), "msg": err.get("msg", "")}
            for err in exc.errors()[:10]
        ]
        return JSONResponse(
            status_code=422,
            content=_payload("invalid_input", "请求参数校验失败", simplified),
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http(_request: Request, exc: StarletteHTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content=_payload("http_error", str(exc.detail)),
        )

    @app.exception_handler(Exception)
    async def handle_unexpected(_request: Request, exc: Exception):
        logger.exception("未捕获异常")
        return JSONResponse(
            status_code=500,
            content=_payload("internal_error", "服务内部错误，请附带 request_id 反馈"),
        )
