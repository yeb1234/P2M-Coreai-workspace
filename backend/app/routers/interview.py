"""面试题库后端：AI 评估、练习记录、题目学习状态。

题库数据本身留在前端静态 JSON（版本随代码走，便于面试前直接改题）。
这里只做三件需要服务端的事：
1. 调 LLM 评估答案（外部/本地两条通道 + 每日额度）
2. 把每次作答落库，支撑错题本、能力雷达、面试 Agent 的长期记忆
3. 收藏 / 掌握 / 自评状态跨设备同步

安全边界：
- 所有接口都要登录，评估接口额外限流 + 每日额度，避免连点把模型额度打爆。
- 评分是辅助，不是裁决；前端会同时展示参考答案和 rubric，不把分数当唯一标准。
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import InterviewAttempt, InterviewCardState, InterviewQuestionReport, User
from app.services import interview_library
from app.services.interview_ai import InterviewAIError, evaluate_answer
from app.services.interview_kb_compare import (
    KBCompareError,
    baseline_payload,
    compare_kb,
)
from app.services.quota import ai_daily_quota_for, quota_exceeded_detail
from app.services.rate_limit import ai_daily_limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/interview", tags=["interview"])


class EvaluateIn(BaseModel):
    question_id: str = Field(min_length=1, max_length=80)
    question: str = Field(min_length=5, max_length=2_000)
    reference: str = Field(default="", max_length=6_000)
    answer: str = Field(min_length=8, max_length=12_000)
    qtype: str = Field(default="concept", max_length=30)
    difficulty: str = Field(default="中档", max_length=20)
    title: str = Field(default="", max_length=240)
    group_key: str = Field(default="", max_length=40)
    project_context: str = Field(default="", max_length=4_000)


class KBCompareIn(BaseModel):
    profile: str = Field(min_length=20, max_length=12_000)


class ProgressIn(BaseModel):
    question_id: str = Field(min_length=1, max_length=80)
    starred: bool | None = None
    mastered: bool | None = None
    confidence: int | None = Field(default=None, ge=0, le=2)


class QuestionReportIn(BaseModel):
    question_id: str = Field(min_length=1, max_length=80)
    reason: str = Field(min_length=1, max_length=30)
    detail: str = Field(default="", max_length=1200)


_REPORT_REASONS = {"stem", "answer", "rubric", "classification", "typo", "other"}


def _report_dict(row: InterviewQuestionReport) -> dict:
    return {
        "id": row.id,
        "questionId": row.question_id,
        "questionTitle": row.question_title,
        "reason": row.reason,
        "detail": row.detail or "",
        "status": row.status,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "resolvedAt": row.resolved_at.isoformat() if row.resolved_at else None,
    }


@router.get("/library")
def interview_library_meta(user: User = Depends(get_current_user)):
    """题库/知识库元信息：首屏只取计数和分组，不再把整包 JSON 塞进 JS。"""
    return interview_library.library_meta()


@router.get("/questions")
def list_interview_questions(
    q: str = Query(default="", max_length=120),
    group: str = Query(default="", max_length=40),
    qtype: str = Query(default="", max_length=40),
    source: str = Query(default="", max_length=40),
    offset: int = Query(default=0, ge=0, le=10000),
    limit: int = Query(default=60, ge=1, le=400),
    user: User = Depends(get_current_user),
):
    """分页题目摘要；参考答案只在详情接口返回。"""
    return interview_library.list_question_summaries(
        query=q,
        group=group,
        qtype=qtype,
        source=source,
        offset=offset,
        limit=limit,
    )


@router.get("/questions/random")
def random_interview_question(user: User = Depends(get_current_user)):
    question = interview_library.random_question()
    if question is None:
        raise HTTPException(status_code=404, detail="题库为空")
    return question


@router.get("/questions/{question_id}")
def get_interview_question(
    question_id: str,
    user: User = Depends(get_current_user),
):
    question = interview_library.question_detail(question_id)
    if question is None:
        raise HTTPException(status_code=404, detail="题目不存在")
    return question


@router.get("/knowledge")
def list_interview_knowledge(user: User = Depends(get_current_user)):
    return interview_library.list_knowledge_summaries()


@router.get("/knowledge/{article_id}")
def get_interview_knowledge(
    article_id: str,
    user: User = Depends(get_current_user),
):
    article = interview_library.knowledge_detail(article_id)
    if article is None:
        raise HTTPException(status_code=404, detail="知识库文章不存在")
    return article


@router.get("/search")
def search_interview_library(
    q: str = Query(default="", max_length=120),
    limit: int = Query(default=8, ge=1, le=20),
    user: User = Depends(get_current_user),
):
    return interview_library.search_library(q, limit=limit)


def _get_state(db: Session, user_id: int, question_id: str) -> InterviewCardState | None:
    return (
        db.query(InterviewCardState)
        .filter(
            InterviewCardState.user_id == user_id,
            InterviewCardState.question_id == question_id,
        )
        .first()
    )


def _ensure_state(db: Session, user_id: int, question_id: str) -> InterviewCardState:
    state = _get_state(db, user_id, question_id)
    if state is None:
        state = InterviewCardState(user_id=user_id, question_id=question_id)
        db.add(state)
        db.flush()
    return state


def _state_dict(state: InterviewCardState) -> dict:
    return {
        "questionId": state.question_id,
        "starred": bool(state.starred),
        "mastered": bool(state.mastered),
        "confidence": int(state.confidence or 0),
        "lastScore": state.last_score,
        "practiceCount": int(state.practice_count or 0),
        "lastPracticedAt": state.last_practiced_at.isoformat() if state.last_practiced_at else None,
    }


@router.post("/evaluate")
def evaluate(
    payload: EvaluateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """评估一次作答。同步返回，超时由前端控制；失败不扣额度。"""
    allowed, _ = ai_daily_limiter.hit(f"user:{user.id}")
    if not allowed:
        raise HTTPException(status_code=429, detail="评估请求太频繁，缓一分钟再试")

    quota = ai_daily_quota_for(user.role)
    ok, used, limit = quota.consume(user.id)
    if not ok:
        raise HTTPException(
            status_code=429,
            detail=quota_exceeded_detail(used, limit, "面试 AI 评估"),
        )

    try:
        result = evaluate_answer(
            question=payload.question,
            reference=payload.reference,
            answer=payload.answer,
            qtype=payload.qtype,
            difficulty=payload.difficulty,
            project_context=payload.project_context,
        )
    except InterviewAIError as exc:
        quota.refund(user.id)
        logger.warning("面试评估失败 user=%s question=%s: %s", user.id, payload.question_id, exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 —— 未预期错误也要退额度
        quota.refund(user.id)
        logger.exception("面试评估异常 user=%s question=%s", user.id, payload.question_id)
        raise HTTPException(status_code=502, detail="AI 评估服务异常，请稍后重试") from exc

    attempt = InterviewAttempt(
        user_id=user.id,
        question_id=payload.question_id,
        group_key=payload.group_key or None,
        question_title=(payload.title or payload.question)[:240],
        mode="evaluate",
        answer=payload.answer,
        score=int(result["score"]),
        verdict=result["verdict"],
        feedback={
            "dimensions": result["dimensions"],
            "strengths": result["strengths"],
            "gaps": result["gaps"],
            "rewrite": result["rewrite"],
            "followUps": result["followUps"],
        },
        provider=result.get("provider"),
        model=result.get("model"),
        latency_ms=result.get("latencyMs"),
    )
    db.add(attempt)

    state = _ensure_state(db, user.id, payload.question_id)
    state.last_score = int(result["score"])
    state.practice_count = int(state.practice_count or 0) + 1
    state.last_practiced_at = datetime.now()
    if result["verdict"] == "pass" and int(result["score"]) >= 80:
        # 只做「及格线以上自动标记」的弱收口；用户仍可手动改回未掌握。
        state.mastered = True
        state.confidence = max(int(state.confidence or 0), 2)

    db.commit()
    db.refresh(attempt)
    return {
        "attemptId": attempt.id,
        "score": result["score"],
        "verdict": result["verdict"],
        "dimensions": result["dimensions"],
        "strengths": result["strengths"],
        "gaps": result["gaps"],
        "rewrite": result["rewrite"],
        "followUps": result["followUps"],
        "provider": result.get("provider"),
        "model": result.get("model"),
        "latencyMs": result.get("latencyMs"),
        "state": _state_dict(state),
        "quota": {"used": used, "limit": limit},
    }


@router.get("/kb-baseline")
def kb_baseline(user: User = Depends(get_current_user)):
    """P5 知识库复杂度基线。前端先展示基线，再让考生贴方案对比。"""
    return baseline_payload()


@router.post("/kb-compare")
def kb_compare(
    payload: KBCompareIn,
    user: User = Depends(get_current_user),
):
    """考生知识库方案 vs 我的 P5：八维评分、加权总分、胜负结论。"""
    allowed, _ = ai_daily_limiter.hit(f"user:{user.id}")
    if not allowed:
        raise HTTPException(status_code=429, detail="对标请求太频繁，缓一分钟再试")

    quota = ai_daily_quota_for(user.role)
    ok, used, limit = quota.consume(user.id)
    if not ok:
        raise HTTPException(
            status_code=429,
            detail=quota_exceeded_detail(used, limit, "P5 知识库对标"),
        )

    try:
        result = compare_kb(payload.profile)
    except KBCompareError as exc:
        quota.refund(user.id)
        logger.warning("P5 对标失败 user=%s: %s", user.id, exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        quota.refund(user.id)
        logger.exception("P5 对标异常 user=%s", user.id)
        raise HTTPException(status_code=502, detail="P5 对标服务异常，请稍后重试") from exc

    return {**result, "quota": {"used": used, "limit": limit}}


@router.get("/progress")
def list_progress(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(InterviewCardState)
        .filter(InterviewCardState.user_id == user.id)
        .order_by(InterviewCardState.updated_at.desc())
        .limit(2_000)
        .all()
    )
    return {"items": [_state_dict(row) for row in rows]}


@router.post("/progress")
def upsert_progress(
    payload: ProgressIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    state = _ensure_state(db, user.id, payload.question_id)
    if payload.starred is not None:
        state.starred = payload.starred
    if payload.mastered is not None:
        state.mastered = payload.mastered
        if payload.mastered:
            state.confidence = max(int(state.confidence or 0), 2)
    if payload.confidence is not None:
        state.confidence = payload.confidence
        # 自评「掌握」不等于自动认定掌握；只有用户明确 mastered=true 才收口，
        # 避免误点一下就把题从复习队列里拿掉。
        if payload.confidence == 2 and payload.mastered is None:
            state.mastered = True
    db.commit()
    db.refresh(state)
    return _state_dict(state)


@router.get("/question-reports/{question_id}")
def get_my_question_report(
    question_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """当前用户是否已反馈过这道题；抽屉打开时用它恢复「已反馈」状态。"""
    latest = (
        db.query(InterviewQuestionReport)
        .filter(
            InterviewQuestionReport.user_id == user.id,
            InterviewQuestionReport.question_id == question_id,
        )
        .order_by(InterviewQuestionReport.created_at.desc())
        .first()
    )
    return {"reported": latest is not None, "latest": _report_dict(latest) if latest else None}


@router.post("/question-reports")
def create_question_report(
    payload: QuestionReportIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """记录题目纠错反馈，保留题目快照，改题后历史反馈仍有上下文。"""
    if payload.reason not in _REPORT_REASONS:
        raise HTTPException(status_code=422, detail="不支持的错误类型")
    detail = payload.detail.strip()
    if payload.reason == "other" and len(detail) < 5:
        raise HTTPException(status_code=422, detail="选择「其他」时请补充具体问题")

    question = interview_library.question_detail(payload.question_id)
    if question is None:
        raise HTTPException(status_code=404, detail="题目不存在")

    row = InterviewQuestionReport(
        user_id=user.id,
        question_id=payload.question_id,
        question_title=str(question.get("title") or "")[:240],
        reason=payload.reason,
        detail=detail or None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "report": _report_dict(row)}


@router.get("/attempts")
def list_attempts(
    limit: int = Query(default=20, ge=1, le=100),
    question_id: str | None = Query(default=None, max_length=80),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(InterviewAttempt).filter(InterviewAttempt.user_id == user.id)
    if question_id:
        query = query.filter(InterviewAttempt.question_id == question_id)
    rows = query.order_by(InterviewAttempt.created_at.desc()).limit(limit).all()
    return {
        "items": [
            {
                "id": row.id,
                "questionId": row.question_id,
                "questionTitle": row.question_title,
                "score": row.score,
                "verdict": row.verdict,
                "createdAt": row.created_at.isoformat() if row.created_at else None,
                "mode": row.mode,
            }
            for row in rows
        ]
    }


@router.get("/stats")
def stats(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    attempts = db.query(InterviewAttempt).filter(InterviewAttempt.user_id == user.id)
    total_attempts = attempts.count()
    avg_score = attempts.with_entities(func.avg(InterviewAttempt.score)).scalar()
    distinct_questions = (
        attempts.with_entities(func.count(func.distinct(InterviewAttempt.question_id))).scalar() or 0
    )
    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    today_attempts = attempts.filter(InterviewAttempt.created_at >= today_start).count()

    states = db.query(InterviewCardState).filter(InterviewCardState.user_id == user.id)
    mastered = states.filter(InterviewCardState.mastered.is_(True)).count()
    starred = states.filter(InterviewCardState.starred.is_(True)).count()

    # 最近 7 天活跃：用作答日期分桶，供前端画一条很小的节奏条。
    since = datetime.now() - timedelta(days=6)
    day_rows = (
        attempts.filter(InterviewAttempt.created_at >= since)
        .with_entities(
            func.date(InterviewAttempt.created_at).label("day"),
            func.count(InterviewAttempt.id).label("count"),
        )
        .group_by("day")
        .all()
    )
    by_day = {str(row.day): int(row.count) for row in day_rows}
    days = []
    for offset in range(6, -1, -1):
        day = (datetime.now() - timedelta(days=offset)).date().isoformat()
        days.append({"date": day, "count": by_day.get(day, 0)})

    return {
        "totalAttempts": total_attempts,
        "distinctQuestions": int(distinct_questions),
        "avgScore": round(float(avg_score), 1) if avg_score is not None else None,
        "todayAttempts": today_attempts,
        "mastered": mastered,
        "starred": starred,
        "days": days,
    }
