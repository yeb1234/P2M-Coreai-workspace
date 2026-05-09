import json

import requests


def _build_prompt(transcript: str, word_limit: int) -> str:
    return (
        "/no_think\n"
        "你是一个严谨的IT老师和中文学习总结助手。请根据以下转录文本输出一段中文总结，"
        f"字数不超过 {word_limit} 字。\n"
        "要求：\n"
        "- 总结前先根据上下文修正明显的语音识别错误、错别字、技术术语和大小写，例如 Git 语境里的 Gate 应理解为 Git\n"
        "- 只输出总结正文，不要标题，不要项目符号\n"
        "- 保留关键知识点、结论和学习价值，避免重复\n\n"
        f"转录文本：\n{transcript}"
    )


def summarize_with_ollama(
    transcript: str,
    word_limit: int,
    model: str,
    base_url: str = "http://localhost:11434",
    timeout_s: int = 180,
) -> str:
    if not transcript.strip():
        return ""

    prompt = _build_prompt(transcript, word_limit)
    url = base_url.rstrip("/") + "/api/generate"
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.2},
    }
    response = requests.post(url, json=payload, timeout=timeout_s)
    if response.status_code != 200:
        raise RuntimeError(f"Ollama HTTP {response.status_code}: {response.text[:500]}")

    data = response.json()
    if not isinstance(data, dict) or "response" not in data:
        raise RuntimeError(f"Unexpected Ollama response: {json.dumps(data)[:500]}")
    return (data.get("response") or "").strip()


def summarize_with_openai(
    transcript: str,
    word_limit: int,
    model: str,
    base_url: str = "http://localhost:1234/v1",
    api_key: str = "lm-studio",
    timeout_s: int = 180,
) -> str:
    if not transcript.strip():
        return ""

    prompt = _build_prompt(transcript, word_limit)
    url = base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
        "max_tokens": 1024,
    }
    headers = {"Authorization": f"Bearer {api_key}"}
    response = requests.post(url, json=payload, headers=headers, timeout=timeout_s)
    if response.status_code != 200:
        raise RuntimeError(f"OpenAI API HTTP {response.status_code}: {response.text[:500]}")

    data = response.json()
    try:
        return data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError):
        raise RuntimeError(f"Unexpected OpenAI response: {json.dumps(data)[:500]}")
