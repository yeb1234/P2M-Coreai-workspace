"""Agent 工具集。

每个工具返回给 LLM 的都是「已经压好的纯文本」，不是原始 JSON——
LLM 读 3000 字结构化数据会浪费上下文还容易跑偏，
人读得懂的短文本它才抓得住重点。
"""

from __future__ import annotations

import json
import logging
from contextvars import ContextVar
from datetime import datetime, timedelta
from uuid import uuid4

from langchain_core.tools import tool
from langgraph.types import interrupt
from sqlalchemy import and_, desc, func, or_, text

from app.agents.tool_context import (
    begin_search_trace,
    record_search_hits,
    take_search_hits,
)
from app.database import SessionLocal
from app.models import (
    CalendarEvent,
    LearningGoal,
    LearningPath,
    Note,
    ScheduleItem,
    Video,
    WatchEvent,
    WatchHistory,
)
from app.services.agent_actions import find_run_action, record_action
from app.services.hybrid_search import hybrid_search
from app.utils.textclean import clean_promo_text
from app.services.learning_context import active_path_text
from app.services.note_ai import summarize_note
from app.services.note_library import MAX_NOTE_CONTENT, save_private_note
from app.services.profile import get_profile_data, profile_summary_text
from app.services.interview_library import (
    format_knowledge,
    format_question,
    format_question_brief,
    get_question,
    knowledge_count,
    question_count,
    search_knowledge,
    search_questions,
)

logger = logging.getLogger(__name__)

# 当前对话是谁在问。
# 工具函数的签名对模型可见，加个 user_id 参数会让模型有机会乱填别人的 id，
# 所以走 ContextVar：由 chat_agent 在进入 Agent 前设置，模型看不到也改不了。
_tool_user_id: ContextVar[int | None] = ContextVar("tool_user_id", default=None)
# 当前页面上的笔记。前端把完整正文放在请求体里，模型看不到完整正文，
# 但 save_note / summarize_and_save_note 需要它，所以走 ContextVar 传。
_tool_note_context: ContextVar[dict[str, str] | None] = ContextVar(
    "tool_note_context", default=None
)
# 当前 run / 会话。写动作审计要能回答「这次改动属于哪一轮对话」，
# 同时用于同一轮内重复动作去重。模型看不到，也不能改。
_tool_run_id: ContextVar[str | None] = ContextVar("tool_run_id", default=None)
_tool_session_id: ContextVar[str | None] = ContextVar("tool_session_id", default=None)


def set_tool_user(user_id: int | None) -> None:
    _tool_user_id.set(user_id)


def set_tool_note_context(note: dict[str, str] | None) -> None:
    _tool_note_context.set(note)


def set_tool_run(run_id: str | None, session_id: str | None = None) -> None:
    _tool_run_id.set(run_id)
    _tool_session_id.set(session_id)


def _run_id() -> str | None:
    return _tool_run_id.get()


def _session_id() -> str | None:
    return _tool_session_id.get()


def _uid() -> int | None:
    return _tool_user_id.get()


def _current_note() -> dict[str, str]:
    note = _tool_note_context.get() or {}
    return {
        "title": str(note.get("title") or "").strip(),
        "markdown": str(note.get("markdown") or "").strip(),
    }


# 本轮对话里 search_videos 真正召回的片段，已移到 tool_context。
# 旧实现图省事，在回答生成完之后**再跑一次** hybrid_search 去凑卡片，
# 于是正文和引用区来自两次不同的检索。现在工具实际命中的片段留在
# SearchTrace 里，引用区和模型依据同源；超时线程的迟到命中会被令牌丢弃。
#
# begin_search_trace / take_search_hits 继续从这里导出，保持 chat_agent
# 和历史测试的导入路径不变。


def _fmt_ts(seconds: float) -> str:
    total = int(seconds or 0)
    return f"{total // 60}:{total % 60:02d}"


# 「下一步该看什么」不该出现这些：它们是刚接触时的第一个小时内容。
# 实测未过滤时，一个已经学过 RAG 的人会被推「Python 注释」「print 输出」。
ENTRY_LEVEL_PATTERNS = (
    "第一个", "入门", "简介", "介绍", "注释", "变量", "print", "input",
    "安装", "环境搭建", "hello", "认识", "初识", "概述", "预览", "扯淡",
)


def _is_entry_level(title: str) -> bool:
    lowered = (title or "").lower()
    return any(pattern in lowered for pattern in ENTRY_LEVEL_PATTERNS)


@tool
def search_videos(query: str, top_k: int = 5) -> str:
    """在本地视频库中检索与问题相关的讲解片段。

    用于回答「哪个视频讲过 X」「X 是怎么实现的」「帮我找 X 的案例」。
    query 用自然语言描述你想找的内容即可，不需要精确关键词。
    """
    result = hybrid_search(query, top_k=max(1, min(int(top_k or 5), 8)), candidate_k=30, use_rerank=True)
    hits = result["hits"]
    # 留一份给引用卡片用：和模型看到的是同一批，不再二次检索。
    # record_search_hits 会检查当前调用令牌；超时线程的迟到结果会被丢弃。
    record_search_hits(hits)
    if not hits:
        return f"视频库里没有检索到与「{query}」相关的内容。可以换个说法，或确认相关课程是否已入库并生成字幕。"

    lines = [f"与「{query}」相关的片段（共 {len(hits)} 条，按相关度排序）："]
    for index, hit in enumerate(hits, start=1):
        score = hit.vector_score or hit.lexical_score or 0
        lines.append(
            f"{index}. 《{hit.video_title}》 {_fmt_ts(hit.start_sec)}-{_fmt_ts(hit.end_sec)}"
            # 字幕里的广告（微信、itjc8.com）要清掉：不清的话模型会照抄，
            # 回答里就带出一串推广信息
            f"（相关度 {score:.2f}）\n   {clean_promo_text(hit.text)[:220]}"
        )
    return "\n".join(lines)


@tool
def get_video_summary(video_id: int) -> str:
    """获取某个视频的摘要与基本信息。video_id 从检索结果里拿。"""
    db = SessionLocal()
    try:
        video = db.query(Video).filter(Video.id == int(video_id)).first()
        if not video:
            return f"没有找到 id={video_id} 的视频。"
        parts = [
            f"《{video.title}》",
            f"时长 {_fmt_ts(video.duration or 0)}",
            f"分类 id {video.category_id}",
            f"状态 {video.ai_status or '未知'}",
        ]
        if video.summary:
            parts.append(f"\n摘要：\n{video.summary[:1200]}")
        elif video.transcription:
            parts.append(f"\n（无摘要，转录开头）\n{video.transcription[:800]}")
        else:
            parts.append("\n该视频还没有生成字幕与摘要。")
        return "\n".join(parts)
    finally:
        db.close()


@tool
def get_learning_profile() -> str:
    """读取学习画像：累计观看时长、完成率、专注时长、投入最多的领域、活跃时段。

    回答「我最近学得怎么样」「我薄弱在哪」这类问题前先调用它。
    """
    db = SessionLocal()
    try:
        profile = get_profile_data(db, _uid())
        return profile_summary_text(profile)
    except Exception as exc:
        logger.warning("读取画像失败: %s", exc)
        return "暂时读不到学习画像（行为数据可能还不够）。可以先把最近的观看记录补上来。"
    finally:
        db.close()


@tool
def get_recent_activity(days: int = 7) -> str:
    """最近 N 天的观看与学习活动。用于回答「我最近看了什么」「进度如何」。"""
    days = max(1, min(int(days or 7), 90))
    since = datetime.now() - timedelta(days=days)
    uid = _uid()
    db = SessionLocal()
    try:
        # 统计与明细必须分开查。
        # 原来的写法是「取最近 200 条事件 → 求和」，结果是：
        # 200 条只覆盖了不到一天，报出来的「最近 7 天」比实际少了 8 倍。
        # 聚合走 SQL，明细才用 LIMIT。
        total_query = db.query(func.coalesce(func.sum(WatchEvent.delta_sec), 0.0)).filter(
            WatchEvent.occurred_at >= since
        )
        if uid is not None:
            total_query = total_query.filter(WatchEvent.user_id == uid)
        total_sec = total_query.scalar() or 0.0

        if not total_sec:
            # 退化到 watch_history，老数据只有进度快照
            history_query = (
                db.query(WatchHistory, Video.title)
                .join(Video, Video.id == WatchHistory.video_id)
                .filter(WatchHistory.watched_at >= since)
            )
            if uid is not None:
                history_query = history_query.filter(WatchHistory.user_id == uid)
            history = (
                history_query.order_by(desc(WatchHistory.watched_at)).limit(50).all()
            )
            if not history:
                return f"最近 {days} 天没有观看记录。"
            lines = [f"最近 {days} 天的观看记录（进度快照）："]
            for record, title in history[:15]:
                pct = (record.progress / record.duration * 100) if record.duration else 0
                lines.append(f"- 《{title}》 进度 {pct:.0f}% {'已完成' if record.completed else ''}")
            return "\n".join(lines)

        video_query = (
            db.query(Video.title, func.sum(WatchEvent.delta_sec).label("secs"))
            .join(Video, Video.id == WatchEvent.video_id)
            .filter(WatchEvent.occurred_at >= since)
        )
        if uid is not None:
            video_query = video_query.filter(WatchEvent.user_id == uid)
        by_video = (
            video_query.group_by(Video.title)
            .order_by(func.sum(WatchEvent.delta_sec).desc())
            .limit(10)
            .all()
        )

        lines = [
            f"最近 {days} 天共学习 {float(total_sec)/60:.0f} 分钟，"
            f"涉及 {len(by_video)} 个视频（按时长排序，前 10）："
        ]
        for title, secs in by_video:
            lines.append(f"- 《{title}》 {float(secs or 0)/60:.0f} 分钟")
        return "\n".join(lines)
    finally:
        db.close()


@tool
def get_learning_goal() -> str:
    """读取当前学习目标与已有学习路径的进度。规划路径前必须先看这里。"""
    uid = _uid()
    db = SessionLocal()
    try:
        goal_query = db.query(LearningGoal).filter(LearningGoal.status == "active")
        if uid is not None:
            goal_query = goal_query.filter(LearningGoal.user_id == uid)
        goals = goal_query.order_by(desc(LearningGoal.updated_at)).limit(3).all()
        if not goals:
            return "当前没有设定学习目标。需要先和用户确认目标岗位、期限与每周可投入时间。"

        lines = []
        for goal in goals:
            line = f"目标：{goal.title}"
            if goal.target_role:
                line += f"（目标岗位 {goal.target_role}）"
            if goal.deadline:
                line += f"，截止 {goal.deadline}"
            line += f"，每周可投入 {goal.weekly_hours} 小时"
            lines.append(line)

            paths = (
                db.query(LearningPath)
                .filter(LearningPath.goal_id == goal.id, LearningPath.status != "archived")
                .order_by(desc(LearningPath.updated_at))
                .limit(1)
                .all()
            )
            for path in paths:
                done = sum(1 for step in path.steps if step.status == "done")
                lines.append(
                    f"  已有路径「{path.title}」，{done}/{len(path.steps)} 步已完成"
                )
        return "\n".join(lines)
    finally:
        db.close()


@tool
def get_my_learning_path() -> str:
    """读取「学习路径」页里正在推进的路径：每步做什么、进度、绑定的视频。

    回答「我下一步学什么」「我的路径走到哪了」「这周该做哪一步」之前先调用它。
    如果用户还没建过路径，如实说没有，并建议他先去「学习路径」页生成一条，
    不要凭空替他设计一套课程。
    """
    db = SessionLocal()
    try:
        text = active_path_text(db, _uid())
        if not text:
            return (
                "用户目前没有正在推进的学习路径。"
                "如果他想有明确节奏，建议他去「学习路径」页设定目标后生成一条 —— "
                "生成出来的每一步都会绑定库里真实存在的视频。"
            )
        return text
    except Exception as exc:
        logger.warning("读取学习路径失败: %s", exc)
        return "暂时读不到学习路径。"
    finally:
        db.close()


@tool
def recommend_next_videos(limit: int = 5, category_id: int = 0) -> str:
    """基于学习画像推荐「接下来该看什么」。

    规则：优先未看过、与投入方向一致、且**不是入门级**的视频。
    回答「我下一步学什么」「推荐点视频」时调用。
    """
    limit = max(1, min(int(limit or 5), 10))
    uid = _uid()
    if uid is None:
        # 工具虽然注册为 requires_login=True，但函数本身也要拒绝无 uid 调用：
        # 不能依赖上层路由或工具元数据替它做隔离。
        return "请先登录后再让我推荐。"

    db = SessionLocal()
    try:
        watched_ids = {
            row[0]
            for row in db.query(WatchHistory.video_id)
            .filter(WatchHistory.user_id == uid)
            .distinct()
            .all()
            if row[0]
        }

        # 关键判断：「投入最多的分类」是 Python 基础课（入门视频多、容易刷），
        # 但那不是「下一步」。下一歩应该朝目标技能走，所以优先按目标技能的
        # skills 去检索，再过滤掉已看过的。分类推荐只作为兜底。
        goal_skills: list[str] = []
        try:
            goals = (
                db.query(LearningGoal)
                .filter(
                    LearningGoal.user_id == uid,
                    LearningGoal.status == "active",
                )
                .order_by(desc(LearningGoal.updated_at))
                .limit(2)
                .all()
            )
            for goal in goals:
                for item in goal.skills or []:
                    skill = item.get("skill") if isinstance(item, dict) else str(item)
                    if skill and skill not in goal_skills:
                        goal_skills.append(str(skill))
        except Exception as exc:
            logger.warning("读取目标失败: %s", exc)

        picked: list[Video] = []
        seen: set[int] = set()

        if goal_skills and not category_id:
            from app.services.hybrid_search import hybrid_search

            for skill in goal_skills[:4]:
                if len(picked) >= limit:
                    break
                try:
                    result = hybrid_search(f"{skill} 实战 项目", top_k=6, use_rerank=False)
                except Exception as exc:
                    logger.warning("推荐检索 %s 失败: %s", skill, exc)
                    continue
                for hit in result["hits"]:
                    if len(picked) >= limit:
                        break
                    if hit.video_id in watched_ids or hit.video_id in seen:
                        continue
                    if _is_entry_level(hit.video_title or ""):
                        continue
                    video = db.query(Video).filter(Video.id == hit.video_id).first()
                    if video:
                        seen.add(video.id)
                        picked.append(video)

            if not picked:
                return (
                    f"目标方向（{'/'.join(goal_skills[:4])}）的视频基本都看过了，"
                    "剩下的不是「再看一个视频」能解决的。"
                    "建议转向工程化闭环：评测集怎么建、接口怎么测、服务怎么部署。"
                )

        if not picked:
            base = (
                db.query(Video)
                .filter(Video.title.isnot(None))
                .filter(Video.transcription.isnot(None))
            )
            preferred_ids: list[int] = []
            try:
                profile = get_profile_data(db, uid)
                preferred_ids = [
                    int(c["category_id"])
                    for c in (profile.get("top_categories") or [])
                    if c.get("category_id")
                ][:3]
            except Exception as exc:
                logger.warning("推荐时读取画像失败: %s", exc)

            query = base
            if category_id:
                query = query.filter(Video.category_id == int(category_id))
            elif preferred_ids:
                query = query.filter(Video.category_id.in_(preferred_ids))

            for video in query.order_by(desc(Video.updated_at)).limit(limit * 8).all():
                if video.id in seen or video.id in watched_ids:
                    continue
                if _is_entry_level(video.title or ""):
                    continue
                seen.add(video.id)
                picked.append(video)
                if len(picked) >= limit:
                    break

        if not picked:
            return "视频库里没有找到合适的候选。建议用 search_videos 按具体主题检索。"

        # 分类名一起给出来，让模型能判断「这个推荐是否对得上用户目标」
        name_map: dict[int, str] = {}
        for cid in {v.category_id for v in picked if v.category_id}:
            label = db.execute(
                text("SELECT name FROM categories WHERE id = :cid"), {"cid": cid}
            ).scalar()
            if label:
                name_map[int(cid)] = str(label)[:28]

        basis = f"目标技能（{'/'.join(goal_skills[:4])}）" if goal_skills else "你的投入方向"
        lines = [
            f"候选 {min(limit, len(picked))} 个（按{basis}检索，已排除看过的和入门内容；"
            "请结合用户目标判断是否合适，不合适就直说）："
        ]
        for video in picked[:limit]:
            cid = int(video.category_id) if video.category_id else 0
            label = name_map.get(cid, "")
            lines.append(
                f"- id={video.id} 《{video.title}》 {_fmt_ts(video.duration or 0)}"
                + (f"　[{label}]" if label else "")
            )
        return "\n".join(lines)
    finally:
        db.close()


@tool
def search_notes(query: str, limit: int = 5) -> str:
    """在历史学习笔记中检索。用于「我以前记过什么」「之前总结过 X 吗」。"""
    db = SessionLocal()
    try:
        pattern = f"%{query}%"
        uid = _uid()
        # 可见性必须和 notes.py 的规则一致：shared 人人可看，
        # private 只有本人可看。原来这里没有任何 user 过滤，
        # 于是问一句「帮我查下我以前记过什么」就能把别人的私有笔记
        # 标题和正文前 200 字读出来（LLM 会原样回吐给用户）。
        if uid is None:
            visibility = Note.scope == "shared"
        else:
            visibility = or_(
                Note.scope == "shared",
                and_(Note.scope == "private", Note.user_id == uid),
            )
        notes = (
            db.query(Note)
            .filter(visibility)
            .filter((Note.title.ilike(pattern)) | (Note.content.ilike(pattern)))
            .order_by(desc(Note.updated_at))
            .limit(max(1, min(int(limit or 5), 10)))
            .all()
        )
        if not notes:
            return f"笔记里没有找到与「{query}」相关的内容。"
        lines = [f"找到 {len(notes)} 篇相关笔记："]
        for note in notes:
            snippet = (note.content or "").replace("\n", " ")[:200]
            lines.append(f"- 《{note.title}》 {snippet}")
        return "\n".join(lines)
    finally:
        db.close()


@tool
def save_note(
    title: str = "",
    content: str = "",
    summary: str = "",
    confirm: bool = False,
) -> str:
    """把当前笔记或给定正文保存到个人笔记库（private）。

    用户明确说「保存刚才笔记 / 存到笔记 / 保存这篇」时调用。
    当前页面上的笔记会由系统带上完整正文：content 留空即可；
    如果当前页面没有笔记，**必须把要保存的正文完整写进 content**，
    只回复「确认卡已弹出」而不调用本工具不会产生任何写入。
    如果用户要求「总结后保存」，把总结放在 summary，工具会把总结和原文一起保存。
    confirm 由运行时确认闸门在用户确认后置为 true；模型不要主动传 true。
    """
    uid = _uid()
    if uid is None:
        return "请先登录后再保存笔记。"
    if confirm is not True:
        return "保存笔记需要用户明确确认；确认卡会在模型发起本工具调用后由运行时弹出。"

    note = _current_note()
    head = (title or note["title"] or "").strip()[:240] or "AI 笔记"
    body = (content or note["markdown"] or "").strip()
    summary = (summary or "").strip()

    if not body and not summary:
        return "没有可保存的内容：当前页面没有笔记，也没有传入正文。"
    if len(body) > MAX_NOTE_CONTENT:
        return f"正文太长（超过 {MAX_NOTE_CONTENT} 字符），先精简后再保存。"

    if summary:
        sections = [f"## AI 总结\n\n{summary}"]
        if body:
            sections.append(f"## 原文\n\n{body}")
        final = "\n\n---\n\n".join(sections)
        saved_title = head if body else f"{head} · AI 总结"
    else:
        final = body
        saved_title = head

    try:
        with SessionLocal() as db:
            existing = find_run_action(
                db, user_id=uid, run_id=_run_id(), action_type="note"
            )
            if existing is not None:
                return (
                    f"本轮已经保存过一篇笔记（id={existing.target_id}），"
                    "为避免重复写入，没有再次创建。"
                )

            saved = save_private_note(
                user_id=uid,
                title=saved_title,
                content=final,
                source="assistant",
                db=db,
            )
            action = record_action(
                db,
                user_id=uid,
                action_type="note",
                title=saved.title,
                target_id=saved.id,
                result=f"正文 {len(final)} 字",
                payload={
                    "title": saved.title,
                    "content_chars": len(final),
                    "content_preview": final[:300],
                    "with_summary": bool(summary),
                },
                summary=f"保存笔记，正文 {len(final)} 字",
                run_id=_run_id(),
                session_id=_session_id(),
            )
            saved_id = saved.id
            saved_title = saved.title
            action_id = action.id
            db.commit()
    except Exception as exc:  # noqa: BLE001 —— 工具错误要变成模型能读懂的一句话
        logger.warning("保存笔记失败: %s", exc)
        return f"保存笔记失败：{exc}"
    return (
        f"已保存到个人笔记库：id={saved_id}，标题《{saved_title}》，正文 {len(final)} 字。"
        f"动作记录 id={action_id}，可在聊天里撤回。"
    )


@tool
def summarize_and_save_note(title: str = "", content: str = "", confirm: bool = False) -> str:
    """对当前笔记做 AI 总结，并把总结另存为一篇新的私人笔记。

    用户明确说「总结后保存 / 总结再存到笔记 / 把这篇总结一下存起来」时调用。
    当前页面上的笔记正文会由系统带上，content 留空即可；没有页面笔记时
    必须把正文写进 content。
    confirm 由运行时确认闸门在用户确认后置为 true；模型不要主动传 true。
    """
    uid = _uid()
    if uid is None:
        return "请先登录后再总结并保存笔记。"
    if confirm is not True:
        return "总结并保存需要用户明确确认；确认卡会在模型发起本工具调用后由运行时弹出。"

    note = _current_note()
    head = (title or note["title"] or "").strip()[:240] or "AI 笔记"
    body = (content or note["markdown"] or "").strip()
    if not body:
        return "没有可总结的内容：当前页面没有笔记，也没有传入正文。"
    if len(body) > MAX_NOTE_CONTENT:
        return f"正文太长（超过 {MAX_NOTE_CONTENT} 字符），先精简后再总结。"

    try:
        result = summarize_note(head, body)
        summary = str(result.get("summary") or "").strip()
        if not summary:
            return "总结结果为空，没有保存。可以稍后重试。"

        with SessionLocal() as db:
            existing = find_run_action(
                db, user_id=uid, run_id=_run_id(), action_type="note"
            )
            if existing is not None:
                return (
                    f"本轮已经保存过一篇笔记（id={existing.target_id}），"
                    "为避免重复写入，没有再次创建。"
                )

            saved = save_private_note(
                user_id=uid,
                title=f"{head} · AI 总结"[:240],
                content=summary,
                source="assistant",
                db=db,
            )
            action = record_action(
                db,
                user_id=uid,
                action_type="note",
                title=saved.title,
                target_id=saved.id,
                result=f"总结 {len(summary)} 字",
                payload={
                    "title": saved.title,
                    "content_chars": len(summary),
                    "content_preview": summary[:300],
                    "with_summary": True,
                },
                summary=f"生成总结并另存笔记，{len(summary)} 字",
                run_id=_run_id(),
                session_id=_session_id(),
            )
            saved_id = saved.id
            saved_title = saved.title
            action_id = action.id
            db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("总结并保存笔记失败: %s", exc)
        return f"总结并保存失败：{exc}"

    return (
        f"已生成总结并保存为私人笔记：id={saved_id}，标题《{saved_title}》。\n"
        f"摘要：\n{summary}\n\n动作记录 id={action_id}，可在聊天里撤回。"
    )


@tool
def create_calendar_event(
    title: str,
    date: str,
    start_time: str = "",
    end_time: str = "",
    description: str = "",
    confirm: bool = False,
) -> str:
    """在个人日历里创建一个日程。

    date 用 YYYY-MM-DD；start_time/end_time 用 HH:MM（24 小时制），
    全天日程可以只传 date。用户说「安排到日历 / 加个日程 / 提醒我某天做某事」时调用。
    一次只创建一个日程，不要把一个计划拆成多条。
    confirm 由运行时确认闸门在用户确认后置为 true；模型不要主动传 true。
    """
    uid = _uid()
    if uid is None:
        return "请先登录后再安排日历。"
    if confirm is not True:
        return "创建日程需要用户明确确认；确认卡会在模型发起本工具调用后由运行时弹出。"

    title = (title or "").strip()[:240]
    if not title:
        return "创建日程失败：标题不能为空。"
    try:
        day = datetime.strptime((date or "").strip(), "%Y-%m-%d").date()
    except ValueError:
        return "创建日程失败：date 必须是 YYYY-MM-DD。"

    def _parse_clock(value: str, field: str) -> tuple[str | None, str | None]:
        value = (value or "").strip()
        if not value:
            return None, None
        for fmt in ("%H:%M", "%H:%M:%S"):
            try:
                parsed = datetime.strptime(value, fmt)
                return parsed.strftime("%H:%M"), None
            except ValueError:
                continue
        return None, f"{field} 必须是 HH:MM"

    start, start_err = _parse_clock(start_time, "start_time")
    end, end_err = _parse_clock(end_time, "end_time")
    if start_err or end_err:
        return f"创建日程失败：{start_err or end_err}。"
    if end and not start:
        return "创建日程失败：只传 end_time 不够，start_time 也要传。"
    if start and end:
        start_dt = datetime.strptime(f"{day.isoformat()} {start}", "%Y-%m-%d %H:%M")
        end_dt = datetime.strptime(f"{day.isoformat()} {end}", "%Y-%m-%d %H:%M")
        if end_dt <= start_dt:
            return "创建日程失败：end_time 必须晚于 start_time。"

    description = (description or "").strip()[:20_000] or None
    try:
        with SessionLocal() as db:
            existing = find_run_action(
                db, user_id=uid, run_id=_run_id(), action_type="calendar"
            )
            if existing is not None:
                return (
                    f"本轮已经创建过日历日程（id={existing.target_id}），"
                    "为避免重复写入，没有再次创建。"
                )

            now = datetime.now()
            event = CalendarEvent(
                id=uuid4().hex,
                user_id=uid,
                title=title,
                date=day.isoformat(),
                start_time=start,
                end_time=end,
                type="event",
                color="#8b5cf6",
                description=description,
                created_at=now,
                updated_at=now,
            )
            db.add(event)
            db.flush()
            action = record_action(
                db,
                user_id=uid,
                action_type="calendar",
                title=title,
                target_id=event.id,
                result=f"{day.isoformat()} {start or '全天'}",
                payload={
                    "date": day.isoformat(),
                    "start_time": start,
                    "end_time": end,
                    "description_preview": (description or "")[:300],
                },
                summary=f"日历日程：{day.isoformat()} {start or '全天'}",
                run_id=_run_id(),
                session_id=_session_id(),
            )
            event_id = event.id
            action_id = action.id
            db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("创建日程失败: %s", exc)
        return f"创建日程失败：{exc}"

    time_text = f"{start}-{end}" if start and end else (start or "全天")
    return (
        f"已加入日历：{day.isoformat()} {time_text}，{title}，id={event_id}。"
        f"动作记录 id={action_id}，可在聊天里撤回。"
    )


@tool
def create_todo(
    title: str,
    content: str = "",
    due_date: str = "",
    priority: str = "medium",
    confirm: bool = False,
) -> str:
    """创建一个 Todo，**只创建一个汇总大块，不拆成多个子任务**。

    用户说「建个待办 / 加到 Todo / 提醒我完成某件事」时调用。
    title 是这一整块 Todo 的标题；content 放完整说明、步骤或清单，
    全部塞进同一个 description，不要连续调用本工具创建多条。
    due_date 可选，格式 YYYY-MM-DD；不传就是无截止日期的待办。
    confirm 由运行时确认闸门在用户确认后置为 true；模型不要主动传 true。
    """
    uid = _uid()
    if uid is None:
        return "请先登录后再创建 Todo。"
    if confirm is not True:
        return "创建 Todo 需要用户明确确认；确认卡会在模型发起本工具调用后由运行时弹出。"

    title = (title or "").strip()[:240]
    if not title:
        return "创建 Todo 失败：标题不能为空。"
    allowed_priority = {"high", "medium", "low", "green"}
    priority = (priority or "medium").strip().lower()
    if priority not in allowed_priority:
        priority = "medium"

    start_at = None
    due_at = None
    if (due_date or "").strip():
        try:
            day = datetime.strptime(due_date.strip(), "%Y-%m-%d").date()
        except ValueError:
            return "创建 Todo 失败：due_date 必须是 YYYY-MM-DD。"
        start_at = datetime.combine(day, datetime.min.time())
        due_at = datetime.combine(day, datetime.max.time()).replace(second=0, microsecond=0)

    description = (content or "").strip()[:20_000]
    try:
        with SessionLocal() as db:
            existing = find_run_action(
                db, user_id=uid, run_id=_run_id(), action_type="todo"
            )
            if existing is not None:
                return (
                    f"本轮已经创建过一个 Todo（id={existing.target_id}），"
                    "为避免拆成碎项，没有再次创建。"
                )

            now = datetime.now()
            item = ScheduleItem(
                id=uuid4().hex,
                user_id=uid,
                type="todo",
                title=title,
                description=description,
                status="pending",
                priority=priority,
                start_at=start_at,
                due_at=due_at,
                sort_order=0,
                created_at=now,
                updated_at=now,
            )
            db.add(item)
            db.flush()
            action = record_action(
                db,
                user_id=uid,
                action_type="todo",
                title=title,
                target_id=item.id,
                result=f"{len(description)} 字说明",
                payload={
                    "due_date": due_date.strip() or None,
                    "description_chars": len(description),
                    "description_preview": description[:300],
                },
                summary=f"Todo 单条汇总，{len(description)} 字说明",
                run_id=_run_id(),
                session_id=_session_id(),
            )
            item_id = item.id
            action_id = action.id
            db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("创建 Todo 失败: %s", exc)
        return f"创建 Todo 失败：{exc}"

    due_text = f"，截止 {due_date.strip()}" if (due_date or "").strip() else ""
    return (
        f"已创建 Todo：{title}（单条汇总，不拆碎项{due_text}），id={item_id}。"
        f"动作记录 id={action_id}，可在聊天里撤回。"
    )


@tool
def search_video_titles(keyword: str, limit: int = 8) -> str:
    """按标题找课程/视频，返回可选视频清单。

    当用户问「有没有讲 X 的课」时用它，比片段检索更适合找整门课。
    """
    from app.services.lexical import title_search

    rows = title_search(keyword, limit=max(1, min(int(limit or 8), 15)))
    if not rows:
        return f"标题里没有匹配「{keyword}」的视频。"
    lines = [f"标题匹配「{keyword}」的视频："]
    for row in rows:
        lines.append(f"- id={row['video_id']} 《{row['video_title']}》 {_fmt_ts(row['duration'] or 0)}")
    return "\n".join(lines)


@tool
def search_interview_questions(
    query: str,
    group: str = "",
    qtype: str = "",
    limit: int = 5,
) -> str:
    """检索本地结构化面试题库（当前约 360 道题，含题干、参考答案、评分点、追问）。

    适合这些场景：
    - 用户在当前题目上追问，需要找同类题、前置题或下一道练习题；
    - 用户想按「Agent / RAG」「LLM」「后端」「交付」「拓展」分组找题；
    - 用户想找改错、手写、场景、项目深挖等题型。

    group 可填 agent / llm / backend / delivery / bonus；
    qtype 可填 concept / code / handwrite / debug / scenario / compare /
    troubleshoot / system / project / behavioral。找不到就留空。
    本工具只返回题号、标题、题干开头和标签；要看完整答案用
    get_interview_question。
    """
    rows = search_questions(query=query, limit=limit, group=group, qtype=qtype)
    if not rows:
        return (
            f"题库里没有找到匹配「{query}」的题目。"
            f"当前题库共 {question_count()} 道；建议换关键词，或先看当前页面这道题。"
        )
    lines = [
        f"题库检索「{query}」命中 {len(rows)} 道（题库共 {question_count()} 道）：",
        "需要完整题干/参考答案时，用 get_interview_question 按题号取。",
    ]
    lines.extend(format_question_brief(item) for item in rows)
    return "\n".join(lines)


@tool
def get_interview_question(
    question_id: str = "",
    title: str = "",
    include_answer: bool = True,
) -> str:
    """按题号或标题取一道题的完整题干、评分点、常见追问和参考答案。

    当前页面已经打开题目时，优先使用页面上下文里的题号；只有上下文缺字段、
    用户提到另一道题，或需要核对完整答案时才调用本工具。
    include_answer=False 时只返回题干和评分点，适合让用户先自己作答。
    """
    question = get_question(question_id=question_id, title=title)
    if question is None:
        target = question_id or title or "（未提供题号/标题）"
        return (
            f"没有找到题目 {target}。可以先用 search_interview_questions 检索题号，"
            "或让用户补充题目名称。"
        )
    return format_question(question, include_answer=include_answer)


@tool
def search_interview_knowledge(query: str, limit: int = 3) -> str:
    """检索本地面试知识库（DeepSeek 演进、RAG 权限、Agent 工程等专题文章）。

    当用户问「原理是什么」「为什么这么设计」「这个说法对不对」，
    而当前题库的参考答案不够展开时用它。返回文章摘要、正文节选和来源链接；
    需要完整文章时按返回的文章标题继续追问。
    """
    articles = search_knowledge(query=query, limit=limit)
    if not articles:
        return (
            f"知识库里没有找到「{query}」相关专题。"
            f"当前知识库共 {knowledge_count()} 篇；可以换关键词或用题库工具查具体题。"
        )
    lines = [f"知识库检索「{query}」命中 {len(articles)} 篇（共 {knowledge_count()} 篇）："]
    for index, article in enumerate(articles, start=1):
        lines.append("")
        lines.append(f"{index}. " + format_knowledge(article))
    return "\n".join(lines)


@tool
def ask_user(
    question: str,
    options: list[str],
    kind: str = "clarify",
    allow_custom: bool = True,
    context: str = "",
) -> str:
    """暂停当前任务，向用户提出一个带 A/B/C 选项的问题。

    只在以下情况调用：
    - 意图含糊：同一句话有多种合理解释，猜错会浪费一轮；
    - 缺少关键信息：目标、时间、范围、格式、对象不明确，无法可靠执行；
    - 人工确认：即将保存笔记、覆盖内容、删除/修改数据等写操作。

    kind 取值：
    - clarify：意图澄清；
    - supplement：补充缺失信息；
    - confirm：执行前的人工确认。

    options 给 2-4 个短选项，不要写“其它”；allow_custom=true 时前端会自动提供
    “其它（自己填写）”。一次只问一个问题，用户回答后按选择继续，不要重复问。
    """
    normalized_kind = kind if kind in {"clarify", "supplement", "confirm"} else "clarify"
    labels = [str(item).strip() for item in options if str(item).strip()][:4]
    if len(labels) < 2:
        labels = ["继续", "取消"]
    normalized_options = [
        {"id": chr(ord("A") + index), "label": label}
        for index, label in enumerate(labels)
    ]

    answer = interrupt(
        {
            "kind": normalized_kind,
            "question": question.strip()[:240],
            "options": normalized_options,
            "allow_custom": bool(allow_custom),
            "context": context.strip()[:400],
        }
    )

    selected = ""
    label = ""
    text = ""
    if isinstance(answer, dict):
        selected = str(answer.get("selected") or answer.get("selected_id") or "").strip()
        text = str(answer.get("text") or "").strip()
        if selected:
            for option in normalized_options:
                if selected == option["id"] or selected == option["label"]:
                    selected = option["id"]
                    label = option["label"]
                    break
    elif answer is not None:
        text = str(answer).strip()

    if not label:
        for option in normalized_options:
            if selected == option["id"] or selected == option["label"]:
                label = option["label"]
                break
    if not selected:
        selected = "custom" if text else ""

    if text and label:
        return f"用户选择 {selected}（{label}），并补充：{text}。请按这个选择继续。"
    if text:
        return f"用户补充：{text}。请按补充信息继续。"
    if selected:
        return f"用户选择 {selected}：{label or selected}。请按这个选择继续。"
    return "用户没有提供明确选择。请换一种更具体的问法，或先给出默认方案。"


ALL_TOOLS = [
    search_videos,
    search_video_titles,
    get_video_summary,
    get_learning_profile,
    get_recent_activity,
    get_learning_goal,
    get_my_learning_path,
    recommend_next_videos,
    search_notes,
    save_note,
    summarize_and_save_note,
    create_calendar_event,
    create_todo,
    search_interview_questions,
    get_interview_question,
    search_interview_knowledge,
    ask_user,
]
