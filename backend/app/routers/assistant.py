import logging

from fastapi import APIRouter, HTTPException

from app.schemas import (
    AssistantChatCreate,
    AssistantChatOut,
    AssistantConnectionTestCreate,
    AssistantConnectionTestOut,
    AssistantIntentCreate,
    AssistantIntentOut,
    AssistantModelListCreate,
    AssistantModelListOut,
)
from app.services.assistant import run_assistant_chat
from app.services.embedding import generate_embeddings_batch
from app.services.intent_recognition import detect_intent_langchain
from app.services.llm_client import OpenAICompatibleClient
from app.services.vector_store import (
    clear_all_embeddings,
    count_embeddings,
    ensure_vec_schema,
    get_unindexed_segment_ids,
    upsert_embeddings_batch,
)


router = APIRouter(prefix="/api/assistant", tags=["assistant"])

logger = logging.getLogger(__name__)


@router.post("/detect-intent", response_model=AssistantIntentOut)
def assistant_detect_intent(payload: AssistantIntentCreate):
    try:
        result = detect_intent_langchain(
            message=payload.message,
            page_context=payload.page_context,
            intent_hint=getattr(payload, "intent_hint", ""),
        )
        return AssistantIntentOut(
            intent=result.intent,
            confidence=result.confidence,
            cleaned_query=result.cleaned_query,
            keywords=result.keywords,
            reasoning=result.reasoning,
        )
    except Exception as exc:
        logger.warning("Intent detection error (falling back to general): %s", exc)
        # 意图识别失败不应阻断主流程，返回 general 兜底
        return AssistantIntentOut(
            intent="general",
            confidence=0.0,
            cleaned_query=payload.message,
            keywords=[],
            reasoning=f"意图识别异常: {str(exc)[:100]}",
        )


@router.post("/chat", response_model=AssistantChatOut)
def assistant_chat(payload: AssistantChatCreate):
    try:
        result = run_assistant_chat(
            message=payload.message,
            page_context=payload.page_context,
            system_prompt=payload.system_prompt,
            session_id=payload.session_id,
            video_id=payload.video_id,
            depth=payload.depth,
            use_rag=payload.use_rag,
            use_web_search=payload.use_web_search,
            use_deep_research=payload.use_deep_research,
            limit=payload.limit,
            cleaned_query=payload.cleaned_query,
            intent=payload.intent,
            intent_hint=payload.intent_hint,
        )
        return AssistantChatOut(**result)
    except RuntimeError as exc:
        # LLM 未配置、连接失败等运行时错误
        error_msg = str(exc)
        logger.warning("Assistant chat runtime error: %s", error_msg)
        raise HTTPException(status_code=503, detail=error_msg)
    except Exception as exc:
        # 其他未预期的错误（LLM 连接超时、模型返回异常等）
        error_msg = str(exc)
        logger.exception("Assistant chat unexpected error")
        # 提取关键错误信息给前端
        if "Connection" in error_msg or "connect" in error_msg.lower():
            detail = f"无法连接到 LLM 服务，请检查模型是否已启动。({error_msg[:200]})"
        elif "timeout" in error_msg.lower():
            detail = f"LLM 服务响应超时，请检查模型服务状态。({error_msg[:200]})"
        elif "401" in error_msg or "403" in error_msg or "Authentication" in error_msg:
            detail = "LLM API 认证失败，请检查 API Key 配置。"
        elif "404" in error_msg:
            detail = f"LLM API 端点未找到，请检查 Base URL 配置。({error_msg[:200]})"
        elif "model" in error_msg.lower() and ("not found" in error_msg.lower() or "not exist" in error_msg.lower()):
            detail = f"指定的模型不存在，请在设置中选择正确的模型。({error_msg[:200]})"
        else:
            detail = f"灵境小助手请求失败: {error_msg[:300]}"
        raise HTTPException(status_code=502, detail=detail)


def normalize_openai_base_url(value: str) -> str:
    trimmed = value.strip().rstrip("/")
    if trimmed.endswith("/v1/chat/completions"):
        return trimmed[: -len("/chat/completions")]
    if trimmed.endswith("/chat/completions"):
        return trimmed[: -len("/chat/completions")]
    return trimmed


@router.post("/models", response_model=AssistantModelListOut)
def assistant_models(payload: AssistantModelListCreate):
    client = OpenAICompatibleClient(
        base_url=normalize_openai_base_url(payload.base_url),
        api_key=payload.api_key,
        timeout_s=30,
    )
    return AssistantModelListOut(models=client.list_models())


@router.post("/connection-test", response_model=AssistantConnectionTestOut)
def assistant_connection_test(payload: AssistantConnectionTestCreate):
    client = OpenAICompatibleClient(
        base_url=normalize_openai_base_url(payload.base_url),
        api_key=payload.api_key,
        timeout_s=120,
    )
    answer = client.chat_completion(
        model=payload.model,
        messages=[
            {"role": "system", "content": payload.system_prompt or "必须始终使用简体中文回答，禁止用英文回答。"},
            {"role": "user", "content": payload.message},
        ],
        temperature=payload.temperature,
    )
    return AssistantConnectionTestOut(
        status="HTTP 200",
        answer=answer,
        received_text=bool(answer.strip()),
    )


@router.post("/build-embeddings")
def build_embeddings(full_rebuild: bool = False, batch_size: int = 64):
    """Generate or rebuild subtitle segment embeddings via LM Studio.

    - full_rebuild=True: drop all existing embeddings and re-index everything.
    - full_rebuild=False (default): incremental index only new/missing segments.
    - batch_size: how many segments to embed per LM Studio API call.
    """
    from app.database import SessionLocal
    from app.models import SubtitleSegment

    ensure_vec_schema()

    if full_rebuild:
        clear_all_embeddings()

    db = SessionLocal()
    try:
        # For full rebuild, get ALL segments; otherwise only unindexed
        if full_rebuild:
            total_segments = db.query(SubtitleSegment).count()
            segment_ids = [sid for sid, in db.query(SubtitleSegment.id).all()]
        else:
            segment_ids = get_unindexed_segment_ids(limit=1000)
            total_segments = len(segment_ids)

        if not segment_ids:
            return {"status": "ok", "indexed": 0, "total": 0}

        indexed = 0
        for i in range(0, len(segment_ids), batch_size):
            chunk_ids = segment_ids[i : i + batch_size]
            segments = (
                db.query(SubtitleSegment)
                .filter(SubtitleSegment.id.in_(chunk_ids))
                .all()
            )
            texts = [seg.text for seg in segments]
            try:
                embeddings = generate_embeddings_batch(texts)
            except Exception as exc:
                return {
                    "status": "error",
                    "message": str(exc),
                    "indexed": indexed,
                    "total": len(segment_ids),
                }
            items = [(seg.id, emb) for seg, emb in zip(segments, embeddings)]
            upsert_embeddings_batch(items)
            indexed += len(items)

        return {
            "status": "ok",
            "indexed": indexed,
            "total": total_segments,
            "mode": "full_rebuild" if full_rebuild else "incremental",
        }
    finally:
        db.close()


@router.get("/embedding-stats")
def embedding_stats():
    ensure_vec_schema()
    from app.database import SessionLocal
    from app.models import SubtitleSegment

    db = SessionLocal()
    try:
        total_segments = db.query(SubtitleSegment).count()
        vec_count = count_embeddings()
        return {
            "total_segments": total_segments,
            "indexed_embeddings": vec_count,
            "coverage_pct": round(vec_count / total_segments * 100, 2) if total_segments else 0,
        }
    finally:
        db.close()
