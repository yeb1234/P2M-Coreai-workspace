"""Redis key 命名空间。

多项目共享同一个 Redis 实例时，DB 编号只是逻辑隔离，不提供资源或权限隔离。
所有 P2 业务 key 必须统一加 `settings.redis_key_prefix`，默认 `p2:`；
P2 Lite 在共享 Redis 上使用 DB 1 + `p2:` 前缀，避免和 P1/P3/P4 串 key。
"""

from __future__ import annotations

from app.database import settings


def p2_key(name: str) -> str:
    """给业务 key 加 P2 命名空间；传入的 name 不应再自带 p2: 前缀。"""
    prefix = settings.redis_key_prefix or "p2:"
    return f"{prefix}{name.lstrip(':')}"
