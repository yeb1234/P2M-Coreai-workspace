"""工具级指标与熔断器。

这里只做进程内、低开销的治理数据，不把 Prometheus/Redis 引进来：
- 每个工具的请求数、执行数、成功/失败、超时、重试、预算拒绝、熔断拒绝；
- 最近 512 次执行延迟，用于 p50/p95/p99；
- 连续失败达到阈值后临时打开熔断，冷却后放一个探测请求。

进程重启会清零。要跨进程长期看，落日志后用 Loki/ELK 聚合；当前管理面
先解决「这一轮到底哪个工具在拖后腿、有没有被打爆」。
"""

from __future__ import annotations

import math
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


_MAX_LATENCY_SAMPLES = 512


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(len(ordered) * p / 100) - 1))
    return round(ordered[index], 1)


@dataclass
class _MetricData:
    requests: int = 0
    calls: int = 0
    successes: int = 0
    failures: int = 0
    timeouts: int = 0
    retries: int = 0
    retry_successes: int = 0
    budget_rejections: int = 0
    circuit_open_rejections: int = 0
    latencies_ms: deque[float] = field(default_factory=lambda: deque(maxlen=_MAX_LATENCY_SAMPLES))
    last_error: str | None = None
    last_called_at: str | None = None


class ToolMetrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._data: dict[str, _MetricData] = {}

    def _get(self, name: str) -> _MetricData:
        return self._data.setdefault(name, _MetricData())

    def record_request(self, name: str) -> None:
        with self._lock:
            self._get(name).requests += 1

    def record_call(self, name: str) -> None:
        with self._lock:
            self._get(name).calls += 1

    def record_success(self, name: str, ms: float, attempts: int) -> None:
        with self._lock:
            data = self._get(name)
            data.successes += 1
            data.latencies_ms.append(round(ms, 1))
            data.last_called_at = _now_iso()
            if attempts > 1:
                data.retry_successes += 1

    def record_failure(
        self,
        name: str,
        ms: float,
        error_kind: str,
        error: str | None = None,
        *,
        timeout: bool = False,
    ) -> None:
        with self._lock:
            data = self._get(name)
            data.failures += 1
            if timeout:
                data.timeouts += 1
            data.latencies_ms.append(round(ms, 1))
            data.last_called_at = _now_iso()
            data.last_error = f"{error_kind}: {error}"[:220] if error else error_kind

    def record_retry(self, name: str) -> None:
        with self._lock:
            self._get(name).retries += 1

    def record_budget_rejection(self, name: str) -> None:
        with self._lock:
            self._get(name).budget_rejections += 1

    def record_circuit_open(self, name: str) -> None:
        with self._lock:
            self._get(name).circuit_open_rejections += 1

    def snapshot(self, name: str) -> dict[str, Any]:
        with self._lock:
            data = self._data.get(name)
            if data is None:
                return {
                    "requests": 0,
                    "calls": 0,
                    "successes": 0,
                    "failures": 0,
                    "timeouts": 0,
                    "retries": 0,
                    "retry_successes": 0,
                    "budget_rejections": 0,
                    "circuit_open_rejections": 0,
                    "latency_ms": {"p50": None, "p95": None, "p99": None, "avg": None},
                    "timeout_rate": 0.0,
                    "retry_success_rate": None,
                    "last_error": None,
                    "last_called_at": None,
                }
            latencies = list(data.latencies_ms)
            calls = data.calls
            return {
                "requests": data.requests,
                "calls": calls,
                "successes": data.successes,
                "failures": data.failures,
                "timeouts": data.timeouts,
                "retries": data.retries,
                "retry_successes": data.retry_successes,
                "budget_rejections": data.budget_rejections,
                "circuit_open_rejections": data.circuit_open_rejections,
                "latency_ms": {
                    "p50": _percentile(latencies, 50),
                    "p95": _percentile(latencies, 95),
                    "p99": _percentile(latencies, 99),
                    "avg": round(sum(latencies) / len(latencies), 1) if latencies else None,
                },
                "timeout_rate": round(data.timeouts / calls, 4) if calls else 0.0,
                "retry_success_rate": (
                    round(data.retry_successes / data.retries, 4) if data.retries else None
                ),
                "last_error": data.last_error,
                "last_called_at": data.last_called_at,
            }

    def all_snapshots(self) -> dict[str, dict[str, Any]]:
        with self._lock:
            names = list(self._data)
        return {name: self.snapshot(name) for name in names}

    def reset(self) -> None:
        with self._lock:
            self._data.clear()


@dataclass
class _BreakerState:
    failures: int = 0
    open_until: float = 0.0
    probing: bool = False


class CircuitBreaker:
    """连续失败达到阈值后熔断；冷却后只放一个探测请求。"""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._states: dict[str, _BreakerState] = {}

    def _state(self, name: str) -> _BreakerState:
        return self._states.setdefault(name, _BreakerState())

    def allow(self, name: str, threshold: int, cooldown_s: float, *, now: float | None = None) -> bool:
        if threshold <= 0 or cooldown_s <= 0:
            return True
        current = time.monotonic() if now is None else now
        with self._lock:
            state = self._state(name)
            if state.open_until <= 0:
                return True
            if current < state.open_until:
                return False
            # 冷却结束：放一个探测请求，成功则关闭，失败则重新打开。
            state.open_until = 0.0
            state.probing = True
            return True

    def record_success(self, name: str) -> None:
        with self._lock:
            state = self._state(name)
            state.failures = 0
            state.open_until = 0.0
            state.probing = False

    def record_failure(
        self,
        name: str,
        threshold: int,
        cooldown_s: float,
        *,
        now: float | None = None,
    ) -> None:
        if threshold <= 0 or cooldown_s <= 0:
            return
        current = time.monotonic() if now is None else now
        with self._lock:
            state = self._state(name)
            state.probing = False
            state.failures += 1
            if state.failures >= threshold:
                state.open_until = current + cooldown_s
                state.failures = 0

    def status(
        self,
        name: str,
        threshold: int,
        cooldown_s: float,
        *,
        now: float | None = None,
    ) -> dict[str, Any]:
        current = time.monotonic() if now is None else now
        with self._lock:
            state = self._state(name)
            open_until = state.open_until
            return {
                "threshold": threshold,
                "cooldown_s": cooldown_s,
                "open": bool(open_until and current < open_until),
                "probing": state.probing,
                "consecutive_failures": state.failures,
                "retry_after_s": round(max(0.0, open_until - current), 1) if open_until else 0.0,
            }

    def reset(self) -> None:
        with self._lock:
            self._states.clear()


METRICS = ToolMetrics()
BREAKER = CircuitBreaker()
