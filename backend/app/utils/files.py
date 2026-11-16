import logging
import re
import uuid
from datetime import datetime
from pathlib import Path

from app.database import settings

logger = logging.getLogger(__name__)


def safe_stem(value: str) -> str:
    text = re.sub(r"[^\w\-\u4e00-\u9fff]+", "-", value.strip())
    text = re.sub(r"-{2,}", "-", text)
    return text.strip("-_")


def unique_suffix() -> str:
    return datetime.now().strftime("%Y%m%d%H%M%S%f") + uuid.uuid4().hex[:8]


def _normalize(value: str) -> str:
    """统一成小写、正斜杠、无尾斜杠，便于跨平台比较。"""
    return value.replace("\\", "/").rstrip("/").lower()


def _mapping_pairs() -> list[tuple[str, str]]:
    """解析 PATH_MAP 配置，按源前缀长度降序（最长匹配优先）。

    格式：`D:/ITJC/thumbnails=/data/thumbnails;D:/ITJC=/videos`
    """
    raw = (getattr(settings, "path_map", "") or "").strip()
    if not raw:
        return []
    pairs: list[tuple[str, str]] = []
    for entry in raw.split(";"):
        entry = entry.strip()
        if not entry or "=" not in entry:
            continue
        src, dst = entry.split("=", 1)
        src, dst = src.strip(), dst.strip()
        if src and dst:
            pairs.append((src, dst))
    pairs.sort(key=lambda item: len(item[0]), reverse=True)
    return pairs


def resolve_media_path(raw_path: str | Path | None) -> Path:
    """把数据库里存的宿主机绝对路径解析成当前运行环境可用的路径。

    为什么要这层：数据库是容器化之前建的，`videos.filepath` 存的是
    `D:\\ITJC\\xxx\\yyy.mp4` 这种 Windows 绝对路径。容器里视频挂在
    `/videos`，直接拿原路径必然 FileNotFoundError。

    解析顺序：
    1. 原路径存在 → 直接用（本地 venv 跑法不受影响）
    2. 按 PATH_MAP 做前缀替换，命中就用映射后的路径
    3. 都不匹配 → 返回原路径，让调用方按「不存在」处理
    """
    if raw_path is None:
        return Path("")

    path = Path(raw_path)
    try:
        if path.exists():
            return path
    except OSError:
        # 路径含非法字符（如 Windows 盘符在 Linux 下）时 stat 会抛错
        pass

    normalized = _normalize(str(raw_path))
    for src, dst in _mapping_pairs():
        src_norm = _normalize(src)
        if not normalized.startswith(src_norm):
            continue
        suffix = str(raw_path).replace("\\", "/")[len(src_norm):].lstrip("/")
        mapped = Path(dst) / suffix if suffix else Path(dst)
        if mapped.exists():
            return mapped
        # 映射到了但文件确实不在，如实返回该路径，便于日志定位
        logger.debug("路径映射命中但文件不存在: %s -> %s", raw_path, mapped)
        return mapped

    return path
