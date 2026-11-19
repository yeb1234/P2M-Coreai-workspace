"""运行时配置加载（configs/*.yaml）。

7.0 起检索、向量、LLM、数据库和工具治理参数都从代码常量迁到这里。
版本库发布后调用 reload_runtime_config() 清缓存，下一次检索/请求立即用新值。

这里只读非密钥参数；API Key、DSN 仍然只从环境变量 / AppSetting 读。
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

_BACKEND_DIR = Path(__file__).resolve().parents[2]


def configs_root() -> Path:
    explicit = os.environ.get("CONFIGS_DIR", "").strip()
    if explicit:
        return Path(explicit).expanduser().resolve()
    # 本地是 <repo>/backend/app/services → <repo>/configs；
    # 容器是 /app/app/services → /app/configs。两种布局都按存在性判断，
    # 不再用固定 parents[N] 猜仓库根。
    candidates = [
        _BACKEND_DIR / "configs",
        _BACKEND_DIR.parent / "configs",
        Path("/app/configs"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def _read_yaml(name: str) -> dict[str, Any]:
    path = configs_root() / name
    if not path.exists():
        logger.warning("配置文件不存在，使用内置默认值: %s", path)
        return {}
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if not isinstance(data, dict):
            raise ValueError(f"{name} 顶层必须是对象")
        return data
    except Exception as exc:  # noqa: BLE001
        # 配置坏了不能让检索/聊天整体挂掉，退回默认值并留下可检索的日志。
        logger.error("读取配置失败 %s: %s", path, exc)
        return {}


@lru_cache(maxsize=16)
def _cached_config(name: str) -> dict[str, Any]:
    return _read_yaml(name)


def get_config(name: str) -> dict[str, Any]:
    """读取指定配置文件；返回只读约定，调用方不要原地改动。"""
    return _cached_config(name)


def get_retrieval_config() -> dict[str, Any]:
    return get_config("retrieval.yaml")


def get_vector_config() -> dict[str, Any]:
    return get_config("vector.yaml")


def get_llm_config() -> dict[str, Any]:
    return get_config("llm.yaml")


def get_database_config() -> dict[str, Any]:
    return get_config("database.yaml")


def get_governance_config() -> dict[str, Any]:
    return get_config("governance.yaml")


def reload_runtime_config() -> None:
    """配置发布后调用；清掉所有文件的解析缓存。"""
    _cached_config.cache_clear()
    logger.info("运行时配置缓存已刷新: %s", configs_root())
