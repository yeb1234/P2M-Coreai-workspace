from fastapi import APIRouter

from app.schemas import (
    AssistantChatCreate,
    AssistantChatOut,
    AssistantConnectionTestCreate,
    AssistantConnectionTestOut,
    AssistantModelListCreate,
    AssistantModelListOut,
)
from app.services.assistant import run_assistant_chat
from app.services.llm_client import OpenAICompatibleClient


router = APIRouter(prefix="/api/assistant", tags=["assistant"])


@router.post("/chat", response_model=AssistantChatOut)
def assistant_chat(payload: AssistantChatCreate):
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
    )
    return AssistantChatOut(**result)


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
