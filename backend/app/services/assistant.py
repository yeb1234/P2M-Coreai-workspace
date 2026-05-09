import json
from collections import defaultdict

from sqlalchemy import desc, or_, text

from app.database import SessionLocal, settings
from app.models import ChatMessage, ChatSession, SubtitleSegment, Video
from app.services.llm_client import OllamaClient, OpenAICompatibleClient
from app.utils.files import unique_suffix


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
    keywords = [item.strip().lower() for item in query.split() if item.strip()]
    if not keywords:
        keywords = [query.strip().lower()]

    db = SessionLocal()
    try:
        try:
            fts_sql = """
                SELECT s.id, s.video_id, s.segment_index, s.start_sec, s.end_sec, s.text,
                       v.id AS v_id, v.title AS v_title
                FROM subtitle_segments_fts f
                JOIN subtitle_segments s ON s.id = f.rowid
                JOIN videos v ON v.id = s.video_id
                WHERE subtitle_segments_fts MATCH :query_text
            """
            params = {"query_text": query.strip(), "limit": limit * 4}
            if video_id:
                fts_sql += " AND s.video_id = :video_id"
                params["video_id"] = video_id
            fts_sql += " ORDER BY bm25(subtitle_segments_fts) LIMIT :limit"
            fts_rows = db.execute(text(fts_sql), params).fetchall()
        except Exception:
            fts_rows = []

        if fts_rows:
            results = []
            grouped_best = defaultdict(float)
            for row in fts_rows:
                text_lower = (row.text or "").lower()
                score_hint = sum(1 for keyword in keywords if keyword in text_lower) or 0.5
                if score_hint <= grouped_best[(row.video_id, row.start_sec)]:
                    continue
                grouped_best[(row.video_id, row.start_sec)] = score_hint
                results.append(
                    {
                        "video_id": row.video_id,
                        "video_title": row.v_title,
                        "start_sec": row.start_sec,
                        "end_sec": row.end_sec,
                        "text": row.text,
                        "score_hint": float(score_hint),
                    }
                )
            results.sort(key=lambda item: item["score_hint"], reverse=True)
            return results[:limit]

        filters = [SubtitleSegment.text.contains(keyword) for keyword in keywords]
        query_stmt = db.query(SubtitleSegment, Video).join(Video, Video.id == SubtitleSegment.video_id)
        if video_id:
            query_stmt = query_stmt.filter(SubtitleSegment.video_id == video_id)
        rows = query_stmt.filter(or_(*filters)).limit(limit * 4).all()

        if not rows:
            fallback = db.query(Video)
            if video_id:
                fallback = fallback.filter(Video.id == video_id)
            videos = fallback.order_by(desc(Video.updated_at)).limit(limit).all()
            return [
                {
                    "video_id": video.id,
                    "video_title": video.title,
                    "start_sec": 0,
                    "end_sec": min(video.duration or 0, 90),
                    "text": (video.summary or video.transcription or "No transcript available yet.")[:220],
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


def answer_with_ollama(message: str, references: list[dict], depth: str = "basic") -> str:
    context = compose_reference_context(references)
    prompt = build_learning_prompt(message, context, depth=depth)
    return OllamaClient(base_url=settings.ollama_base_url, timeout_s=180).generate(
        model=settings.ollama_model,
        prompt=prompt,
        temperature=0.2,
    )


def build_learning_prompt(message: str, context: str, depth: str = "basic") -> str:
    depth_instruction = (
        "Give a compact first-pass answer and invite the user to ask for deeper analysis."
        if depth == "basic"
        else "Give a deeper answer with a learning path, prerequisites, and concrete next study steps."
    )
    return f"""You are a practical learning assistant for a personal video library.
Answer the user's study question using only the referenced transcript snippets.
When recommending lessons, mention the video title and the timestamp in seconds.
If the snippets are not enough, say what is missing and suggest generating more subtitles.
Keep the answer concise, concrete, and learning-oriented.
Depth instruction: {depth_instruction}

User question:
{message}

Referenced snippets:
{context}
"""


def answer_with_external_llm(message: str, references: list[dict], depth: str = "deepen") -> str:
    if not settings.external_llm_api_key:
        raise RuntimeError("External LLM API key is not configured")

    context = compose_reference_context(references)
    prompt = build_learning_prompt(message, context, depth=depth)
    return OpenAICompatibleClient(
        base_url=settings.external_llm_base_url,
        api_key=settings.external_llm_api_key,
        timeout_s=180,
    ).chat_completion(
        model=settings.external_llm_model,
        messages=[
            {
                "role": "system",
                "content": "You answer study questions using cited video transcript snippets and timestamp recommendations.",
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
    )


def answer_with_configured_llm(message: str, references: list[dict], depth: str = "basic") -> tuple[str, str]:
    provider = (settings.assistant_llm_provider or "local").lower()
    errors = []

    if depth == "deepen":
        try:
            return answer_with_external_llm(message, references, depth=depth), "external"
        except Exception as exc:
            errors.append(f"external failed: {exc}")

    try:
        return answer_with_ollama(message, references, depth=depth), "ollama"
    except Exception as exc:
        errors.append(f"ollama failed: {exc}")

    if provider == "external":
        try:
            return answer_with_external_llm(message, references, depth=depth), "external"
        except Exception as exc:
            errors.append(f"external failed: {exc}")

    fallback = build_fallback_answer(message, references)
    if errors:
        fallback = fallback + "\n\nLLM fallback note: " + " | ".join(errors)
    return fallback, "fallback"


def build_fallback_answer(message: str, references: list[dict]) -> str:
    if not references:
        return "I could not find a matching transcript segment yet. Generate subtitles for more videos first."

    lines = [f"I found these lesson segments related to: {message}", ""]
    for ref in references[:3]:
        minute = int(ref["start_sec"] // 60)
        second = int(ref["start_sec"] % 60)
        lines.append(f"- {ref['video_title']} at {minute}:{second:02d}: {ref['text'][:120]}")
    return "\n".join(lines)


def run_assistant_chat(
    *,
    message: str,
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
    answer, mode = answer_with_configured_llm(message, references, depth=safe_depth)

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
