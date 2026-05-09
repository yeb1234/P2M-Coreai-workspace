import json
from pathlib import Path

from app.database import settings


def dump_segments(segments: list[dict]) -> str:
    return json.dumps(segments, ensure_ascii=False)


def load_segments(value: str | None) -> list[dict]:
    if not value:
        return []
    try:
        data = json.loads(value)
    except json.JSONDecodeError:
        return []
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    return []


def to_output_url(path_value: str | None) -> str | None:
    if not path_value:
        return None
    path = Path(path_value)
    output_root = Path(settings.output_dir).resolve()
    try:
        relative = path.resolve().relative_to(output_root)
    except ValueError:
        return None
    return "/output/" + str(relative).replace("\\", "/")
