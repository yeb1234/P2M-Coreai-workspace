from fastapi import APIRouter

from app.schemas import AssistantRuntimeSettingsIn, AssistantRuntimeSettingsOut, RescanOut, TranscriptionSettingsIn, TranscriptionSettingsOut
from app.services import admin_ai_queue
from app.services.admin_health import backend_health as collect_backend_health
from app.services.admin_library import (
    download_whisper_model,
    generate_thumbnails_for_ids as generate_thumbnails_for_video_ids,
    get_download_status,
    rescan_library as rescan_video_library,
    whisper_models as list_whisper_models,
)
from app.services.admin_settings import (
    load_assistant_runtime_settings,
    load_transcription_settings,
    save_assistant_runtime_settings as persist_assistant_runtime_settings,
    save_transcription_settings as persist_transcription_settings,
)


router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/rescan", response_model=RescanOut)
def rescan_library():
    return RescanOut(**rescan_video_library())


@router.post("/generate-thumbnails")
def generate_thumbnails_for_ids(payload: dict):
    return generate_thumbnails_for_video_ids(payload.get("video_ids", []))


@router.get("/whisper-models")
def whisper_models():
    return list_whisper_models()


@router.post("/download-whisper-model/{model_id}")
def whisper_model_download(model_id: str):
    return download_whisper_model(model_id)


@router.get("/download-whisper-model/{model_id}")
def whisper_model_download_status(model_id: str):
    status = get_download_status(model_id)
    if status is None:
        return {"model_id": model_id, "status": "unknown"}
    return {"model_id": model_id, **status}


@router.get("/transcription-settings", response_model=TranscriptionSettingsOut)
def get_transcription_settings():
    return TranscriptionSettingsOut(**load_transcription_settings())


@router.put("/transcription-settings", response_model=TranscriptionSettingsOut)
def save_transcription_settings(payload: TranscriptionSettingsIn):
    current = load_transcription_settings()
    updates = payload.model_dump(exclude_unset=True)
    next_settings = persist_transcription_settings({**current, **updates})
    if "llm_usage_policy" in updates:
        runtime = load_assistant_runtime_settings()
        persist_assistant_runtime_settings({**runtime, "llm_usage_policy": next_settings["llm_usage_policy"]})
    return TranscriptionSettingsOut(**next_settings)


@router.get("/assistant-settings", response_model=AssistantRuntimeSettingsOut)
def get_assistant_runtime_settings():
    return AssistantRuntimeSettingsOut(**load_assistant_runtime_settings())


@router.put("/assistant-settings", response_model=AssistantRuntimeSettingsOut)
def save_assistant_runtime_settings(payload: AssistantRuntimeSettingsIn):
    current = load_assistant_runtime_settings()
    updates = payload.model_dump(exclude_unset=True)
    next_settings = persist_assistant_runtime_settings({**current, **updates})
    if "llm_usage_policy" in updates:
        transcription = load_transcription_settings()
        persist_transcription_settings({**transcription, "llm_usage_policy": next_settings["llm_usage_policy"]})
    return AssistantRuntimeSettingsOut(**next_settings)


@router.get("/health")
def backend_health():
    return collect_backend_health()


@router.get("/ai-jobs/queue")
def ai_queue_state():
    return admin_ai_queue.ai_queue_state()


@router.post("/ai-jobs/clear-queued")
def clear_queued_ai_jobs():
    return admin_ai_queue.clear_queued_ai_jobs()


@router.post("/ai-jobs/recover-stuck")
def recover_stuck_ai_jobs(minutes: int = 60, correction_minutes: int = 15, force: bool = False):
    return admin_ai_queue.recover_stuck_ai_jobs(minutes=minutes, correction_minutes=correction_minutes, force=force)


@router.post("/ai-jobs/pause")
def pause_ai_queue():
    return admin_ai_queue.pause_ai_queue()


@router.post("/ai-jobs/resume")
def resume_ai_queue():
    return admin_ai_queue.resume_ai_queue()


@router.post("/ai-jobs/{job_id}/cancel")
def cancel_ai_job(job_id: str):
    return admin_ai_queue.cancel_ai_job(job_id)


@router.post("/ai-jobs/{job_id}/resume")
def resume_ai_job(job_id: str):
    return admin_ai_queue.resume_ai_job(job_id)


@router.post("/ai-jobs/sync-queued-settings")
def sync_queued_ai_job_settings():
    return admin_ai_queue.sync_queued_ai_job_settings()


@router.post("/ai-jobs/clear-active")
def clear_active_ai_jobs():
    return admin_ai_queue.clear_active_ai_jobs()


@router.post("/ai-jobs/clear-history")
def clear_finished_ai_jobs():
    return admin_ai_queue.clear_finished_ai_jobs()


@router.post("/ai-jobs/clear-completed")
def clear_completed_ai_jobs():
    return admin_ai_queue.clear_completed_ai_jobs()


@router.post("/ai-jobs/clear-all")
def clear_all_ai_jobs():
    return admin_ai_queue.clear_all_ai_jobs()
