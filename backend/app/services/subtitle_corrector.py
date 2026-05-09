from __future__ import annotations

import json
from typing import Any

import requests


SYSTEM_PROMPT = (
    "你是字幕校对助手。只修正每条字幕 text 中明显的语音识别错误、错别字、技术术语和大小写。"
    "例如在 Git、GitHub、代码管理、提交、分支语境里，Gate 应修为 Git。"
    "不要总结，不要扩写，不要翻译，不要合并或拆分字幕，不要改时间。"
    "只返回严格 JSON 数组，格式为 [{\"index\": 0, \"text\": \"修正后的字幕\"}]。"
)


def _extract_json_array(content: str) -> list[Any]:
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`").strip()
        if text.lower().startswith("json"):
            text = text[4:].strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("[")
        end = text.rfind("]")
        if start < 0 or end <= start:
            raise
        data = json.loads(text[start : end + 1])

    if not isinstance(data, list):
        raise ValueError("字幕校对返回值不是数组")
    return data


def _build_user_prompt(batch: list[dict]) -> str:
    lines = []
    for item in batch:
        lines.append(
            json.dumps(
                {
                    "index": item["index"],
                    "start": item["start"],
                    "end": item["end"],
                    "text": item["text"],
                },
                ensure_ascii=False,
            )
        )
    return (
        "请根据上下文校对下面字幕。保留 index，不返回 start/end，只返回 JSON 数组。\n"
        "字幕逐行如下：\n"
        + "\n".join(lines)
    )


def _chunk_segments(segments: list[dict], batch_size: int) -> list[list[dict]]:
    size = max(1, batch_size)
    indexed = [{**segment, "index": index} for index, segment in enumerate(segments)]
    return [indexed[index : index + size] for index in range(0, len(indexed), size)]


def correct_segments_with_openai(
    segments: list[dict],
    *,
    model: str,
    base_url: str = "http://localhost:1234/v1",
    api_key: str = "lm-studio",
    batch_size: int = 60,
    timeout_s: int = 180,
) -> list[dict]:
    if not segments:
        return segments

    corrected = [{**segment} for segment in segments]
    url = base_url.rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}"}

    for batch in _chunk_segments(corrected, batch_size):
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": _build_user_prompt(batch)},
            ],
            "temperature": 0.1,
            "max_tokens": 4096,
        }
        response = requests.post(url, json=payload, headers=headers, timeout=timeout_s)
        if response.status_code != 200:
            raise RuntimeError(f"字幕校对 HTTP {response.status_code}: {response.text[:500]}")

        data = response.json()
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            raise RuntimeError(f"字幕校对返回格式异常: {json.dumps(data, ensure_ascii=False)[:500]}")

        for item in _extract_json_array(content):
            if not isinstance(item, dict):
                continue
            index = item.get("index")
            text = item.get("text")
            if isinstance(index, int) and 0 <= index < len(corrected) and isinstance(text, str) and text.strip():
                corrected[index]["text"] = text.strip()

    return corrected
