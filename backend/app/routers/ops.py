"""P2 Transcribe 控制面接口。

这些接口只给本机独立控制台使用，不暴露给主站前端：
- 认证使用 OPS_TOKEN，不走用户 Cookie；
- 所有写操作都复用主后端既有的批处理/队列服务，避免控制台直接改库；
- 控制台本身只负责展示与触发，不复制第二套流水线。
"""

from __future__ import annotations

import logging
import os
import secrets
import threading
import time
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db, settings
from app.models import Video
from app.routers.ai_jobs import batch_ai_jobs
from app.schemas import AiJobBatchCreate
from app.services.admin_ai_queue import ai_job_status_counts, ai_queue_state, pause_ai_queue, resume_ai_queue
from app.services.admin_library import rescan_library
from app.services.admin_settings import load_transcription_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ops", tags=["ops"])

_scan_lock = threading.Lock()
_scan_thread: threading.Thread | None = None
_scan_state: dict = {
    "running": False,
    "started_at": None,
    "finished_at": None,
    "target": None,
    "result": None,
    "error": None,
    "message": None,
}


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def require_ops_token(x_ops_token: str | None = Header(default=None)) -> None:
    """校验本机控制台令牌。

    OPS_TOKEN 为空时直接关闭接口，而不是退化成“没有密码也能转写”。
    """
    expected = (settings.ops_token or "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="OPS_TOKEN 未配置，P2 Transcribe 控制面已关闭")
    if not x_ops_token or not secrets.compare_digest(x_ops_token, expected):
        raise HTTPException(status_code=401, detail="OPS_TOKEN 无效")


def _target_path(raw_path: str | None) -> str | None:
    """把控制台传来的路径限制在视频库根目录内。

    允许三种写法：
    - 空：全库扫描；
    - `/videos/...`：容器内绝对路径；
    - `课程/子目录`：相对视频库根。

    不允许 `..` 或库外绝对路径，避免控制台误扫宿主机其他目录。
    """
    if not raw_path or not raw_path.strip():
        return None
    root = Path(os.path.normpath(os.path.abspath(settings.video_folder)))
    target = Path(raw_path.strip())
    if not target.is_absolute():
        target = root / target
    target = Path(os.path.normpath(os.path.abspath(target)))
    if target != root and not target.is_relative_to(root):
        raise HTTPException(status_code=400, detail="扫描路径必须在视频库根目录内")
    return str(target)


def _scan_worker(target: str | None) -> None:
    global _scan_thread
    # 启动扫描 / 轮询对账可能正持有扫描锁。控制台不该点一次就报 busy 失败，
    # 而是在锁释放后自动继续；最多等 10 分钟，之后明确报超时。
    deadline = time.monotonic() + 600
    attempt = 0
    try:
        while True:
            attempt += 1
            with _scan_lock:
                _scan_state.update(
                    running=True,
                    message="读取目录与入库中",
                )
            result = rescan_library(target=target)
            if result.get("status") != "busy":
                break
            if time.monotonic() >= deadline:
                result = {
                    "status": "timeout",
                    "added": 0,
                    "removed": 0,
                    "total": 0,
                    "scope": target,
                    "pruned": False,
                }
                break
            with _scan_lock:
                _scan_state.update(
                    running=True,
                    result=result,
                    message=f"等待当前扫描结束，已等待 {attempt} 轮",
                )
            time.sleep(5)
        with _scan_lock:
            _scan_state.update(
                running=False,
                finished_at=_now(),
                result=result,
                error=None if result.get("status") == "ok" else result.get("status"),
                message=None,
            )
    except Exception as exc:  # pragma: no cover - 真实扫描异常由运行环境触发
        logger.exception("P2 Transcribe scan failed")
        with _scan_lock:
            _scan_state.update(
                running=False,
                finished_at=_now(),
                result=None,
                error=str(exc),
                message=None,
            )
    finally:
        with _scan_lock:
            _scan_thread = None


@router.get("/health")
def ops_health(_token=Depends(require_ops_token)):
    return {
        "ok": True,
        "service": "p2-transcribe",
        "version": "7.2",
        "video_folder": settings.video_folder,
        "token_configured": bool((settings.ops_token or "").strip()),
    }


@router.get("/settings")
def ops_settings(_token=Depends(require_ops_token)):
    """控制台创建任务时套用主库里的转写默认值。"""
    return load_transcription_settings()


@router.get("/overview")
def ops_overview(_token=Depends(require_ops_token)):
    db = SessionLocal()
    try:
        has_sub = (
            db.query(Video)
            .filter(
                func.nullif(Video.subtitle_path, "").isnot(None)
                | func.nullif(Video.transcript_segments, "").isnot(None)
            )
            .count()
        )
        has_summary = (
            db.query(Video)
            .filter(func.nullif(Video.summary, "").isnot(None))
            .count()
        )
        total = db.query(Video).count()
        jobs = ai_job_status_counts(db)
    finally:
        db.close()
    return {
        "videos": {
            "total": total,
            "with_subtitles": has_sub,
            "without_subtitles": max(total - has_sub, 0),
            "with_summary": has_summary,
            "without_summary": max(total - has_summary, 0),
        },
        "jobs": jobs,
        "queue": ai_queue_state(),
    }


@router.get("/videos")
def ops_videos(
    mode: str = Query(default="missing_subtitles", pattern="^(missing_subtitles|missing_summary|unfinished|all)$"),
    limit: int = Query(default=50, ge=1, le=500),
    _token=Depends(require_ops_token),
):
    """返回可转入队的候选视频。

    只返回摘要字段，不把完整文件路径交给浏览器；控制台需要的是选择与计数。
    """
    db = SessionLocal()
    try:
        has_sub = (
            func.nullif(Video.subtitle_path, "").isnot(None)
            | func.nullif(Video.transcript_segments, "").isnot(None)
        )
        has_summary = func.nullif(Video.summary, "").isnot(None)
        query = db.query(Video)
        if mode == "missing_subtitles":
            query = query.filter(~has_sub)
        elif mode == "missing_summary":
            query = query.filter(has_sub, ~has_summary)
        elif mode == "unfinished":
            query = query.filter(~(has_sub & has_summary))
        total = query.count()
        rows = query.order_by(Video.id.desc()).limit(limit).all()
        items = [
            {
                "id": row.id,
                "title": row.title,
                "filename": Path(row.filepath or "").name,
                "duration": row.duration,
                "has_subtitles": bool(
                    (row.subtitle_path or "").strip() or (row.transcript_segments or "").strip()
                ),
                "has_summary": bool((row.summary or "").strip()),
                "ai_status": row.ai_status,
            }
            for row in rows
        ]
    finally:
        db.close()
    return {"mode": mode, "total": total, "items": items, "limit": limit}


@router.post("/scan")
def ops_scan(payload: dict | None = None, _token=Depends(require_ops_token)):
    """异步触发扫描。返回后前端轮询 /scan/status 即可。"""
    global _scan_thread
    target = _target_path((payload or {}).get("path"))
    with _scan_lock:
        if _scan_thread is not None and _scan_thread.is_alive():
            return {"started": False, "running": True, "message": "已有扫描在进行"}
        _scan_state.update(
            running=True,
            started_at=_now(),
            finished_at=None,
            target=target,
            result=None,
            error=None,
            message="已提交，等待扫描开始",
        )
        _scan_thread = threading.Thread(target=_scan_worker, args=(target,), daemon=True, name="p2-transcribe-scan")
        _scan_thread.start()
    return {"started": True, "running": True, "target": target}


@router.get("/scan/status")
def ops_scan_status(_token=Depends(require_ops_token)):
    with _scan_lock:
        return dict(_scan_state)


@router.post("/batch")
def ops_batch(
    payload: AiJobBatchCreate,
    db: Session = Depends(get_db),
    _token=Depends(require_ops_token),
):
    """把候选视频投进既有 AI 批处理服务。"""
    return batch_ai_jobs(payload, db=db, _admin=SimpleNamespace(role="admin", username="p2-transcribe"))


@router.get("/queue")
def ops_queue(_token=Depends(require_ops_token)):
    return ai_queue_state()


@router.post("/queue/pause")
def ops_queue_pause(_token=Depends(require_ops_token)):
    return pause_ai_queue()


@router.post("/queue/resume")
def ops_queue_resume(_token=Depends(require_ops_token)):
    return resume_ai_queue()
