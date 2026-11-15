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
from sqlalchemy import desc, func

from app.database import SessionLocal
from app.models import LearningGoal, LearningPath, Note, Video, WatchEvent, WatchHistory
from app.services.hybrid_search import hybrid_search
from app.services.profile import profile_summary_text, recompute_profile

logger = logging.getLogger(__name__)


def _fmt_ts(seconds: float) -> str:
    total = int(seconds or 0)
    return f"{total // 60}:{total % 60:02d}"


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
        events = (
            db.query(WatchEvent, Video.title)
            .join(Video, Video.id == WatchEvent.video_id)
            .filter(WatchEvent.occurred_at >= since)
            .order_by(desc(WatchEvent.occurred_at))
            .limit(200)
            .all()
        )
        if not events:
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

        total_min = sum(float(e.delta_sec or 0) for e, _ in events) / 60
        by_video: dict[str, float] = {}
        for event, title in events:
            by_video[title] = by_video.get(title, 0.0) + float(event.delta_sec or 0)

        lines = [f"最近 {days} 天共学习 {total_min:.0f} 分钟，涉及 {len(by_video)} 个视频："]
        for title, secs in sorted(by_video.items(), key=lambda kv: kv[1], reverse=True)[:10]:
            lines.append(f"- 《{title}》 {secs/60:.0f} 分钟")
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

    规则：优先未看过的、与投入最多领域相关、且有字幕的视频。
    回答「我下一步学什么」「推荐点视频」时调用。
    """
    limit = max(1, min(int(limit or 5), 10))
    db = SessionLocal()
    try:
        watched_ids = {
            row[0] for row in db.query(WatchHistory.video_id).distinct().all() if row[0]
        }

        query = (
            db.query(Video)
            .filter(Video.title.isnot(None))
            .filter(Video.transcription.isnot(None))
        )
        if category_id:
            query = query.filter(Video.category_id == int(category_id))
        candidates = query.order_by(desc(Video.is_favorite), desc(Video.updated_at)).limit(300).all()

        fresh = [v for v in candidates if v.id not in watched_ids] or candidates
        if not fresh:
            return "视频库里没有可推荐的视频。"

        lines = [f"推荐 {min(limit, len(fresh))} 个接下来可以看的视频（优先未看过的）："]
        for video in fresh[:limit]:
            lines.append(
                f"- id={video.id} 《{video.title}》 {_fmt_ts(video.duration or 0)}"
                + ("（已收藏）" if video.is_favorite else "")
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
