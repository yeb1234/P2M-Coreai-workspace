import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func

from app.auth import hash_password, require_admin
from app.database import SessionLocal
from app.models import (
    CalendarEvent,
    ChatMessage,
    ChatSession,
    LearningGoal,
    LearningPath,
    LearningPathStep,
    MemoryItem,
    Note,
    ScheduleItem,
    User,
    UserData,
    UserProfile,
    WatchEvent,
    WatchHistory,
)
from app.schemas import (
    AdminPasswordReset,
    AdminUserOut,
    AdminUserUpdate,
    AssistantRuntimeSettingsIn,
    AssistantRuntimeSettingsOut,
    RescanOut,
    TranscriptionSettingsIn,
    TranscriptionSettingsOut,
)
from sqlalchemy.orm import Session
from app.services import admin_ai_queue
from app.services.admin_health import backend_health as collect_backend_health
from app.services.admin_library import (
    download_whisper_model,
    generate_thumbnails_for_ids as generate_thumbnails_for_video_ids,
    get_download_status,
    rescan_library as rescan_video_library,
    whisper_models as list_whisper_models,
)
logger = logging.getLogger(__name__)

from app.services.admin_settings import (
    load_assistant_runtime_settings,
    load_transcription_settings,
    save_assistant_runtime_settings as persist_assistant_runtime_settings,
    save_transcription_settings as persist_transcription_settings,
)


# 整个管理端统一要求管理员角色。
# 早期这些端点完全没有鉴权：任何能访问 80 端口的人都能改 LLM 配置、
# 清空任务队列、触发全盘扫描，并通过 GET /assistant-settings 读到明文 API Key。
router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)

# 密钥掩码占位：GET 返回它代替真实值，PUT 收到它时表示「保持原样」。
# 这样前端设置页仍能正常回填，但网络响应里不再出现明文密钥。
MASKED_SECRET = "__MASKED__"


def _mask(value: str) -> str:
    if not value:
        return ""
    return MASKED_SECRET


def _unmask(new_value: str | None, current_value: str) -> str:
    """PUT 时决定是否真的更新密钥。"""
    if new_value is None or new_value == MASKED_SECRET:
        return current_value
    return new_value


@router.post("/rescan", response_model=RescanOut)
def rescan_library():
    return RescanOut(**rescan_video_library())


@router.get("/embeddings/status")
def embeddings_status():
    """语义块索引进度：多少视频有字幕、索引了多少、还差多少、向量覆盖率。"""
    from app.services.embedding_pipeline import status

    return status()


@router.post("/embeddings/scan")
def embeddings_scan(limit: int = 50):
    """手动触发一次扫描（正常不需要 —— worker 每 5 分钟自己扫）。"""
    from app.services.embedding_pipeline import scan_missing

    return scan_missing(limit=max(1, min(limit, 500)))


@router.post("/embeddings/reindex/{video_id}")
def embeddings_reindex(video_id: int, force: bool = True):
    """重建单个视频的索引。

    force=True（默认）会无视「已是最新」直接重建 —— 换嵌入模型、
    调分块参数之后要这么做。同步执行，一个视频只有几块，秒级完成。
    """
    from app.services.embedding_pipeline import index_video

    return index_video(video_id, force=force)


@router.get("/background-tasks/stats")
def background_task_stats():
    """通用后台任务的状态统计。

    返回形如 {"queued": 3, "running": 1, "done": 120, "failed": 0}。
    重启后想看「有没有任务被漏掉」，查 queued + running 就行。
    """
    from app.services.background_tasks import task_stats

    return task_stats()


@router.post("/background-tasks/requeue")
def background_task_requeue():
    """手动触发一次恢复。正常情况下不需要调 —— worker 启动时会自动跑。"""
    from app.services.background_tasks import requeue_stale_tasks

    return requeue_stale_tasks()


@router.get("/thumbnails/status")
def thumbnail_status():
    """缩略图补齐进度。

    inflight = 排队中 + 正在生成的数量。
    前端可以轮询这个接口显示「还剩 N 个」。
    """
    from app.services.thumbnail_worker import get_thumbnail_worker

    return get_thumbnail_worker().status()


@router.post("/thumbnails/rescan")
def thumbnail_rescan(limit: int = 200):
    """扫库并投递缺失的缩略图任务。

    和 /rescan 的区别：/rescan 是全量重扫视频库（慢，会改 DB 记录），
    这个只查「thumbnail 为空」的视频，投给后台线程池，立即返回。
    """
    from app.services.thumbnail_worker import get_thumbnail_worker

    added = get_thumbnail_worker().submit_missing(limit=max(1, min(limit, 2000)))
    return {"queued": added, **get_thumbnail_worker().status()}


@router.post("/thumbnails/retry/{video_id}")
def thumbnail_retry(video_id: int):
    """重置失败计数并立刻重试一张。

    自动重试到 MAX_THUMBNAIL_ATTEMPTS 就放弃了（损坏的文件重试多少次都一样）。
    换掉了视频文件、或怀疑是临时故障（磁盘忙、挂载没就绪）时，用这个重来。
    """
    from app.database import SessionLocal
    from app.models import Video
    from app.services.thumbnail_worker import get_thumbnail_worker

    db = SessionLocal()
    try:
        video = db.query(Video).filter(Video.id == video_id).first()
        if video is None:
            raise HTTPException(status_code=404, detail="视频不存在")
        video.thumbnail_attempts = 0
        video.thumbnail_failed_at = None
        db.commit()
    finally:
        db.close()

    queued = get_thumbnail_worker().submit([video_id])
    return {"video_id": video_id, "queued": queued, "attempts_reset": True}


@router.post("/thumbnails/retry-failed")
def thumbnail_retry_failed(limit: int = 500):
    """把所有「已放弃」的视频计数清零，让扫描重新捡起它们。

    典型场景：视频盘重新挂载后，之前因为读不到文件而失败的一批可以重来。
    """
    from sqlalchemy import text

    from app.database import engine
    from app.services.thumbnail_worker import MAX_THUMBNAIL_ATTEMPTS

    with engine.begin() as conn:
        result = conn.execute(
            text(
                "UPDATE videos SET thumbnail_attempts = 0, thumbnail_failed_at = NULL "
                "WHERE thumbnail_attempts >= :max_attempts AND thumbnail IS NULL"
            ),
            {"max_attempts": MAX_THUMBNAIL_ATTEMPTS},
        )
        reset = result.rowcount or 0
    return {"reset": reset, "note": "下一轮扫描会重新投递"}


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
    data = load_assistant_runtime_settings()
    # 密钥一律不回明文，只告诉前端「有值 / 没值」
    data["local_api_key"] = _mask(data.get("local_api_key") or "")
    data["external_api_key"] = _mask(data.get("external_api_key") or "")
    return AssistantRuntimeSettingsOut(**data)


@router.put("/assistant-settings", response_model=AssistantRuntimeSettingsOut)
def save_assistant_runtime_settings(payload: AssistantRuntimeSettingsIn):
    current = load_assistant_runtime_settings()
    updates = payload.model_dump(exclude_unset=True)

    # 掩码占位表示「前端没改这一项」，保留库里的真实值
    for key in ("local_api_key", "external_api_key"):
        if key in updates:
            updates[key] = _unmask(updates[key], current.get(key) or "")

    # 地址填错（比如少写 http://）在保存时就拦下来，
    # 而不是等用户点「扫描模型」才收到一句看不懂的上游报错。
    for key in ("local_base_url", "external_base_url"):
        raw = (updates.get(key) or "").strip()
        if raw and not raw.startswith(("http://", "https://")):
            label = "本地" if key == "local_base_url" else "外部"
            raise HTTPException(
                status_code=422,
                detail=f"{label} LLM 接口地址必须以 http:// 或 https:// 开头（当前是 {raw[:80]}）",
            )

    next_settings = persist_assistant_runtime_settings({**current, **updates})
    if "llm_usage_policy" in updates:
        transcription = load_transcription_settings()
        persist_transcription_settings({**transcription, "llm_usage_policy": next_settings["llm_usage_policy"]})

    response = dict(next_settings)
    response["local_api_key"] = _mask(response.get("local_api_key") or "")
    response["external_api_key"] = _mask(response.get("external_api_key") or "")
    return AssistantRuntimeSettingsOut(**response)


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


# ---------------------------------------------------------------------------
# 用户管理
#
# 这些端点在 router 级 require_admin 之下，所以不用重复声明依赖。
# 但有几个「自伤」操作必须显式拦住：把自己降级、停用或删掉最后一个管理员，
# 一旦发生就没人能再进管理端，只能改数据库。
# ---------------------------------------------------------------------------


def _admin_count(db: Session, exclude_id: int | None = None) -> int:
    query = db.query(func.count(User.id)).filter(User.role == "admin", User.is_active.is_(True))
    if exclude_id is not None:
        query = query.filter(User.id != exclude_id)
    return int(query.scalar() or 0)


@router.get("/users", response_model=list[AdminUserOut])
def list_users(limit: int = Query(100, ge=1, le=500)):
    db = SessionLocal()
    try:
        rows = db.query(User).order_by(User.id).limit(limit).all()
        ids = [u.id for u in rows]
        event_counts = dict(
            db.query(WatchEvent.user_id, func.count(WatchEvent.id))
            .filter(WatchEvent.user_id.in_(ids))
            .group_by(WatchEvent.user_id)
            .all()
        ) if ids else {}
        path_counts = dict(
            db.query(LearningPath.user_id, func.count(LearningPath.id))
            .filter(LearningPath.user_id.in_(ids))
            .group_by(LearningPath.user_id)
            .all()
        ) if ids else {}
        return [
            AdminUserOut(
                id=u.id,
                username=u.username,
                display_name=u.display_name,
                role=u.role or "member",
                is_active=bool(u.is_active),
                last_login_at=u.last_login_at.isoformat() if u.last_login_at else None,
                created_at=u.created_at.isoformat() if u.created_at else None,
                watch_events=int(event_counts.get(u.id, 0)),
                learning_paths=int(path_counts.get(u.id, 0)),
            )
            for u in rows
        ]
    finally:
        db.close()


@router.patch("/users/{user_id}", response_model=AdminUserOut)
def update_user(
    user_id: int,
    payload: AdminUserUpdate,
    admin: User = Depends(require_admin),
):
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")

        updates = payload.model_dump(exclude_unset=True)

        if "role" in updates and updates["role"] != "admin":
            if user.id == admin.id:
                raise HTTPException(status_code=400, detail="不能降级自己，请让另一个管理员操作")
            if _admin_count(db, exclude_id=user.id) == 0:
                raise HTTPException(status_code=400, detail="至少要保留一个启用的管理员")

        if "is_active" in updates and updates["is_active"] is False:
            if user.id == admin.id:
                raise HTTPException(status_code=400, detail="不能停用自己")
            if _admin_count(db, exclude_id=user.id) == 0:
                raise HTTPException(status_code=400, detail="至少要保留一个启用的管理员")
            # 停用即踢下线：令牌版本 +1，已签发的全部失效
            user.token_version = int(user.token_version or 0) + 1

        for key, value in updates.items():
            setattr(user, key, value)

        db.commit()
        db.refresh(user)
        logger.info("管理员 %s 修改用户 %s: %s", admin.username, user.username, updates)
        return AdminUserOut(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            role=user.role or "member",
            is_active=bool(user.is_active),
            last_login_at=user.last_login_at.isoformat() if user.last_login_at else None,
            created_at=user.created_at.isoformat() if user.created_at else None,
        )
    finally:
        db.close()


@router.post("/users/{user_id}/reset-password")
def reset_user_password(
    user_id: int,
    payload: AdminPasswordReset,
    admin: User = Depends(require_admin),
):
    """管理员重置他人密码。旧令牌全部作废，用户需用新密码重新登录。"""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        user.password_hash = hash_password(payload.new_password)
        user.token_version = int(user.token_version or 0) + 1
        db.commit()
        logger.info("管理员 %s 重置了用户 %s 的密码", admin.username, user.username)
        return {"ok": True, "message": "密码已重置，该用户的登录状态已全部失效"}
    finally:
        db.close()


@router.delete("/users/{user_id}")
def delete_user(user_id: int, admin: User = Depends(require_admin)):
    """删除账号及其个人数据。视频库、字幕、向量等共享资源不受影响。"""
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="不能删除自己")

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        if (user.role or "") == "admin" and _admin_count(db, exclude_id=user.id) == 0:
            raise HTTPException(status_code=400, detail="不能删除最后一个启用的管理员")

        # 外键没有 ON DELETE CASCADE，按依赖顺序手工清
        path_ids = [
            row[0] for row in db.query(LearningPath.id).filter(LearningPath.user_id == user_id).all()
        ]
        if path_ids:
            db.query(LearningPathStep).filter(LearningPathStep.path_id.in_(path_ids)).delete(
                synchronize_session=False
            )
        db.query(LearningPath).filter(LearningPath.user_id == user_id).delete(synchronize_session=False)
        db.query(LearningGoal).filter(LearningGoal.user_id == user_id).delete(synchronize_session=False)
        db.query(WatchEvent).filter(WatchEvent.user_id == user_id).delete(synchronize_session=False)
        db.query(WatchHistory).filter(WatchHistory.user_id == user_id).delete(synchronize_session=False)
        db.query(UserProfile).filter(UserProfile.user_id == user_id).delete(synchronize_session=False)
        session_ids = [
            row[0] for row in db.query(ChatSession.id).filter(ChatSession.user_id == user_id).all()
        ]
        if session_ids:
            db.query(ChatMessage).filter(ChatMessage.session_id.in_(session_ids)).delete(
                synchronize_session=False
            )
        db.query(ChatSession).filter(ChatSession.user_id == user_id).delete(synchronize_session=False)
        db.query(UserData).filter(UserData.user_id == user_id).delete(synchronize_session=False)
        db.query(ScheduleItem).filter(ScheduleItem.user_id == user_id).delete(synchronize_session=False)
        # 这三张表也有 user_id 外键，之前漏了 —— 只要用户有其中任一数据，
        # 删除就会撞外键约束，接口直接 500。
        db.query(CalendarEvent).filter(CalendarEvent.user_id == user_id).delete(synchronize_session=False)
        db.query(MemoryItem).filter(MemoryItem.user_id == user_id).delete(synchronize_session=False)
        db.query(Note).filter(Note.user_id == user_id).delete(synchronize_session=False)
        db.delete(user)
        db.commit()
        logger.info("管理员 %s 删除了用户 %s（id=%s）", admin.username, user.username, user_id)
        return {"ok": True, "deleted_user_id": user_id}
    finally:
        db.close()
