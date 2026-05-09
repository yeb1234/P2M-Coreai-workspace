import re
from datetime import datetime
from pathlib import Path


def safe_stem(value: str) -> str:
    text = re.sub(r"[^\w\-\u4e00-\u9fff]+", "-", value.strip())
    text = re.sub(r"-{2,}", "-", text)
    return text.strip("-_")


def unique_suffix() -> str:
    return datetime.now().strftime("%Y%m%d%H%M%S%f")


def ensure_parent(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    return path
