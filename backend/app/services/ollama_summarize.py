from app.services.llm_client import OllamaClient, OpenAICompatibleClient


def _clamp_word_limit(word_limit: int) -> int:
    try:
        return max(50, min(2000, int(word_limit)))
    except (TypeError, ValueError):
        return 200


def _trim_summary(summary: str, word_limit: int) -> str:
    limit = _clamp_word_limit(word_limit)
    text = (summary or "").strip()
    if len(text) <= limit:
        return text

    trimmed = text[:limit].rstrip()
    cut_points = [trimmed.rfind(mark) for mark in ("。", "！", "？", "\n")]
    cut = max(cut_points)
    if cut >= max(40, int(limit * 0.65)):
        trimmed = trimmed[: cut + 1].rstrip()
    return trimmed + "..."


def _build_prompt(transcript: str, word_limit: int) -> str:
    limit = _clamp_word_limit(word_limit)
    return (
        "/no_think\n"
        "你是一个严谨的 IT 老师和中文学习总结助手。请根据以下转录文本输出一段中文总结。\n"
        f"长度硬性要求：总结正文最多 {limit} 个中文字符。超过这个长度会被系统截断，所以请主动压缩到限制内。\n"
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
    summary = OllamaClient(base_url=base_url, timeout_s=timeout_s).generate(
        model=model,
        prompt=prompt,
        temperature=0.2,
    )
    return _trim_summary(summary, word_limit)


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

    limit = _clamp_word_limit(word_limit)
    prompt = _build_prompt(transcript, limit)
    summary = OpenAICompatibleClient(base_url=base_url, api_key=api_key, timeout_s=timeout_s).chat_completion(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=max(128, min(4096, int(limit * 1.8))),
    )
    return _trim_summary(summary, limit)
