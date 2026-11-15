"""基于 Redis 的限流。

设计取舍
--------
用固定窗口计数（INCR + EXPIRE）而不是令牌桶：实现简单、一条命令原子完成，
对本场景（防暴力破解、防误点连发）精度足够。

Redis 不可用时**放行**并打告警。限流是保护措施，不是业务前置条件；
因为 Redis 抖动就让所有人登不上，是更严重的故障。
"""

from __future__ import annotations

import logging
import time

from app.services.rq_client import get_redis_connection

logger = logging.getLogger(__name__)


class RateLimiter:
    def __init__(self, prefix: str, limit: int, window_sec: int):
        self.prefix = prefix
        self.limit = limit
        self.window_sec = window_sec

    def _key(self, identity: str) -> str:
        window = int(time.time()) // self.window_sec
        return f"rl:{self.prefix}:{identity}:{window}"

    def hit(self, identity: str, cost: int = 1) -> tuple[bool, int]:
        """记一次。返回 (是否允许, 剩余次数)。"""
        identity = (identity or "anonymous")[:120]
        key = self._key(identity)
        try:
            conn = get_redis_connection()
            pipe = conn.pipeline()
            pipe.incrby(key, cost)
            pipe.expire(key, self.window_sec + 5)
            used = int(pipe.execute()[0])
        except Exception as exc:  # Redis 挂了不该阻断登录
            logger.warning("限流不可用，本次放行（%s）: %s", self.prefix, exc)
            return True, self.limit

        remaining = max(0, self.limit - used)
        return used <= self.limit, remaining

    def reset(self, identity: str) -> None:
        """成功后清空计数，避免正常用户被自己之前的失败次数拖累。"""
        identity = (identity or "anonymous")[:120]
        try:
            get_redis_connection().delete(self._key(identity))
        except Exception:
            pass


# 登录：同一 IP 15 分钟 30 次尝试（够用但挡住脚本）
login_ip_limiter = RateLimiter("login_ip", limit=30, window_sec=900)
# 同一账号 15 分钟 8 次，防止换 IP 撞库
login_user_limiter = RateLimiter("login_user", limit=8, window_sec=900)
# 注册：同一 IP 1 小时 5 个账号，防止批量灌号
register_limiter = RateLimiter("register_ip", limit=5, window_sec=3600)
# 重任务：同一用户 10 分钟 6 次规划，防止连点把 LLM 额度打爆
plan_limiter = RateLimiter("plan_user", limit=6, window_sec=600)
# 对话：同一用户 1 分钟 20 轮
chat_limiter = RateLimiter("chat_user", limit=20, window_sec=60)
