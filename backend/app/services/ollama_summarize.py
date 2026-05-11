from app.services.llm_client import OllamaClient, OpenAICompatibleClient
from app.services.prompts import build_summary_prompt
from app.database import settings

SUMMARY_COMPRESSION_THRESHOLD = 0.9
CHARS_PER_TOKEN_ESTIMATE = 2.2
PROMPT_RESERVE_TOKENS = 900
MAX_COMPRESSION_ROUNDS = 6


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
    return build_summary_prompt(transcript, limit)


def _estimate_tokens(text: str) -> int:
    return max(1, int(len(text) / CHARS_PER_TOKEN_ESTIMATE))


def _summary_input_budget_tokens() -> int:
    threshold = int(settings.llm_context_token_limit * SUMMARY_COMPRESSION_THRESHOLD)
    return max(1000, threshold - PROMPT_RESERVE_TOKENS)


def _fits_summary_window(transcript: str, word_limit: int) -> bool:
    return _estimate_tokens(_build_prompt(transcript, word_limit)) <= int(settings.llm_context_token_limit * SUMMARY_COMPRESSION_THRESHOLD)


def _split_text_by_budget(text: str, budget_tokens: int) -> list[str]:
    budget_chars = max(1200, int(budget_tokens * CHARS_PER_TOKEN_ESTIMATE))
    paragraphs = [item.strip() for item in text.replace("\r\n", "\n").split("\n") if item.strip()]
    if not paragraphs:
        paragraphs = [text.strip()]

    chunks: list[str] = []
    current: list[str] = []
    current_len = 0

    def flush_current() -> None:
        nonlocal current, current_len
        if current:
            chunks.append("\n".join(current).strip())
            current = []
            current_len = 0

    for paragraph in paragraphs:
        if len(paragraph) > budget_chars:
            flush_current()
            start = 0
            while start < len(paragraph):
                end = min(len(paragraph), start + budget_chars)
                if end < len(paragraph):
                    cut_points = [paragraph.rfind(mark, start, end) for mark in ("。", "！", "？", "；", "，", " ")]
                    cut = max(cut_points)
                    if cut > start + int(budget_chars * 0.5):
                        end = cut + 1
                chunks.append(paragraph[start:end].strip())
                start = end
            continue

        next_len = current_len + len(paragraph) + 1
        if current and next_len > budget_chars:
            flush_current()
        current.append(paragraph)
        current_len += len(paragraph) + 1

    flush_current()
    return [chunk for chunk in chunks if chunk]


def _compression_word_limit(word_limit: int, chunk_count: int) -> int:
    target = max(120, min(700, int(_clamp_word_limit(word_limit) * 1.5)))
    if chunk_count > 8:
        return min(target, 360)
    if chunk_count > 4:
        return min(target, 500)
    return target


def _summarize_direct_with_ollama(transcript: str, word_limit: int, model: str, base_url: str, timeout_s: int) -> str:
    prompt = _build_prompt(transcript, word_limit)
    return OllamaClient(base_url=base_url, timeout_s=timeout_s).generate(
        model=model,
        prompt=prompt,
        temperature=0.2,
    )


def _summarize_direct_with_openai(transcript: str, word_limit: int, model: str, base_url: str, api_key: str, timeout_s: int) -> str:
    limit = _clamp_word_limit(word_limit)
    prompt = _build_prompt(transcript, limit)
    return OpenAICompatibleClient(base_url=base_url, api_key=api_key, timeout_s=timeout_s).chat_completion(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=max(128, min(4096, int(limit * 1.8))),
    )


def _summarize_compressed(transcript: str, word_limit: int, direct_summarize) -> str:
    text = transcript.strip()
    if not text:
        return ""

    if _fits_summary_window(text, word_limit):
        return _trim_summary(direct_summarize(text, word_limit), word_limit)

    current = text
    for _round in range(MAX_COMPRESSION_ROUNDS):
        chunk_budget = _summary_input_budget_tokens()
        chunks = _split_text_by_budget(current, chunk_budget)
        if len(chunks) <= 1:
            return _trim_summary(direct_summarize(current, word_limit), word_limit)

        partial_limit = _compression_word_limit(word_limit, len(chunks))
        partials = []
        for index, chunk in enumerate(chunks, start=1):
            partial = direct_summarize(
                f"这是第 {index}/{len(chunks)} 段转录。请只总结本段内容，保留关键知识点、术语和结论。\n\n{chunk}",
                partial_limit,
            )
            partials.append(f"第 {index} 段：{_trim_summary(partial, partial_limit)}")

        current = "\n".join(partials)
        if _fits_summary_window(current, word_limit):
            return _trim_summary(direct_summarize(current, word_limit), word_limit)

    return _trim_summary(direct_summarize(current, word_limit), word_limit)


def summarize_with_ollama(
    transcript: str,
    word_limit: int,
    model: str,
    base_url: str = "http://localhost:11434",
    timeout_s: int = 180,
) -> str:
    if not transcript.strip():
        return ""

    return _summarize_compressed(
        transcript,
        word_limit,
        lambda text, limit: _summarize_direct_with_ollama(text, limit, model, base_url, timeout_s),
    )


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

    return _summarize_compressed(
        transcript,
        word_limit,
        lambda text, limit: _summarize_direct_with_openai(text, limit, model, base_url, api_key, timeout_s),
    )
