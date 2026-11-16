"""按用户维度的每日配额。

为什么需要
----------
外部 LLM 按 token 计费。多用户场景下一个人连续提问就能把整月额度跑光，
而且从系统层面看不出来是谁干的 —— 账单只显示一个总额。

与限流的区别
------------
限流管「瞬时速率」（每秒/每分钟多少），防的是脚本和误点；
配额管「累计用量」（每天多少），防的是正常操作但量特别大。
两个都要有：只限流不限额，慢速刷也能跑光额度；只限额不限流，一口气打过来会拖垮服务。

为什么用 Redis 而不是数据库计数
------------------------------
- 高频读写，不值得每次开事务
- 天然按天过期，不需要清理任务
- 计数器丢了最多是当天配额重置，不影响业务正确性

失败策略：Redis 不可用时**放行**。配额是防滥用，不是业务前置条件；
因为 Redis 抖动让所有人都用不了 AI，比配额被绕过更糟。
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from app.database import settings
from app.services.rq_client import get_redis_connection

logger = logging.getLogger(__name__)


class DailyQuota:
    def __init__(self, name: str, limit: int):
        self.name = name
        self.limit = max(1, int(limit))

    # -- 内部 --

    def _key(self, user_id: int) -> str:
        # key 带日期，跨天自动换桶，不需要额外清理
        return f"quota:{self.name}:{user_id}:{datetime.now():%Y%m%d}"

    @staticmethod
    def _ttl_seconds() -> int:
        now = datetime.now()
        tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        return max(60, int((tomorrow - now).total_seconds()))

    # -- 对外 --

    def consume(self, user_id: int, cost: int = 1) -> tuple[bool, int, int]:
        """扣一次配额。返回 (是否允许, 已用, 上限)。

        超限时要回滚：否则计数器会一直涨，管理员事后看到的用量是虚高的。
        """
        key = self._key(user_id)
        try:
            conn = get_redis_connection()
            pipe = conn.pipeline()
            pipe.incrby(key, cost)
            pipe.expire(key, self._ttl_seconds())
            used = int(pipe.execute()[0])
        except Exception as exc:
            logger.warning("配额扣减失败，按放行处理（%s）: %s", self.name, exc)
            return True, 0, self.limit

        if used > self.limit:
            try:
                conn.decrby(key, cost)
            except Exception:
                pass
            return False, used - cost, self.limit
        return True, used, self.limit

    def refund(self, user_id: int, cost: int = 1) -> None:
        """任务失败时退还配额，避免因为服务端问题扣用户的量。

        **目前没有任何调用方，但不要删。**

        routers/learning.py 的 consume 发生在「去重命中」「并发上限 429」
        「生成失败」三条路径之前，这三种情况都会白扣一次额度。
        修那个 bug 时需要这个方法，删了还得照原样写回来。
        """
        try:
            get_redis_connection().decrby(self._key(user_id), cost)
        except Exception:
            pass


def _admin_multiplier(role: str | None) -> int:
    """管理员给更高配额：要能压测和排查，但也不是无限。"""
    return max(1, int(settings.quota_admin_multiplier)) if (role or "") == "admin" else 1


def chat_quota_for(role: str | None) -> DailyQuota:
    return DailyQuota("chat", settings.quota_chat_daily * _admin_multiplier(role))


def plan_quota_for(role: str | None) -> DailyQuota:
    return DailyQuota("plan", settings.quota_plan_daily * _admin_multiplier(role))


def quota_exceeded_detail(used: int, limit: int, what: str) -> str:
    return (
        f"今天的{what}额度用完了（{used}/{limit}）。"
        "配额每天 0 点重置；如果是团队账号需要更高额度，让管理员调 QUOTA_* 配置。"
    )
