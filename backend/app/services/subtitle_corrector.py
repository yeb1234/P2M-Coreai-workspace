from __future__ import annotations

import json
from typing import Any

from app.services.llm_client import OpenAICompatibleClient


SYSTEM_PROMPT = (
    "/no_thinking\n"
    "你是字幕校对助手。只修正每条字幕 text 中明显的语音识别错误、错别字、专有名词和大小写。\n"
    "不要总结，不要扩写，不要翻译，不要合并或拆分字幕，不要改时间。\n"
    "不要输出思考过程、解释、Markdown 或代码块。只返回严格 JSON 数组，格式为 "
    "[{\"index\": 0, \"text\": \"修正后的字幕\"}]。"
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


def _build_user_prompt(batch: list[dict], extra_prompt: str | None = None) -> str:
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
        "/no_thinking\n"
        "请根据上下文校对下面字幕。保留 index，不返回 start/end，只返回 JSON 数组。\n"
        + (f"额外校对要求：{extra_prompt.strip()}\n" if extra_prompt and extra_prompt.strip() else "")
        + "字幕逐行如下：\n"
        + "\n".join(lines)
    )


def _select_segments_for_scope(segments: list[dict], scope: str) -> list[dict]:
    if scope == "off":
        return []
    return [{**segment, "index": index} for index, segment in enumerate(segments)]


def _chunk_indexed_segments(indexed_segments: list[dict], batch_size: int) -> list[list[dict]]:
    size = max(1, batch_size)
    return [indexed_segments[index : index + size] for index in range(0, len(indexed_segments), size)]


def correct_segments_with_openai(
    segments: list[dict],
    *,
    model: str,
    base_url: str = "http://localhost:1234/v1",
    api_key: str = "lm-studio",
    batch_size: int = 60,
    timeout_s: int = 180,
    extra_prompt: str | None = None,
    scope: str = "full",
) -> list[dict]:
    if not segments:
        return segments

    corrected = [{**segment} for segment in segments]
    selected = _select_segments_for_scope(corrected, scope)
    if not selected:
        return corrected

    client = OpenAICompatibleClient(base_url=base_url, api_key=api_key, timeout_s=timeout_s)

    for batch in _chunk_indexed_segments(selected, batch_size):
        content = client.chat_completion(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": _build_user_prompt(batch, extra_prompt=extra_prompt)},
            ],
            temperature=0.1,
            max_tokens=4096,
        )

        for item in _extract_json_array(content):
            if not isinstance(item, dict):
                continue
            index = item.get("index")
            text = item.get("text")
            if isinstance(index, int) and 0 <= index < len(corrected) and isinstance(text, str) and text.strip():
                corrected[index]["text"] = text.strip()

    return corrected
