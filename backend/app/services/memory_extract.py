"""对话结束后自动提取记忆。

设计要点
-------
1. **异步**：不阻塞回答。同步会让每轮多 2-3 秒，而记忆收益是长期的。
2. **二次校验**：LLM 判断「该覆盖」和代码「真的覆盖」之间必须有闸门。
   LLM 只是提议，落库规则由代码决定。
3. **pinned 免疫**：用户锁定的条目，自动提取永远不能改、不能删。
4. **软删除**：冲突时标 superseded_by，不物理删，保留改主意的历史。

调用的是外部 LLM（deepseek-v4.1），因为本地 qwen3-4b 做这种结构化判断不稳定。
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime

from sqlalchemy.orm import Session

from app.models import MemoryItem
from app.services.llm import build_chat_model

logger = logging.getLogger(__name__)

VALID_KINDS = {"fact", "preference", "goal", "constraint", "ability"}

EXTRACT_PROMPT = """你是一个记忆提取器。从下面的对话片段里，找出**值得长期记住**的信息。

只提取这几类：
- goal        目标（想达成什么）
- preference  偏好（喜欢什么方式、不喜欢什么）
- constraint  约束（时间、地点、身体、硬性限制）
- fact        稳定事实（职业、背景、所在地）
- ability     已掌握的能力

不要提取：
- 一次性的情绪（「今天好累」）
- 临时状态（「现在在吃饭」）
- 已经在已知记忆里的重复信息
- 泛泛而谈的学习建议

对每条输出：
{{"content": "一句话，不超过 40 字，用第三人称", "kind": "goal", "importance": 1-5, "confidence": 0.0-1.0,
  "conflicts_with": "如果和下面已知记忆冲突，填那条的 id，否则 null"}}

已知记忆（id: 内容）：
{existing}

最近对话：
{conversation}

只输出 JSON 数组，不要任何解释。没有值得记的就输出 []。
"""


def _existing_text(items: list[MemoryItem], limit: int = 20) -> str:
    if not items:
        return "（无）"
    lines = [f"- {m.id}: {m.content}" for m in items[:limit]]
    return "\n".join(lines)


def _parse_json_array(raw: str) -> list[dict]:
    """LLM 有时会包 ```json 或者加解释，这里尽量宽容地取出数组。"""
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    start = text.find("[")
    end = text.rfind("]")
    if start < 0 or end <= start:
        return []
    try:
        data = json.loads(text[start : end + 1])
    except (TypeError, ValueError):
        return []
    return [d for d in data if isinstance(d, dict) and d.get("content")]


def extract_memories(db: Session, user_id: int, conversation: str) -> dict:
    """从一段对话里提取记忆并落库。返回统计信息，供日志和测试使用。

    落库规则（代码说了算，不听 LLM 的）：
      - 目标条目 pinned=True          → 跳过，绝不覆盖
      - 新条目 confidence < 0.6       → 存但标低置信，不进 prompt 优先队列
      - conflicts_with 指向 pinned    → 跳过冲突，改为新增一条
      - 内容与已有条目高度重复        → 跳过
    """
    conversation = (conversation or "").strip()
    if len(conversation) < 20:
        return {"added": 0, "superseded": 0, "skipped": 0, "reason": "对话太短"}

    existing = (
        db.query(MemoryItem)
        .filter(
            MemoryItem.user_id == user_id,
            MemoryItem.superseded_by.is_(None),
        )
        .order_by(MemoryItem.pinned.desc(), MemoryItem.importance.desc())
        .limit(30)
        .all()
    )
    by_id = {m.id: m for m in existing}

    prompt = EXTRACT_PROMPT.format(
        existing=_existing_text(existing),
        conversation=conversation[-2000:],
    )

    try:
        model = build_chat_model("external", temperature=0.0, max_tokens=800, timeout_s=40)
        raw = model.invoke(prompt)
        raw_text = raw.content if hasattr(raw, "content") else str(raw)
    except Exception as exc:
        logger.warning("记忆提取调用失败: %s", type(exc).__name__)
        return {"added": 0, "superseded": 0, "skipped": 0, "reason": f"LLM 失败: {exc}"}

    candidates = _parse_json_array(raw_text)
    added = 0
    superseded = 0
    skipped = 0

    existing_contents = {m.content.strip() for m in existing}

    for cand in candidates:
        content = str(cand.get("content", "")).strip()[:200]
        kind = str(cand.get("kind", "fact")).strip().lower()
        if not content or kind not in VALID_KINDS:
            skipped += 1
            continue
        if content in existing_contents:
            skipped += 1
            continue

        try:
            importance = max(1, min(5, int(cand.get("importance", 3))))
        except (TypeError, ValueError):
            importance = 3
        try:
            confidence = max(0.0, min(1.0, float(cand.get("confidence", 0.7))))
        except (TypeError, ValueError):
            confidence = 0.7

        conflict_id = cand.get("conflicts_with")
        target = by_id.get(str(conflict_id)) if conflict_id else None

        # 闸门：pinned 的条目绝不覆盖
        if target is not None and not target.pinned and confidence >= 0.6:
            target.superseded_by = "__auto__"
            superseded += 1

        row = MemoryItem(
            id=uuid.uuid4().hex,
            user_id=user_id,
            kind=kind,
            content=content,
            source="inferred",
            importance=importance,
            pinned=False,
            confidence=confidence,
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )
        db.add(row)
        existing_contents.add(content)
        added += 1

    if added or superseded:
        db.commit()

    return {"added": added, "superseded": superseded, "skipped": skipped}
