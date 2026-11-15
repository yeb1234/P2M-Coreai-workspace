import json
import logging
from collections import defaultdict

from sqlalchemy import desc, or_, text

from app.database import SessionLocal, settings
from app.models import ChatMessage, ChatSession, SubtitleSegment, Video
from app.services.admin_settings import load_assistant_runtime_settings, load_transcription_settings
from app.services.llm_client import OllamaClient, OpenAICompatibleClient
from app.services.prompts import (
    ASSISTANT_SYSTEM_DEFAULT,
    build_assistant_learning_prompt,
    build_contextual_user_message,
)
from app.utils.files import unique_suffix

logger = logging.getLogger(__name__)


def llm_usage_policy() -> str:
    try:
        value = load_assistant_runtime_settings().get("llm_usage_policy") or load_transcription_settings().get("llm_usage_policy")
    except Exception:
        value = settings.llm_usage_policy
    return value if value in {"local_first", "external_first", "local_only", "external_only"} else "local_first"


def assistant_runtime_settings() -> dict:
    try:
        return load_assistant_runtime_settings()
    except Exception:
        return {
            "local_base_url": settings.openai_base_url,
            "local_api_key": settings.openai_api_key,
            "local_model": settings.openai_model,
            "external_base_url": settings.external_llm_base_url,
            "external_api_key": settings.external_llm_api_key,
            "external_model": settings.external_llm_model,
            "llm_usage_policy": settings.llm_usage_policy,
        }


def build_reference(segment: SubtitleSegment, video: Video, score_hint: float) -> dict:
    return {
        "video_id": video.id,
        "video_title": video.title,
        "start_sec": segment.start_sec,
        "end_sec": segment.end_sec,
        "text": segment.text,
        "score_hint": score_hint,
    }


def search_references(query: str, video_id: int | None = None, limit: int = 6) -> list[dict]:
    """检索参考片段。

    3.0 起改走混合检索（pg_trgm 词法 + pgvector 语义 + RRF）。
    原实现依赖 SQLite FTS5，而 FTS5 默认分词对中文完全失效，
    在 PostgreSQL 上也没有对应表，因此整体替换。
    """
    from app.services.hybrid_search import hybrid_search

    try:
        result = hybrid_search(
            query,
            top_k=max(1, limit),
            candidate_k=max(20, limit * 4),
            video_ids=[video_id] if video_id else None,
            use_rerank=False,  # 旧链路追求低延迟，重排留给 Agent 链路
        )
    except Exception as exc:
        logger.warning("混合检索失败，回退到关键词包含匹配: %s", exc)
        return _fallback_keyword_references(query, video_id, limit)

    return [
        {
            "video_id": hit.video_id,
            "video_title": hit.video_title,
            "start_sec": hit.start_sec,
            "end_sec": hit.end_sec,
            "text": hit.text,
            "score_hint": round(hit.vector_score or hit.lexical_score or hit.score, 4),
        }
        for hit in result["hits"]
    ]


def _fallback_keyword_references(query: str, video_id: int | None, limit: int) -> list[dict]:
    """最后兜底：纯 LIKE 匹配。质量差但不会让接口挂掉。"""
    keywords = [item.strip().lower() for item in query.split() if item.strip()] or [query.strip().lower()]
    db = SessionLocal()
    try:
        filters = [SubtitleSegment.text.contains(keyword) for keyword in keywords]
        stmt = db.query(SubtitleSegment, Video).join(Video, Video.id == SubtitleSegment.video_id)
        if video_id:
            stmt = stmt.filter(SubtitleSegment.video_id == video_id)
        rows = stmt.filter(or_(*filters)).limit(limit * 4).all()

        if not rows:
            videos = (
                db.query(Video)
                .order_by(desc(Video.is_favorite), desc(Video.updated_at))
                .limit(limit)
                .all()
            )
            return [
                {
                    "video_id": video.id,
                    "video_title": video.title,
                    "start_sec": 0,
                    "end_sec": min(video.duration or 0, 90),
                    "text": (video.summary or video.transcription or "暂无字幕")[:220],
                    "score_hint": 0.1,
                }
                for video in videos
            ]

        results = []
        grouped_best = defaultdict(float)
        for segment, video in rows:
            text_lower = segment.text.lower()
            score_hint = sum(1 for keyword in keywords if keyword in text_lower)
            if score_hint <= grouped_best[(video.id, segment.start_sec)]:
                continue
            grouped_best[(video.id, segment.start_sec)] = score_hint
            results.append(build_reference(segment, video, float(score_hint or 0.1)))
        results.sort(key=lambda item: item["score_hint"], reverse=True)
        return results[:limit]
    finally:
        db.close()


def ensure_session(session_id: str | None, video_id: int | None) -> ChatSession:
    db = SessionLocal()
    try:
        if session_id:
            session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
            if session:
                return session

        session = ChatSession(
            id=unique_suffix(),
            title="Learning Assistant",
            scope="video" if video_id else "global",
            video_id=video_id,
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        return session
    finally:
        db.close()


def store_message(session_id: str, role: str, content: str, references: list[dict] | None = None) -> None:
    db = SessionLocal()
    try:
        db.add(
            ChatMessage(
                id=unique_suffix(),
                session_id=session_id,
                role=role,
                content=content,
                references_json=json.dumps(references or [], ensure_ascii=False),
            )
        )
        db.commit()
    finally:
        db.close()


def compose_reference_context(references: list[dict]) -> str:
    lines = []
    for idx, ref in enumerate(references, start=1):
        lines.append(
            f"{idx}. Video: {ref['video_title']}\n"
            f"   Time: {int(ref['start_sec'])}s - {int(ref['end_sec'])}s\n"
            f"   Transcript: {ref['text']}"
        )
    return "\n".join(lines)


def answer_with_ollama(message: str, references: list[dict], depth: str = "basic", system_prompt: str = "") -> str:
    context = compose_reference_context(references)
    prompt = build_assistant_learning_prompt(message, context, depth=depth)
    if system_prompt.strip():
        prompt = f"{system_prompt.strip()}\n\n{prompt}"
    return OllamaClient(base_url=settings.ollama_base_url, timeout_s=180).generate(
        model=settings.ollama_model,
        prompt=prompt,
        temperature=0.2,
    )


def answer_with_external_llm(message: str, references: list[dict], depth: str = "deepen", system_prompt: str = "") -> str:
    runtime = assistant_runtime_settings()
    if not runtime["external_api_key"] or not runtime["external_base_url"] or not runtime["external_model"]:
        raise RuntimeError("External LLM API key is not configured")

    context = compose_reference_context(references)
    prompt = build_assistant_learning_prompt(message, context, depth=depth)
    return OpenAICompatibleClient(
        base_url=runtime["external_base_url"],
        api_key=runtime["external_api_key"],
        timeout_s=180,
    ).chat_completion(
        model=runtime["external_model"],
        messages=[
            {
                "role": "system",
                "content": system_prompt.strip() or ASSISTANT_SYSTEM_DEFAULT,
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
    )


def answer_with_openai_compatible_llm(message: str, references: list[dict], depth: str = "basic", system_prompt: str = "") -> str:
    runtime = assistant_runtime_settings()
    context = compose_reference_context(references)
    prompt = build_assistant_learning_prompt(message, context, depth=depth)
    return OpenAICompatibleClient(
        base_url=runtime["local_base_url"],
        api_key=runtime["local_api_key"],
        timeout_s=180,
    ).chat_completion(
        model=runtime["local_model"],
        messages=[
            {
                "role": "system",
                "content": system_prompt.strip() or ASSISTANT_SYSTEM_DEFAULT,
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
    )


def answer_with_configured_llm(
    message: str,
    references: list[dict],
    depth: str = "basic",
    system_prompt: str = "",
) -> tuple[str, str]:
    provider = (settings.assistant_llm_provider or "local").lower()
    policy = llm_usage_policy()
    errors = []

    def answer_with_local() -> str:
        if provider in ("openai", "lmstudio"):
            return answer_with_openai_compatible_llm(message, references, depth=depth, system_prompt=system_prompt)
        return answer_with_ollama(message, references, depth=depth, system_prompt=system_prompt)

    def answer_with_external() -> str:
        return answer_with_external_llm(message, references, depth=depth, system_prompt=system_prompt)

    attempts = [("local", answer_with_local), ("external", answer_with_external)]
    if policy == "external_first" or depth == "deepen":
        attempts.reverse()
    elif policy == "local_only":
        attempts = [("local", answer_with_local)]
    elif policy == "external_only":
        attempts = [("external", answer_with_external)]

    for label, runner in attempts:
        try:
            answer = runner()
            if label == "local":
                return answer, "openai" if provider in ("openai", "lmstudio") else "ollama"
            return answer, "external"
        except Exception as exc:
            errors.append(f"{label} failed: {exc}")

    fallback = build_fallback_answer(message, references)
    if errors:
        fallback = fallback + "\n\nLLM fallback note: " + " | ".join(errors)
    return fallback, "fallback"


def build_fallback_answer(message: str, references: list[dict]) -> str:
    if not references:
        return "我还没有找到匹配的字幕片段。建议先为更多视频生成或补全字幕。"

    lines = [f"我找到了这些和“{message}”相关的学习片段：", ""]
    for ref in references[:3]:
        minute = int(ref["start_sec"] // 60)
        second = int(ref["start_sec"] % 60)
        lines.append(f"- {ref['video_title']}，{minute}:{second:02d}：{ref['text'][:120]}")
    return "\n".join(lines)


def run_assistant_chat(
    *,
    message: str,
    page_context: str = "",
    system_prompt: str = "",
    session_id: str | None = None,
    video_id: int | None = None,
    depth: str = "basic",
    use_rag: bool = False,
    use_web_search: bool = False,
    use_deep_research: bool = False,
    limit: int = 6,
) -> dict:
    session = ensure_session(session_id, video_id)
    references = search_references(message, video_id=video_id, limit=limit)
    store_message(session.id, "user", message)

    safe_depth = "deepen" if depth == "deepen" else "basic"
    llm_message = build_contextual_user_message(message, page_context)
    answer, mode = answer_with_configured_llm(
        llm_message,
        references,
        depth=safe_depth,
        system_prompt=system_prompt,
    )

    store_message(session.id, "assistant", answer, references=references)
    return {
        "session_id": session.id,
        "answer": answer,
        "mode": mode,
        "depth": safe_depth,
        "rag_enabled": use_rag,
        "web_search_enabled": use_web_search,
        "deep_research_enabled": use_deep_research,
        "references": references,
    }
