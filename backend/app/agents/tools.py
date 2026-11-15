"""Agent 工具集。

每个工具返回给 LLM 的都是「已经压好的纯文本」，不是原始 JSON——
LLM 读 3000 字结构化数据会浪费上下文还容易跑偏，
人读得懂的短文本它才抓得住重点。
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta

from langchain_core.tools import tool
from sqlalchemy import desc, func, text

from app.database import SessionLocal
from app.models import LearningGoal, LearningPath, Note, Video, WatchEvent, WatchHistory
from app.services.hybrid_search import hybrid_search
from app.services.profile import profile_summary_text, recompute_profile

logger = logging.getLogger(__name__)


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
    if not hits:
        return f"视频库里没有检索到与「{query}」相关的内容。可以换个说法，或确认相关课程是否已入库并生成字幕。"

    lines = [f"与「{query}」相关的片段（共 {len(hits)} 条，按相关度排序）："]
    for index, hit in enumerate(hits, start=1):
        score = hit.vector_score or hit.lexical_score or 0
        lines.append(
            f"{index}. 《{hit.video_title}》 {_fmt_ts(hit.start_sec)}-{_fmt_ts(hit.end_sec)}"
            f"（相关度 {score:.2f}）\n   {hit.text[:220]}"
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
        profile = recompute_profile(db, None)
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
    db = SessionLocal()
    try:
        # 统计与明细必须分开查。
        # 原来的写法是「取最近 200 条事件 → 求和」，结果是：
        # 200 条只覆盖了不到一天，报出来的「最近 7 天」比实际少了 8 倍。
        # 聚合走 SQL，明细才用 LIMIT。
        total_sec = (
            db.query(func.coalesce(func.sum(WatchEvent.delta_sec), 0.0))
            .filter(WatchEvent.occurred_at >= since)
            .scalar()
            or 0.0
        )

        if not total_sec:
            # 退化到 watch_history，老数据只有进度快照
            history = (
                db.query(WatchHistory, Video.title)
                .join(Video, Video.id == WatchHistory.video_id)
                .filter(WatchHistory.watched_at >= since)
                .order_by(desc(WatchHistory.watched_at))
                .limit(50)
                .all()
            )
            if not history:
                return f"最近 {days} 天没有观看记录。"
            lines = [f"最近 {days} 天的观看记录（进度快照）："]
            for record, title in history[:15]:
                pct = (record.progress / record.duration * 100) if record.duration else 0
                lines.append(f"- 《{title}》 进度 {pct:.0f}% {'已完成' if record.completed else ''}")
            return "\n".join(lines)

        by_video = (
            db.query(Video.title, func.sum(WatchEvent.delta_sec).label("secs"))
            .join(Video, Video.id == WatchEvent.video_id)
            .filter(WatchEvent.occurred_at >= since)
            .group_by(Video.title)
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
    db = SessionLocal()
    try:
        goals = (
            db.query(LearningGoal)
            .filter(LearningGoal.status == "active")
            .order_by(desc(LearningGoal.updated_at))
            .limit(3)
            .all()
        )
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
def recommend_next_videos(limit: int = 5, category_id: int = 0) -> str:
    """基于学习画像推荐「接下来该看什么」。

    规则：优先未看过、与投入方向一致、且**不是入门级**的视频。
    回答「我下一步学什么」「推荐点视频」时调用。
    """
    limit = max(1, min(int(limit or 5), 10))
    db = SessionLocal()
    try:
        watched_ids = {
            row[0] for row in db.query(WatchHistory.video_id).distinct().all() if row[0]
        }

        # 关键判断：「投入最多的分类」是 Python 基础课（入门视频多、容易刷），
        # 但那不是「下一步」。下一歩应该朝目标技能走，所以优先按目标技能的
        # skills 去检索，再过滤掉已看过的。分类推荐只作为兜底。
        goal_skills: list[str] = []
        try:
            goals = (
                db.query(LearningGoal)
                .filter(LearningGoal.status == "active")
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
                profile = recompute_profile(db, None)
                preferred_ids = [
                    int(c["category_id"])
                    for c in (profile.top_categories or [])
                    if c.get("category_id")
                ][:3]
            except Exception as exc:
                logger.warning("推荐时读取画像失败: %s", exc)

            query = base
            if category_id:
                query = query.filter(Video.category_id == int(category_id))
            elif preferred_ids:
                query = query.filter(Video.category_id.in_(preferred_ids))

            for video in query.order_by(desc(Video.is_favorite), desc(Video.updated_at)).limit(limit * 8).all():
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
        notes = (
            db.query(Note)
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


ALL_TOOLS = [
    search_videos,
    search_video_titles,
    get_video_summary,
    get_learning_profile,
    get_recent_activity,
    get_learning_goal,
    recommend_next_videos,
    search_notes,
]
