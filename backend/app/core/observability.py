"""可观测性：结构化 JSON 日志 + 请求 ID 贯穿 + 落盘轮转。

## 为什么要写两处

- **stdout**：给 `docker logs` 和未来的采集器（Loki/Promtail）用
- **文件**：容器重建后 `docker logs` 就没了，历史全丢。
  排查「昨天那次 500」只能靠文件。

文件按大小轮转（默认 20MB × 5 份），不依赖日志级别。

## 敏感信息

脱敏分两层：

1. **按键名**：`extra_fields` 里的敏感键直接丢弃（`SENSITIVE_KEYS`）
2. **按内容**：`msg` 和异常堆栈里的密码/令牌用正则盖掉

第 2 层是必须的 —— 第一版只做了第 1 层，于是
`logger.info(f"登录失败 user={u} pwd={p}")` 这种写法会把密码原样写进日志。
正则只在「敏感词 + =/: + 值」同时出现时才动手，避免误伤正常文案。
"""

from __future__ import annotations

import contextvars
import json
import logging
import logging.handlers
import os
import re
import sys
import time
import uuid
from pathlib import Path

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")

# 敏感字段名：extra_fields 里出现这些键，整条丢弃
SENSITIVE_KEYS = {
    "password", "passwd", "pwd", "token", "access_token", "refresh_token",
    "api_key", "apikey", "authorization", "secret", "jwt_secret", "cookie",
}

# 内容级脱敏。只在「敏感词 + 分隔符 + 值」同时出现时动手，避免误伤正常文案。
_REDACTIONS: tuple[tuple[re.Pattern[str], str], ...] = (
    # Authorization: Bearer xxx
    (re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._\-]{8,}"), r"\1***"),
    # password=xxx / token: xxx / api_key="xxx"
    (
        re.compile(
            r"(?i)\b(password|passwd|pwd|secret|token|access_token|refresh_token|"
            r"api_key|apikey|authorization|jwt_secret)\b(\s*[=:]\s*)"
            r"(\"[^\"]{0,300}\"|'[^']{0,300}'|[^\s,;&}\]]+)"
        ),
        r"\1\2***",
    ),
    # OpenAI / 类似服务商的 key
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{12,}"), "sk-***"),
    # JWT：三段点分
    (
        re.compile(
            r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{4,}"
        ),
        "***JWT***",
    ),
)


def _truncate(text: str, limit: int = 2000) -> str:
    """超长文本保留首尾。

    堆栈的前几行是「谁调了谁」，最后一行是「到底什么错」。
    直接 `[:2000]` 会正好把最后那行切掉 —— 排查时最需要的就是它。
    """
    if len(text) <= limit:
        return text
    head = limit * 3 // 5
    tail = limit - head
    return f"{text[:head]}\n…（省略 {len(text) - limit} 字）…\n{text[-tail:]}"


def redact(text: str) -> str:
    """把文本里的凭据盖掉。对非字符串原样返回。"""
    if not isinstance(text, str) or not text:
        return text
    for pattern, replacement in _REDACTIONS:
        text = pattern.sub(replacement, text)
    return text


class JsonFormatter(logging.Formatter):
    """单行 JSON：既能直接 grep，也能被 Loki/ELK 采集。"""

    def __init__(self, service: str = ""):
        super().__init__()
        self.service = service

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(record.created))
            + f".{int(record.msecs):03d}",
            "level": record.levelname,
            "logger": record.name,
            "msg": redact(record.getMessage()),
            "request_id": request_id_var.get(),
        }
        if self.service:
            payload["svc"] = self.service
        if record.exc_info:
            payload["exc"] = _truncate(redact(self.formatException(record.exc_info)))

        extra = getattr(record, "extra_fields", None)
        if isinstance(extra, dict):
            for key, value in extra.items():
                if key.lower() in SENSITIVE_KEYS:
                    continue
                payload[key] = redact(value) if isinstance(value, str) else value

        return json.dumps(payload, ensure_ascii=False)


def resolve_log_file(log_dir: str, name: str) -> Path | None:
    """算出日志文件路径。目录不可写时返回 None（退化成只打 stdout）。"""
    if not log_dir:
        return None
    try:
        directory = Path(log_dir)
        directory.mkdir(parents=True, exist_ok=True)
        return directory / f"{name}.jsonl"
    except OSError as exc:  # 挂载缺失 / 只读
        print(f"[logging] 无法创建日志目录 {log_dir}: {exc}，仅输出到 stdout", file=sys.stderr)
        return None


def configure_logging(
    level: str = "INFO",
    json_output: bool = True,
    *,
    log_file: Path | None = None,
    service: str = "",
    max_bytes: int = 20 * 1024 * 1024,
    backup_count: int = 5,
) -> None:
    """配置根 logger：stdout + 可选的轮转文件。

    文件 handler 用 RotatingFileHandler，**不是多进程安全的** ——
    所以 backend 和 worker 各写各的文件，靠 `log_file_name` 区分。
    """
    formatter: logging.Formatter = (
        JsonFormatter(service) if json_output
        else logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
    )

    handlers: list[logging.Handler] = []
    stream = logging.StreamHandler(sys.stderr)
    stream.setFormatter(formatter)
    handlers.append(stream)

    if log_file is not None:
        try:
            file_handler = logging.handlers.RotatingFileHandler(
                log_file,
                maxBytes=max_bytes,
                backupCount=backup_count,
                encoding="utf-8",
            )
            file_handler.setFormatter(formatter)
            handlers.append(file_handler)
        except OSError as exc:
            print(f"[logging] 无法打开日志文件 {log_file}: {exc}", file=sys.stderr)

    root = logging.getLogger()
    root.handlers = handlers
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    # 这些库的 INFO 日志噪声太大
    for noisy in ("httpx", "httpcore", "openai", "urllib3", "watchdog"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def setup_from_settings(service: str) -> None:
    """按 settings 配置日志。backend 和 worker 都在启动时调一次。"""
    from app.database import settings

    log_file = resolve_log_file(settings.log_dir, settings.log_file_name or service)
    configure_logging(
        level=settings.log_level,
        log_file=log_file,
        service=service,
        max_bytes=settings.log_max_bytes,
        backup_count=settings.log_backup_count,
    )
    if log_file is not None:
        logging.getLogger(__name__).info("日志落盘: %s", log_file)


class RequestContextMiddleware(BaseHTTPMiddleware):
    """为每个请求生成 request_id，并记录方法、路径、状态码与耗时。

    响应头返回 X-Request-ID，便于用户报错时直接给出定位线索。
    """

    async def dispatch(self, request: Request, call_next):
        incoming = request.headers.get("x-request-id", "")
        request_id = incoming[:64] if incoming else uuid.uuid4().hex[:16]
        token = request_id_var.set(request_id)
        # 同时写进 scope：@app.exception_handler(Exception) 挂在
        # ServerErrorMiddleware 上，比 BaseHTTPMiddleware 更外层，
        # 那个上下文里读不到 contextvar。不写这一句，
        # 500 的日志 request_id 会是 "-"，而响应体恰好让用户「附带 request_id 反馈」。
        request.scope["request_id"] = request_id
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


def bind_request_id(value: str) -> None:
    """给非 HTTP 上下文（worker 任务）绑一个可追踪的 id。

    worker 里没有请求，但一次转写会打十几条日志。用 job_id 当 request_id，
    就能把「同一个任务的日志」串起来 —— grep 一个 id 看完整过程。
    """
    request_id_var.set((value or "-")[:64])
