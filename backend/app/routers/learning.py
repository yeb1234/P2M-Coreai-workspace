"""学习路径与目标 API。

规划一次要 20-30 秒（多次 LLM 调用 + 检索），同步接口必然超时，
因此 POST /paths/generate 只创建任务并立即返回 run_id，
前端轮询 GET /runs/{run_id} 取结果。

稳定性设计
----------
1. 去重：同一用户对同一目标重复点「生成」，直接复用正在跑的任务，
   而不是再排一个 30 秒的重任务。
2. 并发上限：进程内同时在跑的规划任务不超过 MAX_INFLIGHT，
   超出直接 429 而不是排队 —— 排队 5 分钟后才失败比立刻拒绝更糟。
3. 僵尸清理：进程重启会让 running 记录永远卡住。超过 STALE_MINUTES
   未完成的一律标记失败，前端才不会无限转圈。
"""

from __future__ import annotations

import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import desc, func

from app.agents.plan_agent import generate_learning_path
from app.auth import get_current_user
from app.database import SessionLocal
from app.models import AgentRun, LearningGoal, LearningPath, LearningPathStep, User, Video
from app.services.profile import get_profile_data
from app.services.quota import plan_quota_for, quota_exceeded_detail
from app.services.rate_limit import plan_limiter
from app.utils.files import unique_suffix

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/learning", tags=["learning"])

# 规划是重任务，限制并发避免把 LLM 额度打爆
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="plan")
MAX_INFLIGHT = 4
STALE_MINUTES = 15

_inflight = 0
_inflight_lock = threading.Lock()


class GoalCreate(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    target_role: str = ""
    deadline: str = ""
    weekly_hours: float = Field(default=10.0, gt=0, le=80)
    skills: list[str] = []


class PathGenerateRequest(GoalCreate):
    pass


class StepUpdate(BaseModel):
    status: str = Field(pattern="^(pending|in_progress|done|skipped)$")
    reflection: str = ""


class PathStatusUpdate(BaseModel):
    status: str = Field(pattern="^(draft|active|completed|archived)$")


def _reap_stale_runs(db) -> int:
    """把卡住的 running 任务标记为失败。

    uvicorn 重启（改代码、容器重建）会直接丢掉进程内的线程池，
    数据库里的 running 记录没人会再更新它。
    """
    cutoff = datetime.now() - timedelta(minutes=STALE_MINUTES)
    count = (
        db.query(AgentRun)
        .filter(
            AgentRun.kind == "plan",
            AgentRun.status == "running",
            AgentRun.created_at < cutoff,
        )
        .update(
            {"status": "failed", "error": "任务超时未完成（服务可能重启过），请重新生成"},
            synchronize_session=False,
        )
    )
    if count:
        db.commit()
        logger.warning("清理僵尸规划任务 %s 条", count)
    return count


def _video_lookup(db, video_ids: list[int]) -> dict[int, dict]:
    if not video_ids:
        return {}
    rows = (
        db.query(Video.id, Video.title, Video.duration, Video.category_id)
        .filter(Video.id.in_(set(video_ids)))
        .all()
    )
    return {
        int(row[0]): {
            "id": int(row[0]),
            "title": row[1],
            "duration": row[2],
            "category_id": row[3],
        }
        for row in rows
    }


def _serialize_path(path: LearningPath, videos: dict[int, dict] | None = None) -> dict:
    videos = videos or {}
    steps = []
    for step in path.steps:
        ids = [int(v) for v in (step.video_ids or [])]
        steps.append(
            {
                "id": step.id,
                "order_index": step.order_index,
                "title": step.title,
                "objective": step.objective,
                "video_ids": ids,
                # 前端要显示视频名并支持点击跳转，只给 id 没法渲染
                "videos": [videos[v] for v in ids if v in videos],
                "est_minutes": step.est_minutes,
                "status": step.status,
                "reflection": step.reflection,
            }
        )

    done = sum(1 for s in steps if s["status"] == "done")
    return {
        "id": path.id,
        "goal_id": path.goal_id,
        "title": path.title,
        "summary": path.summary,
        "status": path.status,
        "total_est_minutes": path.total_est_minutes,
        "created_at": path.created_at.isoformat() if path.created_at else None,
        "progress": {
            "done": done,
            "total": len(steps),
            "percent": round(done / len(steps) * 100) if steps else 0,
            "done_minutes": sum(s["est_minutes"] for s in steps if s["status"] == "done"),
        },
        "steps": steps,
    }


def _load_path_for_user(db, path_id: str, user: User) -> LearningPath:
    path = db.query(LearningPath).filter(LearningPath.id == path_id).first()
    if not path:
        raise HTTPException(status_code=404, detail="路径不存在")
    # 越权访问一律按「不存在」处理，避免通过 404/403 差异探测别人的路径 id。
    # 无主路径只允许 admin 处理迁移；admin 不是内容绕过角色，别人的路径照样 404。
    is_admin = (user.role or "") == "admin"
    if path.user_id is None:
        if not is_admin:
            raise HTTPException(status_code=404, detail="路径不存在")
    elif path.user_id != user.id:
        raise HTTPException(status_code=404, detail="路径不存在")
    return path


@router.get("/profile")
def get_profile(user: User = Depends(get_current_user)):
    """学习画像：观看时长、完成率、投入领域、活跃时段。"""
    db = SessionLocal()
    try:
        return get_profile_data(db, user.id)
    finally:
        db.close()


@router.get("/journey")
def get_journey(user: User = Depends(get_current_user)):
    """学习轨迹：等级、成就、热力图。

    和 /profile 的区别：profile 是给 Agent 判断该学什么用的，
    journey 是给人看的 —— 关心的是「我走到哪了」，不是「我该学什么」。
    数据来自五个源：观看、完成、笔记、日程、番茄钟。
    """
    from app.services.journey import build_journey

    db = SessionLocal()
    try:
        return build_journey(db, user.id)
    finally:
        db.close()


@router.get("/goals")
def list_goals(
    limit: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        rows = (
            db.query(LearningGoal)
            .filter(LearningGoal.user_id == user.id, LearningGoal.status != "archived")
            .order_by(desc(LearningGoal.updated_at))
            .limit(limit)
            .all()
        )
        return [
            {
                "id": row.id,
                "title": row.title,
                "target_role": row.target_role,
                "deadline": row.deadline.isoformat() if row.deadline else None,
                "weekly_hours": row.weekly_hours,
                "status": row.status,
                "skills": row.skills or [],
            }
            for row in rows
        ]
    finally:
        db.close()


@router.post("/goals")
def create_goal(payload: GoalCreate, user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        deadline = None
        if payload.deadline:
            try:
                deadline = date.fromisoformat(payload.deadline)
            except ValueError:
                raise HTTPException(status_code=422, detail="deadline 需要 YYYY-MM-DD 格式")

        goal = LearningGoal(
            id=unique_suffix(),
            user_id=user.id,
            title=payload.title,
            target_role=payload.target_role,
            deadline=deadline,
            weekly_hours=payload.weekly_hours,
            status="active",
            skills=[{"skill": s, "level": "missing", "weight": 1.0} for s in payload.skills],
        )
        db.add(goal)
        db.commit()
        db.refresh(goal)
        return {"id": goal.id, "title": goal.title}
    finally:
        db.close()


@router.post("/paths/generate")
def generate_path(payload: PathGenerateRequest, user: User = Depends(get_current_user)):
    """提交规划任务，立即返回 run_id。"""
    global _inflight

    allowed, _ = plan_limiter.hit(str(user.id))
    if not allowed:
        raise HTTPException(status_code=429, detail="生成太频繁了，等几分钟再试")

    # 先不扣配额：去重命中和并发 429 都不应该消耗当天额度。
    # 真正要创建 run 之前才 consume；异步失败再 refund。
    quota = plan_quota_for(user.role)
    db = SessionLocal()
    run_id = unique_suffix()
    quota_consumed = False
    try:
        _reap_stale_runs(db)

        # 去重：同一个人对同一个目标重复点，复用正在跑的那个
        recent_cutoff = datetime.now() - timedelta(minutes=STALE_MINUTES)
        existing = (
            db.query(AgentRun)
            .filter(
                AgentRun.kind == "plan",
                AgentRun.user_id == user.id,
                AgentRun.status == "running",
                AgentRun.input_text == payload.title,
                AgentRun.created_at >= recent_cutoff,
            )
            .order_by(desc(AgentRun.created_at))
            .first()
        )
        if existing:
            return {"run_id": existing.id, "status": "running", "deduplicated": True}

        with _inflight_lock:
            if _inflight >= MAX_INFLIGHT:
                raise HTTPException(
                    status_code=429,
                    detail="正在生成的路径太多了，请等当前任务完成",
                )
            _inflight += 1

        quota_ok, quota_used, quota_limit = quota.consume(user.id)
        if not quota_ok:
            with _inflight_lock:
                _inflight = max(0, _inflight - 1)
            raise HTTPException(
                status_code=429,
                detail=quota_exceeded_detail(quota_used, quota_limit, "路径生成"),
            )
        quota_consumed = True

        try:
            db.add(
                AgentRun(
                    id=run_id,
                    kind="plan",
                    user_id=user.id,
                    status="running",
                    input_text=payload.title,
                )
            )
            db.commit()
        except Exception:
            with _inflight_lock:
                _inflight = max(0, _inflight - 1)
            if quota_consumed:
                quota.refund(user.id)
            raise
    finally:
        db.close()

    def _work() -> None:
        global _inflight
        started = time.perf_counter()
        db2 = SessionLocal()
        success = False
        try:
            result = generate_learning_path(
                goal_title=payload.title,
                target_role=payload.target_role,
                deadline=payload.deadline,
                weekly_hours=payload.weekly_hours,
                skills=payload.skills,
                user_id=user.id,
            )
            run = db2.query(AgentRun).filter(AgentRun.id == run_id).first()
            if run:
                run.status = "completed" if result.get("ok") else "failed"
                run.output_text = json.dumps(result, ensure_ascii=False)[:8000]
                run.error = result.get("error")
                run.latency_ms = round((time.perf_counter() - started) * 1000)
                db2.commit()
            success = bool(result.get("ok"))
        except Exception as exc:
            logger.exception("路径规划失败")
            try:
                run = db2.query(AgentRun).filter(AgentRun.id == run_id).first()
                if run:
                    run.status = "failed"
                    run.error = str(exc)[:1000]
                    db2.commit()
            except Exception:
                logger.exception("回写失败状态也失败了")
        finally:
            db2.close()
            if not success:
                # 生成失败（模型报错/无有效路径）退还当天额度；
                # 成功才真正消耗一次。
                quota.refund(user.id)
            with _inflight_lock:
                _inflight = max(0, _inflight - 1)

    try:
        _executor.submit(_work)
    except Exception:
        # 线程池拒绝（极少见）：run 已落库但没人执行，回写失败并退额度。
        with _inflight_lock:
            _inflight = max(0, _inflight - 1)
        quota.refund(user.id)
        db2 = SessionLocal()
        try:
            run = db2.query(AgentRun).filter(AgentRun.id == run_id).first()
            if run:
                run.status = "failed"
                run.error = "任务线程提交失败"
                db2.commit()
        finally:
            db2.close()
        raise
    return {"run_id": run_id, "status": "running"}


@router.get("/runs/{run_id}")
def get_run(run_id: str, user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        run = db.query(AgentRun).filter(AgentRun.id == run_id).first()
        if not run:
            raise HTTPException(status_code=404, detail="任务不存在")
        # 无主 run 只允许 admin 做迁移/清理；admin 不是内容绕过角色，
        # 别人名下的 run 仍然 404。
        is_admin = (user.role or "") == "admin"
        if run.user_id is None:
            if not is_admin:
                raise HTTPException(status_code=404, detail="任务不存在")
        elif run.user_id != user.id:
            raise HTTPException(status_code=404, detail="任务不存在")

        payload = None
        if run.output_text:
            try:
                payload = json.loads(run.output_text)
            except json.JSONDecodeError:
                payload = None
        return {
            "run_id": run.id,
            "status": run.status,
            "result": payload,
            "error": run.error,
            "latency_ms": run.latency_ms,
        }
    finally:
        db.close()


@router.get("/paths")
def list_paths(
    limit: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        rows = (
            db.query(LearningPath)
            .filter(LearningPath.user_id == user.id, LearningPath.status != "archived")
            .order_by(desc(LearningPath.created_at))
            .limit(limit)
            .all()
        )
        all_ids = [int(v) for path in rows for step in path.steps for v in (step.video_ids or [])]
        videos = _video_lookup(db, all_ids)
        return [_serialize_path(row, videos) for row in rows]
    finally:
        db.close()


@router.get("/paths/active")
def get_active_path(user: User = Depends(get_current_user)):
    """当前正在推进的路径。前端 TAB 首屏与 Agent 上下文都用它。"""
    db = SessionLocal()
    try:
        path = (
            db.query(LearningPath)
            .filter(LearningPath.user_id == user.id, LearningPath.status.in_(["active", "draft"]))
            .order_by(desc(LearningPath.created_at))
            .first()
        )
        if not path:
            return {"path": None}
        all_ids = [int(v) for step in path.steps for v in (step.video_ids or [])]
        return {"path": _serialize_path(path, _video_lookup(db, all_ids))}
    finally:
        db.close()


@router.get("/paths/{path_id}")
def get_path(path_id: str, user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        path = _load_path_for_user(db, path_id, user)
        all_ids = [int(v) for step in path.steps for v in (step.video_ids or [])]
        return _serialize_path(path, _video_lookup(db, all_ids))
    finally:
        db.close()


@router.patch("/paths/{path_id}")
def update_path_status(
    path_id: str,
    payload: PathStatusUpdate,
    user: User = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        path = _load_path_for_user(db, path_id, user)
        path.status = payload.status
        db.commit()
        return {"id": path.id, "status": path.status}
    finally:
        db.close()


@router.patch("/steps/{step_id}")
def update_step(
    step_id: str,
    payload: StepUpdate,
    user: User = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        step = db.query(LearningPathStep).filter(LearningPathStep.id == step_id).first()
        if not step:
            raise HTTPException(status_code=404, detail="步骤不存在")

        path = db.query(LearningPath).filter(LearningPath.id == step.path_id).first()
        if not path:
            raise HTTPException(status_code=404, detail="步骤不存在")
        if path.user_id is not None and path.user_id != user.id and (user.role or "") != "admin":
            raise HTTPException(status_code=404, detail="步骤不存在")

        step.status = payload.status
        if payload.reflection:
            step.reflection = payload.reflection[:2000]

        # 必须先 flush。
        #
        # sessionmaker 配了 autoflush=False（database.py），所以上面那行
        # 只改了内存里的对象，数据库里仍是旧状态。紧接着的 COUNT 走的是
        # 数据库，看不到这次修改 —— 把最后一步改成 done 时 siblings 仍然是 1，
        # `siblings == 0` 永远不成立，「全部完成后自动收口」从未生效过，
        # 路径永远停在 active（前端进度 100% 但状态不是 completed）。
        db.flush()

        # 全部完成时自动收口，否则路径会永远停在 active
        siblings = (
            db.query(func.count(LearningPathStep.id))
            .filter(LearningPathStep.path_id == path.id, LearningPathStep.status != "done")
            .scalar()
            or 0
        )
        if siblings == 0 and path.status in ("active", "draft"):
            path.status = "completed"

        db.commit()
        return {"id": step.id, "status": step.status, "path_status": path.status}
    finally:
        db.close()
