from app.services.llm_client import OllamaClient, OpenAICompatibleClient


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
    return OllamaClient(base_url=base_url, timeout_s=timeout_s).generate(
        model=model,
        prompt=prompt,
        temperature=0.2,
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

    prompt = _build_prompt(transcript, word_limit)
    return OpenAICompatibleClient(base_url=base_url, api_key=api_key, timeout_s=timeout_s).chat_completion(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=1024,
    )
