"""把学习路径压缩成 LLM 可读的上下文。

为什么单独一层
--------------
同一条路径有两种消费方：
- 对话 Agent：需要「用户现在走到第几步、下一步是什么、哪些还没做」
- 规划 Agent：需要「已有路径长什么样」，避免重复规划已经覆盖的内容

两者需要的粒度不同，所以统一在这里出文本、按用途裁剪，而不是各自拼 SQL。

另一个作用是**约束模型不要瞎编**：路径里的每个步骤都绑定过库里真实存在的视频，
模型看到这些标题后，推荐时倾向于对齐已有路径，而不是凭空发明一门课。
"""

from __future__ import annotations

import logging

from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.models import LearningPath, Video

logger = logging.getLogger(__name__)

# 上下文上限：太长会挤掉检索结果，也会让模型忽略重点
MAX_STEPS = 12
MAX_VIDEOS_PER_STEP = 3


def _fmt_minutes(minutes: int | None) -> str:
    total = int(minutes or 0)
    if total < 60:
        return f"{total} 分钟"
    hours, mins = divmod(total, 60)
    return f"{hours} 小时" + (f" {mins} 分钟" if mins else "")


def active_path_text(db: Session, user_id: int | None, *, include_videos: bool = True) -> str:
    """返回当前路径的可读摘要。没有路径时返回空字符串，调用方自行决定怎么提示。"""
    path = (
        db.query(LearningPath)
        .filter(
            LearningPath.user_id == user_id,
            LearningPath.status.in_(["active", "draft"]),
        )
        .order_by(desc(LearningPath.created_at))
        .first()
    )
    if not path:
        return ""

    steps = path.steps[:MAX_STEPS]
    done = sum(1 for s in steps if s.status == "done")
    total_est = sum(int(s.est_minutes or 0) for s in steps)
    done_est = sum(int(s.est_minutes or 0) for s in steps if s.status == "done")

    lines = [
        f"【当前学习路径】{path.title}",
        f"进度：{done}/{len(steps)} 步完成，已投入约 {_fmt_minutes(done_est)}，整条路径预计 {_fmt_minutes(total_est)}",
    ]
    if path.summary:
        lines.append(f"规划思路：{path.summary[:200]}")

    # 视频标题按需批量取，避免 N+1
    video_map: dict[int, str] = {}
    if include_videos:
        all_ids = {int(v) for s in steps for v in (s.video_ids or [])}
        if all_ids:
            rows = db.query(Video.id, Video.title).filter(Video.id.in_(all_ids)).all()
            video_map = {int(r[0]): r[1] for r in rows}

    lines.append("步骤：")
    for index, step in enumerate(steps, 1):
        mark = {"done": "已完成", "in_progress": "进行中", "skipped": "已跳过"}.get(
            step.status, "未开始"
        )
        lines.append(f"{index}. [{mark}] {step.title}（约 {_fmt_minutes(step.est_minutes)}）")
        if step.objective:
            lines.append(f"   目标：{step.objective[:120]}")
        if include_videos and step.video_ids:
            names = [
                f"《{video_map[v]}》" for v in step.video_ids[:MAX_VIDEOS_PER_STEP] if v in video_map
            ]
            if names:
                lines.append("   素材：" + "、".join(names))

    return "\n".join(lines)


