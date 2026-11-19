"""LLM 工厂（LangChain ChatOpenAI 封装）+ provider 级限流 / 退避 / 降级。

两条通道：
- external: discovery-api 的 deepseek-v4.1-flash-1017，通过 extra_body 关掉思考链
  （实测 0.4s vs 默认 57s，差 140 倍），支持 tools 与 structured outputs
- local: 本机 LM Studio 的 OpenAI 兼容端点，离线兜底

为什么用 extra_body 而不是 model_kwargs：后者会被当成顶层参数直接传给
Completions.create，实测抛 TypeError。

## 配置来源（2026-11 修）

`resolve_config` 原来读 `app.database.settings`（环境变量），而设置页保存的是
数据库里 `app_settings.assistant_runtime_settings`。两条链路读的不是同一份数据，
导致「在设置页改了 base_url / model，对话毫无变化」。现在统一以数据库为准，
数据库没有记录时才回落到环境变量。

## 可靠性封装

`classify_llm_error` / `describe_llm_error`：把上游异常翻成「用户能看懂的原因」，
供设置页的扫模型、连通性测试和后台任务复用。

`provider_slot` + `call_with_retry`：同一个 provider 的请求做节流（本地单模型
串行、外部保留最小间隔），429/5xx/超时会指数退避重试（429 至少等 5s、听
Retry-After、最多 30s）；401/403/404 与「余额/配额不足」不重试 ——
前者换 key，后者换通道或充值，重试都是白等。
key 错或路径错，重试一百次也是同一个结果，直接换 provider 才有意义。

`call_with_fallback`：按调用方给的顺序依次尝试 provider，返回「是不是降级成功」，
让上层能把「已降级到本地」写进 job.message / summary_error。
"""

from __future__ import annotations

import logging
import re
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from collections.abc import Iterable, Mapping
from typing import Callable, Literal, TypeVar
from urllib.parse import urlparse

from langchain_openai import ChatOpenAI

from app.database import settings

logger = logging.getLogger(__name__)

Provider = Literal["external", "local"]
T = TypeVar("T")

# ── 错误分类 ──
# 这些是给前端做分支用的稳定标识，不要随手改字符串。
ERR_NETWORK = "network"           # DNS 失败 / 连接被拒 / 超时
ERR_AUTH = "auth"                 # 401 / 403，key 错或没权限
ERR_NOT_FOUND = "not_found"       # 404，base_url 路径不对（如少了 /v1）
ERR_RATE_LIMIT = "rate_limit"     # 429
ERR_QUOTA = "quota"               # 402 / insufficient_quota：余额或配额用尽，重试无意义
ERR_UPSTREAM = "upstream"         # 5xx
ERR_BAD_RESPONSE = "bad_response"  # 200 但返回体不是 OpenAI 兼容格式
ERR_CONFIG = "config"             # 本端就没配好（缺 base_url / key / model）
ERR_UNKNOWN = "unknown"

# 重试有意义的三类：过一会儿再来可能就好了。
# 401/403/404 不在这里 —— 换个 provider 才是正解。
# 余额/配额不足也不在：充值前重试一百次也一样，只是白等。
RETRYABLE_KINDS = frozenset({ERR_NETWORK, ERR_RATE_LIMIT, ERR_UPSTREAM})

# 限流最多等这么久再试。上游 Retry-After 比这还长就不硬等，
# 超过这个量级用户/任务更该换通道，而不是挂着。
RATE_LIMIT_MAX_WAIT_S = 30.0

# 这些文案代表「账户没钱/配额用尽」，不是限流。
# 注意 OpenAI 把余额不足也塞进 HTTP 429，所以必须先看文案再看状态码。
_QUOTA_TEXT_HINTS = (
    "insufficient_quota",
    "insufficient quota",
    "exceeded your current quota",
    "quota exhausted",
    "quota exceeded",
    "billing hard limit",
    "payment required",
    "credit balance",
    "credit limit",
    "out of credits",
    "no credits",
    "余额不足",
    "额度不足",
    "配额不足",
    "配额已用尽",
    "欠费",
    "请充值",
    "账户余额",
)

_STATUS_RE = re.compile(r"\bHTTP\s*(\d{3})\b", re.IGNORECASE)

_CONNECTION_NAME_HINTS = (
    "connection", "connect", "timeout", "timedout", "gaierror",
    "network", "protocol", "unreachable",
)
_CONNECTION_TEXT_HINTS = (
    "connection refused", "connection reset", "connection aborted",
    "connection error", "timed out", "timeout", "getaddrinfo",
    "name or service not known", "temporary failure in name resolution",
    "max retries exceeded", "failed to establish a new connection",
    "unreachable", "no route to host", "ssl", "certificate verify failed",
)


def _status_code_of(exc: BaseException) -> int | None:
    """从异常里抠出 HTTP 状态码。

    三种来源都要覆盖：openai/httpx 的 APIStatusError 有 status_code；
    requests 的 HTTPError 挂在 response.status_code；
    我们自己的 llm_client 把状态码写进了异常文案（"... API HTTP 404: ..."）。
    """
    for attr in ("status_code", "status"):
        value = getattr(exc, attr, None)
        if isinstance(value, int) and 100 <= value <= 599:
            return value
    response = getattr(exc, "response", None)
    status = getattr(response, "status_code", None)
    if isinstance(status, int) and 100 <= status <= 599:
        return status
    match = _STATUS_RE.search(str(exc) or "")
    if match:
        return int(match.group(1))
    return None


def classify_llm_error(exc: BaseException) -> str:
    """把上游异常归到上面那组稳定标识里。"""
    status = _status_code_of(exc)

    name = type(exc).__name__.lower()
    text = (str(exc) or "").lower()

    # 余额/配额优先于状态码：OpenAI 的 insufficient_quota 走的是 HTTP 429，
    # 若按 429 归类会白白重试好几轮，还给出「限流」这种误导提示。
    if status == 402 or any(hint in text for hint in _QUOTA_TEXT_HINTS):
        return ERR_QUOTA

    # 没拿到状态码时先判连接类：requests.ConnectionError 继承 OSError，
    # socket.gaierror 也是 OSError，用 isinstance 一把抓。
    if status is None:
        if isinstance(exc, OSError) or any(hint in name for hint in _CONNECTION_NAME_HINTS):
            return ERR_NETWORK
        if any(hint in text for hint in _CONNECTION_TEXT_HINTS):
            return ERR_NETWORK
        if "not configured" in text or "未配置" in text:
            return ERR_CONFIG
        if "unexpected openai-compatible" in text or "unexpected ollama" in text:
            return ERR_BAD_RESPONSE
        return ERR_UNKNOWN

    if status in (401, 403):
        return ERR_AUTH
    if status == 404:
        return ERR_NOT_FOUND
    if status == 429:
        return ERR_RATE_LIMIT
    if status >= 500:
        return ERR_UPSTREAM
    # 其余 4xx：请求本身不合法（模型名不存在、参数不支持），重试没意义
    if 400 <= status < 500:
        return ERR_BAD_RESPONSE
    return ERR_UNKNOWN


def is_retryable(exc_or_kind: BaseException | str) -> bool:
    kind = exc_or_kind if isinstance(exc_or_kind, str) else classify_llm_error(exc_or_kind)
    return kind in RETRYABLE_KINDS


def _host_of(base_url: str) -> str:
    try:
        return urlparse(base_url or "").hostname or ""
    except ValueError:
        return ""


def describe_llm_error(
    exc: BaseException,
    *,
    provider: Provider | str | None = None,
    base_url: str = "",
    model: str = "",
) -> str:
    """把异常翻成一句用户能看懂、且能照着改的话（< 200 字，直接进 toast）。"""
    kind = classify_llm_error(exc)
    status = _status_code_of(exc)
    host = _host_of(base_url)
    unreachable = f"无法连接 {base_url}" if base_url else "无法连接模型服务"
    # 句子里 base_url 是「可选主语」：没传时不要留下「模型服务 返回 404」这种空格
    where = f"{base_url} " if base_url else ""
    call_target = f" {base_url}" if base_url else "模型服务"

    if kind == ERR_CONFIG:
        missing = "接口地址" if not base_url else ("模型名" if not model else "API Key")
        return f"还没有配置{missing}。请先在设置页把它填好再重试。"

    if kind == ERR_NETWORK:
        # 容器里写 localhost 是最常见的一脚坑，单独给一句人话
        if host in ("localhost", "127.0.0.1", "0.0.0.0"):
            return (
                f"{unreachable}（连接被拒绝或超时）。后端跑在容器里，"
                f"容器内的 {host} 是容器自己，不是你的电脑；"
                f"本地模型请改成 host.docker.internal 加端口。"
            )
        return (
            f"{unreachable}（DNS 解析失败、连接被拒绝或超时）。"
            "请确认服务已启动、地址端口正确、网络可达。"
        )

    if kind == ERR_AUTH:
        return (
            f"鉴权失败（HTTP {status}）：API Key 不正确、已过期或没有该模型的权限。"
            "请到服务商后台确认后重新填写。"
        )

    if kind == ERR_NOT_FOUND:
        path = urlparse(base_url or "").path.rstrip("/")
        hint = "接口地址看起来少了 /v1" if not path.endswith("/v1") else "该服务可能不提供这个路径"
        tail = (
            f"可先在浏览器里打开 {base_url}/models 看看有没有返回。"
            if base_url
            else "可对照服务商文档确认 /models 路径。"
        )
        return f"接口不存在（HTTP 404）：{where}返回 404，{hint}。{tail}"

    if kind == ERR_RATE_LIMIT:
        return f"请求过于频繁（HTTP 429）：{where}限流了，已自动等待重试仍未恢复，稍后再试或换另一套模型。"

    if kind == ERR_QUOTA:
        status_text = f"（HTTP {status}）" if status is not None else ""
        return (
            f"账户额度不足{status_text}：{where}提示余额或配额已用尽，"
            "重试不会恢复，请充值或换一个 API Key。"
        )

    if kind == ERR_UPSTREAM:
        return f"上游服务出错（HTTP {status}）：{where}暂时不可用，稍后重试或换另一套模型。"

    if kind == ERR_BAD_RESPONSE:
        detail = " ".join((str(exc) or "").split())[:120]
        if status is not None:
            return f"服务返回了 HTTP {status}，但内容不是预期格式：{detail}"
        return f"返回内容不是 OpenAI 兼容格式：{detail}"

    detail = " ".join((str(exc) or "").split())[:120] or type(exc).__name__
    return f"调用{call_target}失败：{detail}"


# ── provider 级限流 ──


class ProviderThrottle:
    """同一个 provider 的请求节流 + 失败冷却。

    - `serialize=True`：整段调用串行。本地 LM Studio 一次只能跑一个模型，
      并发打进去只会互相拖慢甚至 OOM。
    - `min_interval_s`：两次调用之间的最小间隔，避免连续撞墙。
    - `block_for()`：撞到 429/5xx 后按 Retry-After 或退避时间整体冷却，
      后面排队的请求不用再白撞一次。
    """

    def __init__(self, *, min_interval_s: float = 0.0, serialize: bool = False) -> None:
        self._min_interval = max(0.0, float(min_interval_s))
        self._reserve_lock = threading.Lock()
        self._serialize = serialize
        self._serial_lock = threading.Lock() if serialize else None
        self._last_started = 0.0
        self._cooldown_until = 0.0
        self._max_sleep_s = 10.0

    def block_for(self, seconds: float) -> None:
        if seconds <= 0:
            return
        deadline = time.monotonic() + min(float(seconds), self._max_sleep_s)
        with self._reserve_lock:
            self._cooldown_until = max(self._cooldown_until, deadline)

    @contextmanager
    def slot(self):
        if self._serial_lock is not None:
            self._serial_lock.acquire()
        try:
            with self._reserve_lock:
                now = time.monotonic()
                wait = max(
                    self._min_interval - (now - self._last_started),
                    self._cooldown_until - now,
                )
                if wait > 0:
                    logger.debug("LLM 节流等待 %.2fs", wait)
                    time.sleep(min(wait, self._max_sleep_s))
                self._last_started = time.monotonic()
            yield
        finally:
            if self._serial_lock is not None:
                self._serial_lock.release()


_THROTTLES: dict[str, ProviderThrottle] = {
    # 外部服务有配额：留一点最小间隔，撞 429 后整体冷却
    "external": ProviderThrottle(min_interval_s=0.3),
    # 本地是单模型进程：串行，避免并发把显存/内存打爆
    "local": ProviderThrottle(min_interval_s=0.0, serialize=True),
}


def provider_throttle(provider: Provider | str) -> ProviderThrottle:
    return _THROTTLES.get(str(provider), _THROTTLES["external"])


@contextmanager
def provider_slot(provider: Provider | str):
    """在某个 provider 上占一个执行位（含节流与冷却）。"""
    with provider_throttle(provider).slot():
        yield


def _retry_after_of(exc: BaseException) -> float | None:
    """拿上游建议的等待秒数：优先 Retry-After 头，其次是文案里的 'try again in 20s'。

    429 的等待时间经常只写在响应体里（OpenAI 兼容服务尤其如此），
    只读 header 会一直按 1/2/4 秒退避，白撞好几轮。
    """
    headers = getattr(getattr(exc, "response", None), "headers", None) or {}
    try:
        value = headers.get("Retry-After") if hasattr(headers, "get") else None
        if value is not None:
            return float(value)
    except (TypeError, ValueError):
        pass

    match = re.search(
        r"(?:try again|retry)\s+in\s+(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)",
        str(exc) or "",
        re.IGNORECASE,
    )
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            return None
    return None


def _log_llm_call(
    *,
    provider: str,
    model: str,
    attempt: int,
    elapsed_ms: int,
    ok: bool,
    kind: str = "",
    retry: bool = False,
    delay_s: float = 0.0,
) -> None:
    """结构化日志：不含 prompt、不含 key，只留排查需要的字段。"""
    fields = {
        "llm_provider": provider,
        "llm_model": model,
        "llm_attempt": attempt,
        "llm_ms": elapsed_ms,
        "llm_ok": ok,
    }
    if kind:
        fields["llm_error_kind"] = kind
    if not ok:
        fields["llm_retry"] = retry
        if delay_s:
            fields["llm_delay_s"] = round(delay_s, 2)
    if ok:
        logger.info("LLM 调用成功", extra={"extra_fields": fields})
    else:
        logger.warning("LLM 调用失败", extra={"extra_fields": fields})


def _call_one(
    fn: Callable[[], T],
    *,
    provider: Provider | str,
    model: str = "",
    max_attempts: int = 3,
    base_delay_s: float = 1.0,
    max_delay_s: float = 8.0,
    budget_s: float | None = None,
) -> tuple[T, int]:
    """在同一个 provider 上执行 fn，可重试错误指数退避重试。

    返回 (结果, 实际尝试次数)。异常原样抛给上层，由上层决定换不换 provider。
    - 429 / 5xx / 连接超时：1s、2s、4s… 最多 `max_attempts` 次
    - 429 单独处理：至少等 5s，优先听 Retry-After，封顶 30s
    - 401 / 403 / 404：不重试（key 错、路径错，重试一百次也一样）
    - 402 / insufficient_quota：不重试（没钱，等多久都不会好）
    - `budget_s`：从第一次尝试起的总时间预算，超了就不再重试（HTTP 请求
      不能被一次扫描拖到前端超时）
    """
    attempts = max(1, int(max_attempts))
    started = time.monotonic()
    last_exc: BaseException | None = None

    for attempt in range(1, attempts + 1):
        attempt_started = time.monotonic()
        try:
            with provider_slot(provider):
                value = fn()
            _log_llm_call(
                provider=str(provider),
                model=model,
                attempt=attempt,
                elapsed_ms=int((time.monotonic() - attempt_started) * 1000),
                ok=True,
            )
            return value, attempt
        except Exception as exc:  # noqa: BLE001 —— 要按类型分类，不能只接一类
            last_exc = exc
            kind = classify_llm_error(exc)
            elapsed_ms = int((time.monotonic() - attempt_started) * 1000)
            exponential = min(base_delay_s * (2 ** (attempt - 1)), max_delay_s)
            retry_after = _retry_after_of(exc)
            if kind == ERR_RATE_LIMIT:
                # 限流是「等一会儿就好」的错，别用 1/2/4 秒的短退避白撞。
                # 至少 5s，尊重上游 Retry-After，但封顶 30s。
                delay = min(max(5.0, retry_after or 0.0, exponential), RATE_LIMIT_MAX_WAIT_S)
            else:
                # 上游给了 Retry-After 就听它的（429 常带），但仍受 max_delay_s 约束
                delay = min(retry_after, max_delay_s) if retry_after else exponential

            retry = (
                kind in RETRYABLE_KINDS
                and attempt < attempts
                and (budget_s is None or (time.monotonic() - started) + delay < budget_s)
            )
            _log_llm_call(
                provider=str(provider),
                model=model,
                attempt=attempt,
                elapsed_ms=elapsed_ms,
                ok=False,
                kind=kind,
                retry=retry,
                delay_s=delay if retry else 0.0,
            )
            if not retry:
                # 把已经试了几次挂在异常上：上层统计 CallMeta.attempts 要用，
                # 否则降级成功时会漏掉失败通道花掉的那几次。
                try:
                    setattr(exc, "llm_attempts", attempt)
                except (AttributeError, TypeError):
                    pass
                raise
            if kind in (ERR_RATE_LIMIT, ERR_UPSTREAM):
                # 限流/上游故障是「整个 provider 现在不行」，让所有请求一起冷却，
                # 下次进 slot() 再等，别在这里堆一层重复的 sleep。
                provider_throttle(provider).block_for(delay)
            else:
                # 网络类可能只是这一条请求运气不好，只退避本次
                time.sleep(delay)

    assert last_exc is not None  # 只有 attempts<=0 才会走到这里
    raise last_exc


def call_with_retry(
    fn: Callable[[], T],
    *,
    provider: Provider | str,
    model: str = "",
    max_attempts: int = 3,
    base_delay_s: float = 1.0,
    max_delay_s: float = 8.0,
    budget_s: float | None = None,
) -> T:
    """`_call_one` 的薄封装：只要结果，不要尝试次数。"""
    value, _ = _call_one(
        fn,
        provider=provider,
        model=model,
        max_attempts=max_attempts,
        base_delay_s=base_delay_s,
        max_delay_s=max_delay_s,
        budget_s=budget_s,
    )
    return value


@dataclass(frozen=True)
class CallMeta:
    """一次（可能发生降级的）LLM 调用的元数据。

    给上层写 job.message / summary_error / SSE done 事件用：有没有降级、
    最后用的是哪家、试了几次、花了多久、主通道错在哪。
    """

    provider: str = ""
    degraded: bool = False
    degraded_from: str = ""
    attempts: int = 0
    elapsed_ms: int = 0
    last_error: str = ""
    errors: tuple[str, ...] = ()

    def note(self) -> str:
        """「已从 external 降级到 local（原因）」——直接可写进 job.message。"""
        if not self.degraded:
            return ""
        detail = self.last_error or (self.errors[0] if self.errors else "")
        return f"已从 {self.degraded_from} 降级到 {self.provider}" + (f"（{detail}）" if detail else "")


def _ordered_attempts(
    policy: str | None,
    attempts: "Mapping[str, Callable[[], T]] | Iterable[tuple[str, Callable[[], T]]]",
) -> list[tuple[str, Callable[[], T]]]:
    """决定尝试顺序。

    传 dict 时按 `llm_usage_policy` 排序（external_first → external 先试），
    传 list 时尊重调用方给的顺序（调用方可能已经按 policy 排好了）。
    """
    if isinstance(attempts, Mapping):
        preferred = fallback_order(policy)
        ordered = [(name, attempts[name]) for name in preferred if name in attempts]
        ordered += [(name, fn) for name, fn in attempts.items() if name not in preferred]
        return ordered
    return list(attempts)


def call_with_fallback(
    policy: str | None,
    attempts: "Mapping[str, Callable[[], T]] | Iterable[tuple[str, Callable[[], T]]]",
    *,
    retries_per_provider: int = 3,
    base_delay_s: float = 1.0,
    budget_s: float | None = None,
    model: str = "",
) -> tuple[T, CallMeta]:
    """按兜底方案依次尝试多个 provider，返回 `(结果, CallMeta)`。

    每个 provider 内部先走退避重试：429/5xx/超时会重试，
    401/403/404 立刻放弃换下一个。全部失败时抛出最后一次异常
    （调用方按原有失败路径处理，异常里已经是可读原因）。

    用法（ai_jobs._step_summarize）::

        summary, meta = call_with_fallback(
            _llm_usage_policy(),
            {"local": summarize_with_local, "external": summarize_with_external},
        )
        if meta.degraded:
            job.message = meta.note()
    """
    ordered = _ordered_attempts(policy, attempts)
    if not ordered:
        raise ValueError("call_with_fallback 至少需要一个 provider")

    errors: list[str] = []
    primary = ordered[0][0]
    last_exc: BaseException | None = None
    total_attempts = 0
    started = time.monotonic()

    for label, runner in ordered:
        try:
            value, used = _call_one(
                runner,
                provider=label,
                model=model,
                max_attempts=retries_per_provider,
                base_delay_s=base_delay_s,
                budget_s=budget_s,
            )
            total_attempts += used
            meta = CallMeta(
                provider=label,
                degraded=label != primary,
                degraded_from="" if label == primary else primary,
                attempts=total_attempts,
                elapsed_ms=int((time.monotonic() - started) * 1000),
                last_error=errors[0] if errors else "",
                errors=tuple(errors),
            )
            if meta.degraded:
                logger.warning(
                    "LLM 已降级: %s", meta.note(),
                    extra={"extra_fields": {
                        "llm_provider": label,
                        "llm_degraded_from": primary,
                        "llm_ms": meta.elapsed_ms,
                    }},
                )
            return value, meta
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            total_attempts += int(getattr(exc, "llm_attempts", 1) or 1)
            errors.append(f"{label}: {describe_llm_error(exc, provider=label)}")
            logger.warning(
                "LLM 通道不可用，准备切换: %s",
                label,
                extra={"extra_fields": {"llm_provider": label, "llm_error_kind": classify_llm_error(exc)}},
            )

    assert last_exc is not None
    raise last_exc


# ── 配置与模型构建 ──


@dataclass(frozen=True)
class LLMConfig:
    provider: Provider
    model: str
    base_url: str
    api_key: str
    temperature: float
    timeout_s: int
    thinking: bool


def runtime_settings() -> dict:
    """读数据库里的助手运行时设置（设置页保存的那一份）。

    读失败就返回空字典，调用方回落到环境变量 —— 设置表坏了不该让对话全挂。
    """
    try:
        from app.services.admin_settings import load_assistant_runtime_settings

        return load_assistant_runtime_settings()
    except Exception:  # noqa: BLE001 —— 数据库不可用时宁可降级也不抛
        logger.warning("读取助手运行时设置失败，回退到环境变量", exc_info=True)
        return {}


def current_policy() -> str:
    policy = (
        runtime_settings().get("llm_usage_policy")
        or settings.llm_usage_policy
        or "external_first"
    )
    policy = str(policy).lower()
    return policy if policy in {"local_first", "external_first", "local_only", "external_only"} else "external_first"


def resolve_config(provider: Provider | None = None, temperature: float = 0.2) -> LLMConfig:
    """解析某个 provider 的配置。数据库优先，环境变量兜底。"""
    runtime = runtime_settings()
    policy = current_policy()
    if provider is None:
        provider = "external" if policy in ("external_first", "external_only") else "local"

    if provider == "external":
        return LLMConfig(
            provider="external",
            model=runtime.get("external_model") or settings.external_llm_model,
            base_url=runtime.get("external_base_url") or settings.external_llm_base_url,
            api_key=runtime.get("external_api_key") or settings.external_llm_api_key,
            temperature=temperature,
            timeout_s=settings.external_llm_timeout_s,
            thinking=settings.external_llm_thinking,
        )
    return LLMConfig(
        provider="local",
        model=runtime.get("local_model") or settings.openai_model,
        base_url=runtime.get("local_base_url") or settings.openai_base_url,
        api_key=runtime.get("local_api_key") or settings.openai_api_key,
        temperature=temperature,
        timeout_s=180,
        thinking=False,
    )


def fallback_order(policy: str | None = None) -> list[Provider]:
    """按兜底方案算出尝试顺序。"""
    resolved = (policy or current_policy()).lower()
    if resolved == "local_only":
        return ["local"]
    if resolved == "external_only":
        return ["external"]
    if resolved == "local_first":
        return ["local", "external"]
    return ["external", "local"]


def build_chat_model(
    provider: Provider | None = None,
    *,
    temperature: float = 0.2,
    max_tokens: int | None = None,
    streaming: bool = False,
    timeout_s: int | None = None,
) -> ChatOpenAI:
    """构造 ChatOpenAI。external 通道强制关闭思考链以换取响应速度。"""
    config = resolve_config(provider, temperature)

    kwargs: dict = {
        "model": config.model,
        "base_url": config.base_url,
        "api_key": config.api_key,
        "temperature": config.temperature,
        "timeout": timeout_s or config.timeout_s,
        "max_retries": 2,
        "streaming": streaming,
    }
    if max_tokens:
        kwargs["max_tokens"] = max_tokens

    if config.provider == "external" and not config.thinking:
        # deepseek 系列的非标参数，必须走 extra_body 才会透传到服务端
        kwargs["extra_body"] = {"chat_template_kwargs": {"thinking": False}}

    logger.debug("构建 LLM: provider=%s model=%s", config.provider, config.model)
    return ChatOpenAI(**kwargs)


def llm_health() -> dict:
    """轻量探活：只验证配置完整性与端点可达，不消耗额度。"""
    config = resolve_config("external")
    result = {
        "provider": config.provider,
        "model": config.model,
        "base_url": config.base_url,
        "thinking": config.thinking,
        "configured": bool(config.api_key and config.base_url and config.model),
        "policy": current_policy(),
    }
    return result
