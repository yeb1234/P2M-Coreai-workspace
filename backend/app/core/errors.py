"""全局异常处理。

客户端只会看到 {error: {code, message, request_id}}，
堆栈与内部细节只进服务端日志。

## 为什么没有类型化异常类了

这里原来有一套 AppError / NotFoundError / InvalidInputError /
UpstreamError / ServiceUnavailableError，配一个 @app.exception_handler(AppError)。
2026-11 清理时删掉了：全项目 0 处 raise，所有端点统一用 HTTPException。
留着的话下一个人会以为「业务错误应该抛 AppError」，而实际上不会有人接。

真要加回来，注意中间件顺序：@app.exception_handler(Exception) 挂在
ServerErrorMiddleware 上，比 BaseHTTPMiddleware 更外层，那里读不到
中间件设的 contextvar —— 需要像下面 _bind_rid 那样从 request.scope 回填。
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.observability import request_id_var

logger = logging.getLogger(__name__)


def _bind_rid(request: Request) -> None:
    """把 request_id 从 scope 回填进 contextvar。

    为什么需要：@app.exception_handler(Exception) 挂在 ServerErrorMiddleware 上，
    比 BaseHTTPMiddleware 更外层 —— 那个上下文里读不到中间件设的 contextvar。
    不回填的话，500 的日志和响应体里 request_id 都是 "-"，
    而响应体又写着「请附带 request_id 反馈」，等于让人拿个空号去查。
    """
    from app.core.observability import bind_request_id

    rid = request.scope.get("request_id") or request.headers.get("x-request-id") or "-"
    bind_request_id(str(rid))


def _payload(code: str, message: str, detail: object = None) -> dict:
    body: dict = {"error": {"code": code, "message": message, "request_id": request_id_var.get()}}
    if detail is not None:
        body["error"]["detail"] = detail
    return body


def register_exception_handlers(app: FastAPI) -> None:
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
        _bind_rid(_request)
        logger.exception("未捕获异常")
        return JSONResponse(
            status_code=500,
            content=_payload("internal_error", "服务内部错误，请附带 request_id 反馈"),
        )
