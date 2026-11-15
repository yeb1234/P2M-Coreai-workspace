"""学习路径与目标 API。

规划一次要 20-30 秒（多次 LLM 调用 + 检索），同步接口必然超时，
因此 POST /paths/generate 只创建任务并立即返回 run_id，
前端轮询 GET /runs/{run_id} 取结果。
"""

from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import desc

from app.agents.plan_agent import generate_learning_path
from app.database import SessionLocal
from app.models import AgentRun, LearningGoal, LearningPath, LearningPathStep
from app.services.profile import profile_to_dict, recompute_profile
from app.utils.files import unique_suffix

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/learning", tags=["learning"])

# 规划是重任务，限制并发避免把 LLM 额度打爆
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="plan")


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


def _serialize_path(path: LearningPath) -> dict:
    return {
        "id": path.id,
        "goal_id": path.goal_id,
        "title": path.title,
        "summary": path.summary,
        "status": path.status,
        "total_est_minutes": path.total_est_minutes,
        "created_at": path.created_at.isoformat() if path.created_at else None,
        "steps": [
            {
                "id": step.id,
                "order_index": step.order_index,
                "title": step.title,
                "objective": step.objective,
                "video_ids": step.video_ids or [],
                "est_minutes": step.est_minutes,
                "status": step.status,
            }
            for step in path.steps
        ],
    }


@router.get("/profile")
def get_profile():
    """学习画像：观看时长、完成率、投入领域、活跃时段。"""
    db = SessionLocal()
    try:
        return profile_to_dict(recompute_profile(db, None))
    finally:
        db.close()


@router.get("/goals")
def list_goals(limit: int = Query(20, ge=1, le=100)):
    db = SessionLocal()
    try:
        rows = (
            db.query(LearningGoal)
            .filter(LearningGoal.status != "archived")
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
def create_goal(payload: GoalCreate):
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
def generate_path(payload: PathGenerateRequest):
    """提交规划任务，立即返回 run_id。"""
    run_id = unique_suffix()
    db = SessionLocal()
    try:
        db.add(
            AgentRun(
                id=run_id,
                kind="plan",
                status="running",
                input_text=payload.title,
            )
        )
        db.commit()
    finally:
        db.close()

    def _work() -> None:
        import time as _time

        started = _time.perf_counter()
        db2 = SessionLocal()
        try:
            result = generate_learning_path(
                goal_title=payload.title,
                target_role=payload.target_role,
                deadline=payload.deadline,
                weekly_hours=payload.weekly_hours,
                skills=payload.skills,
            )
            run = db2.query(AgentRun).filter(AgentRun.id == run_id).first()
            if run:
                run.status = "completed" if result.get("ok") else "failed"
                run.output_text = json.dumps(result, ensure_ascii=False)[:8000]
                run.error = result.get("error")
                run.latency_ms = round((_time.perf_counter() - started) * 1000)
                db2.commit()
        except Exception as exc:
            logger.exception("路径规划失败")
            run = db2.query(AgentRun).filter(AgentRun.id == run_id).first()
            if run:
                run.status = "failed"
                run.error = str(exc)[:1000]
                db2.commit()
        finally:
            db2.close()

    _executor.submit(_work)
    return {"run_id": run_id, "status": "running"}


@router.get("/runs/{run_id}")
def get_run(run_id: str):
    db = SessionLocal()
    try:
        run = db.query(AgentRun).filter(AgentRun.id == run_id).first()
        if not run:
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
def list_paths(limit: int = Query(20, ge=1, le=100)):
    db = SessionLocal()
    try:
        rows = (
            db.query(LearningPath)
            .filter(LearningPath.status != "archived")
            .order_by(desc(LearningPath.created_at))
            .limit(limit)
            .all()
        )
        return [_serialize_path(row) for row in rows]
    finally:
        db.close()


@router.get("/paths/{path_id}")
def get_path(path_id: str):
    db = SessionLocal()
    try:
        path = db.query(LearningPath).filter(LearningPath.id == path_id).first()
        if not path:
            raise HTTPException(status_code=404, detail="路径不存在")
        return _serialize_path(path)
    finally:
        db.close()


@router.patch("/steps/{step_id}")
def update_step(step_id: str, payload: StepUpdate):
    db = SessionLocal()
    try:
        step = db.query(LearningPathStep).filter(LearningPathStep.id == step_id).first()
        if not step:
            raise HTTPException(status_code=404, detail="步骤不存在")
        step.status = payload.status
        if payload.reflection:
            step.reflection = payload.reflection[:2000]
        db.commit()
        return {"id": step.id, "status": step.status}
    finally:
        db.close()
