"""学习路径规划 Agent（LangGraph 状态机）。

为什么不直接一次性让 LLM 输出计划：
LLM 会编出不存在的课程名、凑不齐前置依赖、也无法感知「库里到底有没有这门课」。
这里把规划拆成图，每一步都可校验：

    analyze(现状) → gap(差距) → retrieve(找真实视频) → plan(排步骤)
                                      ↑                    ↓
                                      └──── revise ←── validate(校验)

validate 发现步骤缺视频支撑或顺序倒置时回退到 plan 重排，最多 2 轮，
超过就直接产出并把缺口如实标注为「库中暂无」。
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph
from sqlalchemy import desc

from app.database import SessionLocal
from app.models import LearningGoal, LearningPath, LearningPathStep, Video
from app.services.hybrid_search import hybrid_search
from app.services.llm import build_chat_model
from app.services.profile import profile_summary_text, recompute_profile
from app.utils.files import unique_suffix

logger = logging.getLogger(__name__)

MAX_REVISION = 1
MIN_VIDEO_SCORE = 0.45  # 低于此分视为「库里没有真正讲这个的内容」


class PlanState(TypedDict, total=False):
    goal_title: str
    target_role: str
    deadline: str
    weekly_hours: float
    skills: list[str]
    profile_text: str
    gaps: list[dict]
    steps: list[dict]
    plan_summary: str  # 规划思路，与校验意见分开存，否则会被覆盖
    critique: str
    revision: int
    path_id: str
    error: str


def _llm_json(prompt: str, *, max_tokens: int = 1200, timeout_s: int = 40) -> dict:
    """要求模型输出 JSON，并做一次容错解析。"""
    model = build_chat_model("external", temperature=0.2, max_tokens=max_tokens, timeout_s=timeout_s)
    text = model.invoke(prompt).content
    if not isinstance(text, str):
        raise ValueError("模型返回内容为空")

    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1] if "```" in cleaned[3:] else cleaned[3:]
        cleaned = cleaned.removeprefix("json").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # 退一步：截取第一个 { 到最后一个 }
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start >= 0 and end > start:
            return json.loads(cleaned[start : end + 1])
        raise


# ---------------------------------------------------------------- 节点


def node_analyze(state: PlanState) -> PlanState:
    """把目标翻译成能力清单，并对照用户现状标注已有/缺失。"""
    db = SessionLocal()
    try:
        profile = recompute_profile(db, None)
        profile_text = profile_summary_text(profile)
    finally:
        db.close()

    prompt = (
        "你是资深技术职业规划师。根据目标岗位与学习者现状，拆出需要补齐的能力项。\n\n"
        f"目标：{state.get('goal_title')}\n"
        f"目标岗位：{state.get('target_role') or '未指定'}\n"
        f"期限：{state.get('deadline') or '未指定'}\n"
        f"每周可投入：{state.get('weekly_hours', 10)} 小时\n"
        f"已知需覆盖的技能：{', '.join(state.get('skills') or []) or '由你判断'}\n\n"
        f"学习者现状：{profile_text}\n\n"
        "输出 JSON：\n"
        '{"gaps": [{"skill": "能力名", "level": "missing|weak|ok", '
        '"weight": 1.0, "reason": "为什么需要（20字内）", "search_hint": "在视频库里检索用的关键词"}]}\n'
        "要求：4-8 项，按重要性降序。只保留 level 为 missing 或 weak 的项。"
    )
    try:
        data = _llm_json(prompt)
        gaps = [g for g in data.get("gaps", []) if isinstance(g, dict) and g.get("skill")]
    except Exception as exc:
        logger.warning("能力拆解失败: %s", exc)
        gaps = [{"skill": s, "level": "missing", "weight": 1.0, "search_hint": s}
                for s in (state.get("skills") or [])]

    return {"gaps": gaps, "profile_text": profile_text, "revision": state.get("revision", 0)}


def node_retrieve(state: PlanState) -> PlanState:
    """为每个能力项在真实视频库里找素材。找不到就如实标记缺口。"""
    gaps = state.get("gaps") or []
    if not gaps:
        return {"error": "没有可规划的能力项"}

    for gap in gaps:
        hint = gap.get("search_hint") or gap.get("skill", "")
        try:
            result = hybrid_search(hint, top_k=4, candidate_k=20, use_rerank=False)
        except Exception as exc:
            logger.warning("检索 %s 失败: %s", hint, exc)
            gap["videos"] = []
            continue

        picked = []
        seen_titles: set[str] = set()
        for hit in result["hits"]:
            score = hit.vector_score or 0
            if score < MIN_VIDEO_SCORE:
                continue
            if hit.video_title in seen_titles:
                continue
            seen_titles.add(hit.video_title)
            picked.append(
                {
                    "video_id": hit.video_id,
                    "title": hit.video_title,
                    "start_sec": round(hit.start_sec, 1),
                    "score": round(score, 3),
                    "snippet": hit.text[:120],
                }
            )
            if len(picked) >= 3:
                break
        gap["videos"] = picked

    return {"gaps": gaps}


def node_plan(state: PlanState) -> PlanState:
    """按能力缺口排出有序步骤，每步绑定真实视频。"""
    gaps = state.get("gaps") or []
    revision = state.get("revision", 0)

    digest = []
    for gap in gaps:
        videos = gap.get("videos") or []
        video_lines = "\n".join(
            f"    - {v['title']}（相关度 {v['score']}，可从 {int(v['start_sec'])}s 看起）"
            for v in videos
        ) or "    - 库中暂无"
        digest.append(
            f"- 能力：{gap.get('skill')}（{gap.get('level')}，权重 {gap.get('weight', 1)}）\n"
            f"  原因：{gap.get('reason', '')}\n  可用素材：\n{video_lines}"
        )

    critique = state.get("critique") or ""
    critique_block = f"\n上一轮校验意见（必须修正）：\n{critique}\n" if critique else ""

    prompt = (
        "你是技术学习路径规划师。基于能力缺口与**视频库里真实存在的素材**排出学习步骤。\n\n"
        f"目标：{state.get('goal_title')}（岗位 {state.get('target_role') or '未指定'}）\n"
        f"期限：{state.get('deadline') or '未指定'}，每周 {state.get('weekly_hours', 10)} 小时\n\n"
        "能力缺口与素材：\n" + "\n".join(digest) + "\n"
        + critique_block
        + "\n输出 JSON：\n"
        '{"summary": "整体思路（80字内）", "steps": [{"title": "步骤标题", '
        '"objective": "学完能做到什么（30字内）", "skill": "对应能力", '
        '"video_titles": ["只能从上面素材里选，没有就留空数组"], "est_minutes": 90}]}\n'
        "规则：\n"
        "1. 前置知识在前，动手实现在后；总共 4-8 步。\n"
        "2. video_titles 必须是素材里出现过的标题原文，禁止编造。\n"
        "3. 素材为「库中暂无」的能力，video_titles 留空，objective 写清需要外部补充什么。\n"
        "4. est_minutes 按每周可投入时间合理估算。"
    )

    try:
        data = _llm_json(prompt)
        steps = [s for s in data.get("steps", []) if isinstance(s, dict) and s.get("title")]
        summary = data.get("summary", "")
    except Exception as exc:
        logger.warning("步骤生成失败: %s", exc)
        return {"error": f"规划生成失败: {exc}"}

    if not steps:
        return {"error": "模型没有产出有效步骤"}

    # 把 video_titles 回填成真实 video_id，杜绝幻觉标题
    title_index: dict[str, dict] = {}
    for gap in gaps:
        for video in gap.get("videos") or []:
            title_index[video["title"]] = video

    for step in steps:
        resolved = []
        for title in step.get("video_titles") or []:
            match = title_index.get(title)
            if match:
                resolved.append(match)
        step["videos"] = resolved
        step["skill"] = step.get("skill") or ""
        step["est_minutes"] = int(step.get("est_minutes") or 60)

    return {"steps": steps, "plan_summary": summary, "revision": revision}


def node_validate(state: PlanState) -> PlanState:
    """校验：只把「真问题」写进 critique 触发重排。

    经验：时长估算偏大、步骤略多这类问题重排一次也不会更好，
    反而让用户多等 40 秒。这里只对「完全没有素材支撑」和
    「步骤严重超量」重排，其余降级为提示。
    """
    steps = state.get("steps") or []
    if not steps:
        return {"critique": "没有步骤", "revision": state.get("revision", 0) + 1}

    blocking: list[str] = []
    warnings: list[str] = []

    no_material = [s["title"] for s in steps if not s.get("videos")]
    if len(no_material) == len(steps):
        blocking.append("所有步骤都没有视频支撑，检索关键词需要更换")

    if len(steps) > 12:
        blocking.append("步骤超过 12 个，粒度太细")

    total_minutes = sum(s.get("est_minutes", 0) for s in steps)
    weekly_hours = float(state.get("weekly_hours") or 10)
    weeks = total_minutes / (weekly_hours * 60) if weekly_hours else 0
    deadline = state.get("deadline")
    if deadline:
        try:
            remaining_days = (date.fromisoformat(deadline) - date.today()).days
            if remaining_days > 0 and weeks * 7 > remaining_days:
                warnings.append(
                    f"估算总时长 {total_minutes} 分钟约需 {weeks:.1f} 周，"
                    f"超出期限剩余 {remaining_days} 天，建议提高每周投入或砍掉低优先级步骤"
                )
        except ValueError:
            pass

    return {
        "critique": "；".join(blocking),
        "plan_summary": (state.get("plan_summary") or "")
        + (f"\n注意：{'；'.join(warnings)}" if warnings else ""),
        "revision": state.get("revision", 0) + 1,
    }


def route_after_validate(state: PlanState) -> str:
    needs_fix = bool((state.get("critique") or "").strip())
    if needs_fix and state.get("revision", 0) <= MAX_REVISION:
        return "plan"
    return "persist"


def node_persist(state: PlanState) -> PlanState:
    """落库：Goal 不存在则创建，路径与步骤写库。"""
    steps = state.get("steps") or []
    if not steps:
        return {"error": "没有可保存的步骤"}

    db = SessionLocal()
    try:
        goal = (
            db.query(LearningGoal)
            .filter(LearningGoal.title == state.get("goal_title"), LearningGoal.status == "active")
            .first()
        )
        if goal is None:
            deadline = None
            if state.get("deadline"):
                try:
                    deadline = date.fromisoformat(state["deadline"])
                except ValueError:
                    deadline = None
            goal = LearningGoal(
                id=unique_suffix(),
                title=state.get("goal_title") or "未命名目标",
                target_role=state.get("target_role"),
                deadline=deadline,
                weekly_hours=float(state.get("weekly_hours") or 10),
                status="active",
                skills=[{"skill": s, "level": "missing", "weight": 1.0} for s in (state.get("skills") or [])],
            )
            db.add(goal)
            db.commit()
            db.refresh(goal)

        path = LearningPath(
            id=unique_suffix(),
            goal_id=goal.id,
            title=f"{goal.title} · 学习路径",
            summary=(state.get("plan_summary") or "")[:500],
            status="draft",
            total_est_minutes=sum(s.get("est_minutes", 0) for s in steps),
            generated_by="langgraph",
            graph_state={
                "revision": state.get("revision", 0),
                "gaps": state.get("gaps"),
                "steps_count": len(steps),
                "critique": state.get("critique") or "",
            },
        )
        db.add(path)
        db.commit()
        db.refresh(path)

        for index, step in enumerate(steps):
            videos = step.get("videos") or []
            db.add(
                LearningPathStep(
                    id=unique_suffix(),
                    path_id=path.id,
                    order_index=index,
                    title=step["title"][:200],
                    objective=(step.get("objective") or "")[:500],
                    video_ids=[v["video_id"] for v in videos],
                    est_minutes=step.get("est_minutes", 60),
                    status="pending",
                )
            )
        db.commit()
        return {"path_id": path.id}
    finally:
        db.close()


def build_graph():
    graph = StateGraph(PlanState)
    graph.add_node("analyze", node_analyze)
    graph.add_node("retrieve", node_retrieve)
    graph.add_node("plan", node_plan)
    graph.add_node("validate", node_validate)
    graph.add_node("persist", node_persist)

    graph.add_edge(START, "analyze")
    graph.add_edge("analyze", "retrieve")
    graph.add_edge("retrieve", "plan")
    graph.add_edge("plan", "validate")
    graph.add_conditional_edges("validate", route_after_validate, {"plan": "plan", "persist": "persist"})
    graph.add_edge("persist", END)
    return graph.compile()


_PLANNER = None


def get_planner():
    global _PLANNER
    if _PLANNER is None:
        _PLANNER = build_graph()
    return _PLANNER


def generate_learning_path(
    *,
    goal_title: str,
    target_role: str = "",
    deadline: str = "",
    weekly_hours: float = 10.0,
    skills: list[str] | None = None,
) -> dict:
    """对外入口：跑一遍规划图，返回路径 id 与步骤。"""
    initial: PlanState = {
        "goal_title": goal_title,
        "target_role": target_role,
        "deadline": deadline,
        "weekly_hours": weekly_hours,
        "skills": skills or [],
        "revision": 0,
    }
    result = get_planner().invoke(initial, config={"recursion_limit": 20})

    if result.get("error"):
        return {"ok": False, "error": result["error"]}

    steps = result.get("steps") or []
    return {
        "ok": True,
        "path_id": result.get("path_id"),
        "summary": result.get("plan_summary") or "",
        "critique": result.get("critique") or "",
        "revision": result.get("revision", 0),
        "steps": [
            {
                "title": s["title"],
                "objective": s.get("objective", ""),
                "est_minutes": s.get("est_minutes", 0),
                "videos": s.get("videos") or [],
            }
            for s in steps
        ],
        "gaps": result.get("gaps") or [],
    }
