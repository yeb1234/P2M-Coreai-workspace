from fastapi import APIRouter

from app.schemas import AssistantChatCreate, AssistantChatOut
from app.services.assistant import run_assistant_chat


router = APIRouter(prefix="/api/assistant", tags=["assistant"])


@router.post("/chat", response_model=AssistantChatOut)
def assistant_chat(payload: AssistantChatCreate):
    result = run_assistant_chat(
        message=payload.message,
        session_id=payload.session_id,
        video_id=payload.video_id,
        depth=payload.depth,
        use_rag=payload.use_rag,
        use_web_search=payload.use_web_search,
        use_deep_research=payload.use_deep_research,
        limit=payload.limit,
    )
    return AssistantChatOut(**result)
