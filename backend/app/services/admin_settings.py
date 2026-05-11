import json
from datetime import datetime

from app.database import SessionLocal, settings
from app.models import AppSetting
from app.services.prompts import SUBTITLE_CORRECTION_DEFAULT

WHISPER_MODEL_FILES = {
    "tiny": "ggml-tiny.bin",
    "base": "ggml-base.bin",
    "small": "ggml-small.bin",
    "medium": "ggml-medium.bin",
    "large": "ggml-large.bin",
    "large-v3": "ggml-large-v3.bin",
}

TRANSCRIPTION_SETTINGS_KEY = "transcription_settings"
ASSISTANT_RUNTIME_SETTINGS_KEY = "assistant_runtime_settings"
DEFAULT_SUBTITLE_CORRECTION_PROMPT = SUBTITLE_CORRECTION_DEFAULT
LLM_USAGE_POLICIES = {"local_first", "external_first", "local_only", "external_only"}


def normalize_openai_base_url(value: str) -> str:
    trimmed = value.strip().rstrip("/")
    if trimmed.endswith("/v1/chat/completions"):
        return trimmed[: -len("/chat/completions")]
    if trimmed.endswith("/chat/completions"):
        return trimmed[: -len("/chat/completions")]
    return trimmed


def default_assistant_runtime_settings() -> dict:
    return {
        "local_base_url": settings.openai_base_url,
        "local_api_key": settings.openai_api_key,
        "local_model": settings.openai_model,
        "external_base_url": settings.external_llm_base_url,
        "external_api_key": settings.external_llm_api_key,
        "external_model": settings.external_llm_model,
        "llm_usage_policy": settings.llm_usage_policy if settings.llm_usage_policy in LLM_USAGE_POLICIES else "local_first",
    }


def coerce_assistant_runtime_settings(raw: dict | None = None) -> dict:
    data = {**default_assistant_runtime_settings(), **(raw or {})}
    data["local_base_url"] = normalize_openai_base_url(str(data.get("local_base_url") or ""))
    data["local_api_key"] = str(data.get("local_api_key") or "")
    data["local_model"] = str(data.get("local_model") or "").strip()
    data["external_base_url"] = normalize_openai_base_url(str(data.get("external_base_url") or ""))
    data["external_api_key"] = str(data.get("external_api_key") or "")
    data["external_model"] = str(data.get("external_model") or "").strip()
    data["llm_usage_policy"] = data["llm_usage_policy"] if data.get("llm_usage_policy") in LLM_USAGE_POLICIES else "local_first"
    return data


def load_assistant_runtime_settings() -> dict:
    db = SessionLocal()
    try:
        row = db.query(AppSetting).filter(AppSetting.key == ASSISTANT_RUNTIME_SETTINGS_KEY).first()
        if not row:
            return coerce_assistant_runtime_settings()
        try:
            return coerce_assistant_runtime_settings(json.loads(row.value))
        except Exception:
            return coerce_assistant_runtime_settings()
    finally:
        db.close()


def save_assistant_runtime_settings(data: dict) -> dict:
    next_settings = coerce_assistant_runtime_settings(data)
    db = SessionLocal()
    try:
        row = db.query(AppSetting).filter(AppSetting.key == ASSISTANT_RUNTIME_SETTINGS_KEY).first()
        value = json.dumps(next_settings, ensure_ascii=False)
        if row:
            row.value = value
            row.updated_at = datetime.now()
        else:
            db.add(AppSetting(key=ASSISTANT_RUNTIME_SETTINGS_KEY, value=value, updated_at=datetime.now()))
        db.commit()
        return next_settings
    finally:
        db.close()


def default_transcription_settings() -> dict:
    return {
        "whisper_engine": settings.whisper_engine,
        "whisper_model": settings.default_whisper_model,
        "language": settings.default_language,
        "do_summary": True,
        "word_limit": 200,
        "cpu_threads": settings.whisper_cpu_threads,
        "compute_type": settings.whisper_compute_type,
        "beam_size": settings.whisper_beam_size,
        "best_of": settings.whisper_best_of,
        "temperature": settings.whisper_temperature,
        "vad_filter": settings.whisper_vad_filter,
        "subtitle_correction_enabled": settings.subtitle_correction_enabled,
        "subtitle_correction_scope": "off" if settings.subtitle_correction_scope == "off" else "full",
        "subtitle_correction_prompt": DEFAULT_SUBTITLE_CORRECTION_PROMPT,
        "llm_usage_policy": settings.llm_usage_policy if settings.llm_usage_policy in LLM_USAGE_POLICIES else "local_first",
    }


def coerce_transcription_settings(raw: dict | None = None) -> dict:
    data = {**default_transcription_settings(), **(raw or {})}
    data["whisper_engine"] = data["whisper_engine"] if data["whisper_engine"] in {"faster-whisper", "whisper.cpp"} else settings.whisper_engine
    data["whisper_model"] = data["whisper_model"] if data["whisper_model"] in WHISPER_MODEL_FILES else settings.default_whisper_model
    data["language"] = str(data.get("language") or settings.default_language)
    data["do_summary"] = bool(data.get("do_summary"))
    data["word_limit"] = max(50, min(2000, int(data.get("word_limit") or 200)))
    data["cpu_threads"] = max(1, min(128, int(data.get("cpu_threads") or settings.whisper_cpu_threads)))
    data["compute_type"] = str(data.get("compute_type") or settings.whisper_compute_type).strip() or settings.whisper_compute_type
    data["beam_size"] = max(1, min(10, int(data.get("beam_size") or settings.whisper_beam_size)))
    data["best_of"] = max(1, min(10, int(data.get("best_of") or settings.whisper_best_of)))
    data["temperature"] = max(0.0, min(1.0, float(data.get("temperature") if data.get("temperature") is not None else settings.whisper_temperature)))
    data["vad_filter"] = bool(data.get("vad_filter"))
    data["subtitle_correction_enabled"] = bool(data.get("subtitle_correction_enabled"))
    data["subtitle_correction_scope"] = "off" if data.get("subtitle_correction_scope") == "off" else "full"
    data["llm_usage_policy"] = data["llm_usage_policy"] if data.get("llm_usage_policy") in LLM_USAGE_POLICIES else "local_first"
    prompt = str(data.get("subtitle_correction_prompt") or DEFAULT_SUBTITLE_CORRECTION_PROMPT)
    if "????" in prompt or "\u5fd9" in prompt or "\ufffd" in prompt or "\u00e6" in prompt or "\u929d" in prompt:
        prompt = DEFAULT_SUBTITLE_CORRECTION_PROMPT
    data["subtitle_correction_prompt"] = prompt
    return data


def load_transcription_settings() -> dict:
    db = SessionLocal()
    try:
        row = db.query(AppSetting).filter(AppSetting.key == TRANSCRIPTION_SETTINGS_KEY).first()
        if not row:
            return coerce_transcription_settings()
        try:
            return coerce_transcription_settings(json.loads(row.value))
        except Exception:
            return coerce_transcription_settings()
    finally:
        db.close()


def save_transcription_settings(data: dict) -> dict:
    normalized = coerce_transcription_settings(data)
    db = SessionLocal()
    try:
        row = db.query(AppSetting).filter(AppSetting.key == TRANSCRIPTION_SETTINGS_KEY).first()
        value = json.dumps(normalized, ensure_ascii=False)
        if row:
            row.value = value
        else:
            db.add(AppSetting(key=TRANSCRIPTION_SETTINGS_KEY, value=value))
        db.commit()
        return normalized
    finally:
        db.close()
