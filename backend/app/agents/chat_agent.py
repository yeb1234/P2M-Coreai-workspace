"""对话 Agent 运行时（LangGraph ReAct）。

上下文装配顺序（少一层都会让回答变傻）：
1. 固定人设与行为准则
2. 学习者画像（真实观看数据，不是编的）
3. 长期记忆（目标/偏好/约束）
4. 会话摘要（更早的对话压缩）
5. 最近若干轮原文
6. 当前问题
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.prebuilt import create_react_agent

from app.agents.tools import ALL_TOOLS
from app.database import SessionLocal
from app.models import AgentRun
from app.services.llm import build_chat_model
from app.services.memory import load_conversation, memory_text
from app.services.profile import profile_summary_text, recompute_profile
from app.utils.files import unique_suffix

logger = logging.getLogger(__name__)

BASE_PROMPT = """你是「灵境小助手」，一个长在本地视频学习平台里的学习教练。

## 你的职责
1. 帮用户从 1.4 万个视频里找到真正需要的那几分钟，而不是丢一堆链接。
2. 根据用户真实的学习行为（看了多久、完成率、投入领域）给判断，不要空泛鼓励。
3. 做学习路径规划时，必须落到「库里真实存在的视频」上，绝不虚构课程名。

## 硬性规则
- 引用视频片段时必须带上《视频标题》和时间点（mm:ss），方便用户跳转。
- 检索到 0 条就如实说没找到，并给出替代建议（换关键词/换分类/先补字幕）。禁止编造内容。
- 问「我学得怎么样」「下一步学什么」之前，必须先调用工具拿真实数据，不要凭印象回答。
- 用户的问题如果和视频库无关（写代码、查天气），正常回答但要简短，不要硬扯到视频上。
- 中文回答。技术术语保留英文原名。不用表情符号堆砌。

## 输出长度
默认 150-400 字。除非用户明确要求展开，否则不要写长文。"""


@dataclass
class AgentContext:
    session_id: str
    user_id: int | None = None
    video_id: int | None = None
    page_context: str = ""
    system_prompt_extra: str = ""
    history_limit: int = 10


@dataclass
class AgentResult:
    answer: str
    session_id: str
    run_id: str
    steps: list[dict] = field(default_factory=list)
    tokens_in: int = 0
    tokens_out: int = 0
    latency_ms: int = 0


def build_system_prompt(ctx: AgentContext) -> str:
    """拼装系统提示词。任何一段取不到都跳过，不影响对话。"""
    parts = [BASE_PROMPT]

    if ctx.system_prompt_extra.strip():
        parts.append(f"## 用户自定义要求\n{ctx.system_prompt_extra.strip()}")

    db = SessionLocal()
    try:
        try:
            profile = recompute_profile(db, ctx.user_id)
            parts.append(f"## 学习者真实数据\n{profile_summary_text(profile)}")
        except Exception as exc:
            logger.warning("画像读取失败: %s", exc)

        try:
            memories = memory_text(db, ctx.user_id, limit=10)
            if memories:
                parts.append(f"## 长期记忆（用户已确认的事实与偏好）\n{memories}")
        except Exception as exc:
            logger.warning("长期记忆读取失败: %s", exc)
    finally:
        db.close()

    if ctx.page_context.strip():
        parts.append(f"## 当前页面上下文\n{ctx.page_context.strip()[:800]}")

    return "\n\n".join(parts)


def _build_history(ctx: AgentContext) -> list[dict]:
    db = SessionLocal()
    try:
        conv = load_conversation(db, ctx.session_id, recent_limit=ctx.history_limit)
    finally:
        db.close()

    messages: list[dict] = []
    if conv.summary:
        messages.append(
            {
                "role": "system",
                "content": f"以下是本次对话更早部分的摘要，用于保持连续性：\n{conv.summary}",
            }
        )
    messages.extend(conv.messages)
    return messages


def _extract_steps(messages: list) -> list[dict]:
    """从 LangGraph 的消息序列里还原工具调用轨迹，用于审计与前端展示。"""
    steps: list[dict] = []
    pending: dict[str, dict] = {}

    for message in messages:
        if isinstance(message, AIMessage):
            for call in getattr(message, "tool_calls", None) or []:
                step = {
                    "tool": call.get("name"),
                    "args": call.get("args"),
                    "id": call.get("id"),
                    "ok": None,
                }
                steps.append(step)
                if call.get("id"):
                    pending[call["id"]] = step
        elif isinstance(message, ToolMessage):
            step = pending.get(getattr(message, "tool_call_id", ""))
            if step is not None:
                content = message.content if isinstance(message.content, str) else str(message.content)
                step["ok"] = not content.startswith(("Error", "Traceback"))
                step["result_preview"] = content[:200]
    return steps


def _usage_of(messages: list) -> tuple[int, int]:
    tokens_in = tokens_out = 0
    for message in messages:
        usage = getattr(message, "usage_metadata", None) or {}
        if isinstance(usage, dict):
            tokens_in += int(usage.get("input_tokens") or 0)
            tokens_out += int(usage.get("output_tokens") or 0)
    return tokens_in, tokens_out


def run_chat(ctx: AgentContext, message: str) -> AgentResult:
    """同步执行一次对话（含工具调用）。"""
    started = time.perf_counter()
    run_id = unique_suffix()

    system_prompt = build_system_prompt(ctx)
    history = _build_history(ctx)

    model = build_chat_model("external", temperature=0.3)
    agent = create_react_agent(model, ALL_TOOLS, prompt=system_prompt)

    messages: list[dict] = list(history)
    messages.append({"role": "user", "content": message})

    db = SessionLocal()
    try:
        db.add(
            AgentRun(
                id=run_id,
                session_id=ctx.session_id,
                user_id=ctx.user_id,
                kind="chat",
                status="running",
                input_text=message,
                model=getattr(model, "model_name", None),
            )
        )
        db.commit()

        result = agent.invoke(
            {"messages": messages},
            config={"recursion_limit": 12},  # 防止工具调用死循环
        )
        out_messages = result.get("messages", [])
        answer = ""
        for item in reversed(out_messages):
            if isinstance(item, AIMessage) and isinstance(item.content, str) and item.content.strip():
                answer = item.content.strip()
                break

        steps = _extract_steps(out_messages)
        tokens_in, tokens_out = _usage_of(out_messages)
        latency_ms = round((time.perf_counter() - started) * 1000)

        run = db.query(AgentRun).filter(AgentRun.id == run_id).first()
        if run:
            run.status = "completed"
            run.output_text = answer[:4000]
            run.steps = steps
            run.tokens_in = tokens_in
            run.tokens_out = tokens_out
            run.latency_ms = latency_ms
            db.commit()

        return AgentResult(
            answer=answer or "（模型没有返回内容，请重试）",
            session_id=ctx.session_id,
            run_id=run_id,
            steps=steps,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=latency_ms,
        )
    except Exception as exc:
        logger.exception("Agent 执行失败")
        run = db.query(AgentRun).filter(AgentRun.id == run_id).first()
        if run:
            run.status = "failed"
            run.error = str(exc)[:1000]
            run.latency_ms = round((time.perf_counter() - started) * 1000)
            db.commit()
        raise
    finally:
        db.close()


async def stream_chat(ctx: AgentContext, message: str):
    """异步流式执行，yield SSE 事件字典。

    事件类型：token / tool_start / tool_end / done / error
    """
    started = time.perf_counter()
    run_id = unique_suffix()
    system_prompt = build_system_prompt(ctx)
    history = _build_history(ctx)

    model = build_chat_model("external", temperature=0.3, streaming=True)
    agent = create_react_agent(model, ALL_TOOLS, prompt=system_prompt)

    messages: list[dict] = list(history)
    messages.append({"role": "user", "content": message})

    collected: list[str] = []
    steps: list[dict] = []

    db = SessionLocal()
    try:
        db.add(
            AgentRun(
                id=run_id,
                session_id=ctx.session_id,
                user_id=ctx.user_id,
                kind="chat",
                status="running",
                input_text=message,
                model=getattr(model, "model_name", None),
            )
        )
        db.commit()
    finally:
        db.close()

    try:
        async for event in agent.astream_events(
            {"messages": messages},
            config={"recursion_limit": 12},
            version="v2",
        ):
            kind = event.get("event")
            if kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                text = getattr(chunk, "content", "")
                if isinstance(text, str) and text:
                    collected.append(text)
                    yield {"type": "token", "text": text}
            elif kind == "on_tool_start":
                step = {
                    "tool": event.get("name"),
                    "args": event.get("data", {}).get("input"),
                    "ok": None,
                }
                steps.append(step)
                yield {"type": "tool_start", "tool": step["tool"]}
            elif kind == "on_tool_end":
                output = event.get("data", {}).get("output")
                content = getattr(output, "content", output)
                preview = str(content)[:200]
                if steps:
                    steps[-1]["ok"] = not preview.startswith(("Error", "Traceback"))
                    steps[-1]["result_preview"] = preview
                yield {"type": "tool_end", "tool": event.get("name"), "ok": steps[-1].get("ok") if steps else None}

        answer = "".join(collected).strip()
        latency_ms = round((time.perf_counter() - started) * 1000)

        db = SessionLocal()
        try:
            run = db.query(AgentRun).filter(AgentRun.id == run_id).first()
            if run:
                run.status = "completed"
                run.output_text = answer[:4000]
                run.steps = steps
                run.latency_ms = latency_ms
                db.commit()
        finally:
            db.close()

        yield {"type": "done", "run_id": run_id, "latency_ms": latency_ms, "steps": steps}
    except Exception as exc:
        logger.exception("流式对话失败")
        db = SessionLocal()
        try:
            run = db.query(AgentRun).filter(AgentRun.id == run_id).first()
            if run:
                run.status = "failed"
                run.error = str(exc)[:1000]
                db.commit()
        finally:
            db.close()
        yield {"type": "error", "message": "对话生成失败，请稍后重试或换用本地模型。"}
