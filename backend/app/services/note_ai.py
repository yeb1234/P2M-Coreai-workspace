"""笔记 AI：总结、润色、动作抽取。

这一层只吃「标题 + Markdown 正文」，不直接读 IndexedDB，也不直接改数据库。
笔记的本地存储归属仍在前端；后端只负责模型调用、结果清洗和结构化。
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date
from typing import Any

from app.services.llm import build_chat_model, fallback_order, resolve_config

logger = logging.getLogger(__name__)

MAX_NOTE_CHARS = 60_000
MAX_PROMPT_CHARS = 24_000


class NoteAIError(RuntimeError):
    """可以安全展示给用户的 AI 失败。"""


_SUMMARY_PROMPT = """你是学习笔记编辑，不是聊天助手。

任务：把下面这篇笔记压缩成可复习的摘要，保留结论、关键步骤、容易踩坑的点。
输出要求：
- 只输出 Markdown，不要任何解释、前言或结尾寒暄。
- 3 到 6 条要点，每条一行，以「- 」开头。
- 最后单独一行，以「下一步：」开头，给一个能从这篇笔记直接开始做的动作。
- 不要复述原文，不要编造笔记里没有的事实。

【笔记标题】
{title}

【笔记正文】
{body}
"""

_POLISH_PROMPT = """你是中文技术笔记编辑。请重写下面的 Markdown 笔记，让它更清楚、更紧凑、更适合日后复习。

硬性要求：
- 保留原文的事实、专有名词、代码块、链接和 Markdown 结构。
- 不新增原文没有的事实，不删掉关键步骤。
- 直接输出完整的 Markdown 正文，不要输出解释、对比、前后缀或代码围栏。
- 如果原文本身很短，只做必要的语句整理，不要扩写成文章。
{instruction}

【笔记标题】
{title}

【笔记正文】
{body}
"""

_ACTION_PROMPT = """你是任务抽取器。从笔记正文中找出「用户明确承诺、计划要做」的事项，以及「明确的时间安排」。

今天日期：{today}
时区：Asia/Shanghai

只输出一个 JSON 对象，不要 Markdown，不要解释。结构必须是：
{{
  "todos": [
    {{
      "title": "待办标题，动词开头，最多 60 字",
      "description": "补充信息，可为空字符串",
      "due_date": "YYYY-MM-DD 或 null",
      "priority": "high | medium | low | green"
    }}
  ],
  "events": [
    {{
      "title": "日程标题",
      "date": "YYYY-MM-DD 或 null",
      "start_time": "HH:MM 或 null",
      "end_time": "HH:MM 或 null",
      "description": "补充信息，可为空字符串"
    }}
  ]
}}

抽取规则：
- 只抽取明确的行动和日程；普通知识点、观点、愿望不要变成待办。
- 没有明确日期就填 null，不要把「以后」「有空」猜成具体日期。
- events 只用于明确的会议、课程、约会、直播等有开始/结束含义的安排。
- 最多各 6 条；没有就返回空数组。
- 不要输出 JSON 之外的任何字符。

【笔记标题】
{title}

【笔记正文】
{body}
"""


def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        chunks: list[str] = []
        for item in content:
            if isinstance(item, str):
                chunks.append(item)
            elif isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    chunks.append(text)
        return "\n".join(chunks)
    return str(content or "")


def _strip_fence(text: str) -> str:
    cleaned = (text or "").strip()
    cleaned = re.sub(r"^```(?:markdown|md|json|text)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


def _clean_markdown(text: str) -> str:
    return _strip_fence(text).replace("\r\n", "\n").strip()


def _clip(value: Any, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", value).strip()[:limit]


def _iso_date(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return None
    try:
        date.fromisoformat(text)
    except ValueError:
        return None
    return text


def _clock(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not re.fullmatch(r"\d{2}:\d{2}", text):
        return None
    hour, minute = (int(part) for part in text.split(":"))
    if hour > 23 or minute > 59:
        return None
    return text


def _priority(value: Any) -> str:
    text = str(value or "").strip().lower()
    return text if text in {"high", "medium", "low", "green"} else "green"


def _as_dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _parse_action_payload(raw: str) -> dict[str, list[dict]]:
    """把模型输出解析成稳定的 todos/events。解析失败抛 ValueError。"""

    cleaned = _strip_fence(raw)
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("模型没有返回 JSON 对象")
    candidate = cleaned[start : end + 1]
    try:
        data = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise ValueError(f"JSON 解析失败: {exc}") from exc
    payload = _as_dict(data)

    todos: list[dict] = []
    for item in payload.get("todos") or []:
        if isinstance(item, str):
            item = {"title": item}
        item = _as_dict(item)
        title = _clip(item.get("title"), 80)
        if not title:
            continue
        todos.append(
            {
                "title": title,
                "description": _clip(item.get("description"), 500),
                "due_date": _iso_date(item.get("due_date")),
                "priority": _priority(item.get("priority")),
            }
        )

    events: list[dict] = []
    for item in payload.get("events") or []:
        item = _as_dict(item)
        title = _clip(item.get("title"), 80)
        if not title:
            continue
        events.append(
            {
                "title": title,
                "date": _iso_date(item.get("date")),
                "start_time": _clock(item.get("start_time")),
                "end_time": _clock(item.get("end_time")),
                "description": _clip(item.get("description"), 500),
            }
        )

    return {"todos": todos[:6], "events": events[:6]}


def _invoke_once(provider: str, prompt: str, *, temperature: float, max_tokens: int, timeout_s: int) -> tuple[str, str]:
    config = resolve_config(provider, temperature)  # type: ignore[arg-type]
    if not config.base_url or not config.api_key:
        raise NoteAIError(f"{provider} 通道没有配置")
    model = build_chat_model(provider, temperature=temperature, max_tokens=max_tokens, timeout_s=timeout_s)  # type: ignore[arg-type]
    message = model.invoke(prompt)
    text = _content_to_text(getattr(message, "content", ""))
    if not text.strip():
        raise NoteAIError(f"{provider} 通道返回空内容")
    return text.strip(), config.model


def _run(prompt: str, *, temperature: float, max_tokens: int, timeout_s: int = 45) -> tuple[str, str, str]:
    errors: list[str] = []
    for provider in fallback_order():
        try:
            text, model_name = _invoke_once(
                provider,
                prompt,
                temperature=temperature,
                max_tokens=max_tokens,
                timeout_s=timeout_s,
            )
            return text, provider, model_name
        except Exception as exc:  # noqa: BLE001 —— 单个 provider 失败要继续走兜底
            errors.append(f"{provider}: {exc}")
            logger.warning("笔记 AI 调用失败 provider=%s: %s", provider, exc)
    detail = "; ".join(errors)
    raise NoteAIError("AI 服务暂时不可用，请检查模型配置或稍后重试") from RuntimeError(detail)


def _validate_note(markdown: str) -> str:
    body = (markdown or "").strip()
    if not body:
        raise NoteAIError("这篇笔记还是空的，先写点内容再让 AI 处理")
    if len(body) > MAX_NOTE_CHARS:
        raise NoteAIError(f"笔记太长（超过 {MAX_NOTE_CHARS} 字符），请先精简再试")
    return body


def summarize_note(title: str, markdown: str) -> dict[str, str]:
    body = _validate_note(markdown)
    prompt = _SUMMARY_PROMPT.format(
        title=_clip(title, 120) or "无标题笔记",
        body=body[:MAX_PROMPT_CHARS],
    )
    text, provider, model = _run(prompt, temperature=0.2, max_tokens=900)
    summary = _clean_markdown(text)
    if len(summary) < 20:
        raise NoteAIError("AI 返回的摘要过短，请重试")
    return {"summary": summary, "provider": provider, "model": model}


def polish_note(title: str, markdown: str, instruction: str = "") -> dict[str, str]:
    body = _validate_note(markdown)
    extra = f"\n额外要求：{_clip(instruction, 300)}\n" if instruction.strip() else ""
    prompt = _POLISH_PROMPT.format(
        title=_clip(title, 120) or "无标题笔记",
        body=body[:MAX_PROMPT_CHARS],
        instruction=extra,
    )
    text, provider, model = _run(prompt, temperature=0.25, max_tokens=1400)
    polished = _clean_markdown(text)
    if len(polished) < 10:
        raise NoteAIError("AI 没有返回可用的润色内容，请重试")
    return {"markdown": polished, "provider": provider, "model": model}


def extract_note_actions(title: str, markdown: str) -> dict[str, Any]:
    body = _validate_note(markdown)
    prompt = _ACTION_PROMPT.format(
        today=date.today().isoformat(),
        title=_clip(title, 120) or "无标题笔记",
        body=body[:MAX_PROMPT_CHARS],
    )
    errors: list[str] = []
    for provider in fallback_order():
        try:
            text, model_name = _invoke_once(
                provider,
                prompt,
                temperature=0.0,
                max_tokens=900,
                timeout_s=45,
            )
            parsed = _parse_action_payload(text)
            return {
                "todos": parsed["todos"],
                "events": parsed["events"],
                "provider": provider,
                "model": model_name,
            }
        except ValueError as exc:
            errors.append(f"{provider}: {exc}")
            logger.warning("笔记动作 JSON 解析失败 provider=%s: %s", provider, exc)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{provider}: {exc}")
            logger.warning("笔记动作抽取失败 provider=%s: %s", provider, exc)
    raise NoteAIError("AI 没有返回可解析的待办/日历结构，请重试或把时间写得更明确") from RuntimeError(
        "; ".join(errors)
    )
