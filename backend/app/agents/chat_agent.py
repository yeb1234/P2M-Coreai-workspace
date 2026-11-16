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

from concurrent.futures import ThreadPoolExecutor

import json
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.prebuilt import create_react_agent

from app.agents.tools import ALL_TOOLS, set_tool_user
from app.database import SessionLocal
from app.models import AgentRun, Video
from app.services.learning_context import active_path_text
from app.services.llm import (
    ERR_UNKNOWN,
    build_chat_model,
    classify_llm_error,
    describe_llm_error,
    fallback_order,
)
from app.services.memory import load_conversation, memory_text
from app.services.profile import profile_summary_text, recompute_profile
from app.utils.files import unique_suffix

logger = logging.getLogger(__name__)

BASE_PROMPT = """你是「灵境小助手」，一个长在本地视频学习平台里的学习教练。

## 第一步：先判断话题类型，再决定要不要用工具

这是回答任何问题之前必须做的一次分流，它比后面所有规则都优先：

- **学习 / 技术 / 职业 / 学习方法** → 走检索，用工具找视频片段，按下面的规则回答。
- **生活 / 健康 / 运动 / 作息 / 饮食 / 保健品 / 情绪** → **不要调用 search_videos**。
  这类问题视频库里没有答案，检索出来的必然是无关片段。直接用画像数据和常识回答。
- **纯消遣 / 娱乐 / 站队式对比**（游戏哪家强、明星八卦） → **不要调用任何工具**。
  一句话回应，然后轻引导，别铺开聊。

判断错了会很难看：用户问「腰酸」，你回「我找到了这些相关片段」并列出三条讲睡眠和向量的视频，
这是答非所问；用户问游戏，你让他「补齐字幕」，这是荒谬。

## 你的职责
1. 帮用户从 1.4 万个视频里找到真正需要的那几分钟，而不是丢一堆链接。
2. 根据用户真实的学习行为（看了多久、完成率、投入领域）给判断，不要空泛鼓励。
3. 做学习路径规划时，必须落到「库里真实存在的视频」上，绝不虚构课程名。

## 硬性规则
- 引用视频片段时必须带上《视频标题》和时间点（mm:ss），方便用户跳转。
- 检索到 0 条就如实说没找到，并给出替代建议（换关键词/换分类/先补字幕）。禁止编造视频内容。
  这条只适用于「用户在问视频库里的内容」。生活、健康、闲聊类问题不适用 ——
  对这类问题说「字幕里没有相关内容」或让用户「补齐字幕」，只会让人觉得答非所问。
- 问「我学得怎么样」「下一步学什么」之前，必须先调用工具拿真实数据，不要凭印象回答。
- 用户已经有学习路径时，回答「下一步学什么」必须先调用 get_my_learning_path，
  按路径里排好的顺序推进；只有路径明显不合适时才建议调整，并说明理由。
- 用户的问题如果和视频库无关（写代码、查天气），正常回答但要简短，不要硬扯到视频上。
- 中文回答。技术术语保留英文原名。不用表情符号堆砌。

## 话题边界与引导

你是学习教练，不是通用聊天机器人。判断标准不是「话题敏不敏感」，
而是「能不能连回这个人的学习状态」——上面有他的真实数据，用起来，别浪费。

**处理非学习话题时，直接回答，不调用检索工具，也不要引用任何视频片段。**
回答里不要出现「参考字幕」「检索不到」「补全字幕」这类措辞 —— 用户聊腰酸、聊游戏时，
你跟他说视频字幕里没有，那是答非所问。

- **学习 / 技术 / 职业 / 路径**：全力回答，这是主业，不用考虑引导。
- **生活 / 健康 / 运动 / 作息 / 饮食 / 保健品**：可以聊，别推脱也别敷衍。
  最好的切入点是他的真实数据（连续学习天数、单次专注时长、最活跃时段），
  这些数字天然连到久坐、用眼、睡眠、颈椎。
  给常识性建议；但绝不做诊断、不推荐具体药品和剂量；保健品话题要明确说明「这不是医疗建议」。
- **纯消遣**（游戏谁更强、明星八卦、站队式对比）：一句话回应就够，别装懂也别
  说教，然后给一个真能帮到他的角度。这类问题没有客观答案，认真聊下去是无底洞。
- **用户明说「就想聊会儿」「今天不想学」**：陪他聊，不要再劝。
  一次对话最多引导一次，反复劝学比不劝更烦人。

引导的分寸：先接住他的话，再给一个具体的小动作，不要空喊「要努力」。
「你连续 22 天都在学，但单次只有 8.8 分钟——腰酸大概率是坐姿，不是学太久」
比「注意身体健康」有用得多。

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
    # 前端 detectIntent() 识别的意图 id。用来决定要不要生成「相关片段」卡片 ——
    # 不是每个意图都该推荐视频（见 _needs_video_references）。
    intent: str | None = None


# 什么时候才该给「相关片段」卡片。
#
# 用户两轮反馈叠加后的规则：
#   第一轮：问「总结我学得怎么样」甩三条不相关视频 → 学习总结这类别推
#   第二轮：问「那如果我想学 Python 呢」也推了四条前端课 → 纯查询也别推
#
# 所以从「按意图白名单」收紧成「按意图 + 问题内容双重判断」：
#
#   course-recommend  用户明确要课程/视频推荐 → 一定给
#   knowledge-qa      要看问题里有没有「视频 / 课程 / 哪节课 / 讲过」这类
#                     明确指向「找某个视频」的词。问「什么是 GC 算法」
#                     这种纯知识问题不该配视频卡片 —— 模型直接回答就好，
#                     硬塞片段只会让人以为答非所问。
#
# 其余意图（学习总结 / 路径规划 / 代码助手 / 任务拆解）一律不给。
# intent 为空时也走内容判断（而不是无脑给），避免再出现"答 Python 推前端"。
_COURSE_INTENT = "course-recommend"

# 「我要找某个视频/课程」的信号词。宁可窄一点：漏给卡片只是少个便利，
# 错给卡片会让用户怀疑整个检索是坏的。
_VIDEO_SEEKING_RE = re.compile(
    r"(?:视频|课程|教程|网课|哪一?节|第几[节课集]|哪一?集|哪一?个视频|讲过|讲过吗|有讲)"
)


def _needs_video_references(intent: str | None, message: str = "") -> bool:
    if intent == _COURSE_INTENT:
        return True
    if intent == "knowledge-qa":
        return bool(_VIDEO_SEEKING_RE.search(message or ""))
    # 认不出意图时按内容判断：问题里明确要视频才给
    if not intent:
        return bool(_VIDEO_SEEKING_RE.search(message or ""))
    return False


@dataclass
class AgentResult:
    answer: str
    session_id: str
    run_id: str
    steps: list[dict] = field(default_factory=list)
    tokens_in: int = 0
    tokens_out: int = 0
    latency_ms: int = 0
    # 实际用的通道，以及「是不是从备用通道救回来的」
    provider: str = ""
    degraded_from: str | None = None


_MEMORY_POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mem-extract")


def _schedule_memory_extract(ctx: AgentContext, user_message: str, answer: str) -> None:
    """对话结束后异步提取记忆。

    为什么异步：同步会让每轮多 2-3 秒，而记忆收益是长期的。
    为什么单线程池：提取是 LLM 调用，并发没意义，还会抢显存。

    失败一律吞掉 —— 记忆提取失败不能影响对话本身。
    """

    def _work() -> None:
        db = SessionLocal()
        try:
            from app.services.memory_extract import extract_memories

            convo = f"用户：{user_message}\n助手：{answer}"
            result = extract_memories(db, ctx.user_id, convo)
            if result.get("added") or result.get("superseded"):
                logger.info("记忆提取: %s", result)
        except Exception as exc:
            logger.warning("记忆提取异常（不影响对话）: %s", type(exc).__name__)
        finally:
            db.close()

    try:
        _MEMORY_POOL.submit(_work)
    except Exception:
        pass


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

        # 档案和助手设定放在画像和记忆之前 —— 它们定义「这个人是谁」「我该怎么说话」，
        # 后面的数据都是在这个前提下解读的。
        try:
            from app.services.memory import read_user_settings

            profile_kv, persona_kv = read_user_settings(db, ctx.user_id)
            if profile_kv:
                lines = []
                if profile_kv.get("nickname"):
                    lines.append(f"- 称呼：{profile_kv['nickname']}")
                if profile_kv.get("occupation"):
                    lines.append(f"- 职业/身份：{profile_kv['occupation']}")
                if profile_kv.get("goal"):
                    lines.append(f"- 当前目标：{profile_kv['goal']}")
                if profile_kv.get("weekly_hours"):
                    lines.append(f"- 每周可投入：约 {profile_kv['weekly_hours']} 小时")
                if profile_kv.get("timezone"):
                    lines.append(f"- 时区：{profile_kv['timezone']}")
                if lines:
                    parts.append("## 用户档案（用户自己填的，以此为准）\n" + "\n".join(lines))
            if persona_kv:
                lines = []
                if persona_kv.get("tone"):
                    lines.append(f"- 语气：{persona_kv['tone']}")
                if persona_kv.get("proactivity"):
                    lines.append(f"- 主动程度：{persona_kv['proactivity']}")
                if persona_kv.get("cite_sources"):
                    lines.append("- 引用检索到的视频时要说清来源")
                if persona_kv.get("freeform"):
                    lines.append(f"- 用户额外要求：{persona_kv['freeform']}")
                if lines:
                    parts.append("## 助手设定（用户指定，优先级高于默认风格）\n" + "\n".join(lines))
        except Exception as exc:
            logger.warning("档案/助手设定读取失败: %s", exc)

        try:
            memories = memory_text(db, ctx.user_id, limit=10)
            if memories:
                parts.append(f"## 长期记忆（用户已确认的事实与偏好）\n{memories}")
        except Exception as exc:
            logger.warning("长期记忆读取失败: %s", exc)

        # 路径是「用户自己确认过的节奏」，比模型临场发挥的建议优先级更高。
        # 放进系统提示词而不是只做成工具，是为了让模型每轮都看得见，
        # 不会在推荐时给出一套和已有路径冲突的方案。
        try:
            path_text = active_path_text(db, ctx.user_id)
            if path_text:
                parts.append(
                    "## 当前学习路径（用户已确认，回答「下一步」时优先对齐它）\n" + path_text
                )
        except Exception as exc:
            logger.warning("学习路径读取失败: %s", exc)
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


def _log_channel_failure(provider: str, exc: Exception, *, channel: str) -> None:
    logger.warning(
        "对话通道 %s 失败（%s），准备切备用：%s",
        provider,
        channel,
        describe_llm_error(exc, provider=provider),
        extra={
            "extra_fields": {
                "llm_provider": provider,
                "llm_channel": channel,
                "llm_error_kind": classify_llm_error(exc),
            }
        },
    )


def _invoke_with_fallback(order: list[str], system_prompt: str, messages: list[dict]):
    """按兜底方案依次尝试 provider，返回 (结果, 实际用的 provider, 降级来源)。

    原来这里写死 `build_chat_model("external")`：既不看设置页的「兜底方案」，
    也没有 local 兜底 —— 外部一挂用户就只能看到「对话生成失败」。
    现在 401/403/404 或 429/5xx 重试耗尽后都会自动换另一套模型。
    """
    last_exc: Exception | None = None
    for index, provider in enumerate(order):
        try:
            model = build_chat_model(provider, temperature=0.3)
            agent = create_react_agent(model, ALL_TOOLS, prompt=system_prompt)
            result = agent.invoke(
                {"messages": messages},
                config={"recursion_limit": 12},  # 防止工具调用死循环
            )
            return result, provider, (order[0] if index > 0 else None)
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            _log_channel_failure(provider, exc, channel="sync")

    assert last_exc is not None
    raise last_exc


def run_chat(ctx: AgentContext, message: str) -> AgentResult:
    """同步执行一次对话（含工具调用）。"""
    started = time.perf_counter()
    run_id = unique_suffix()

    system_prompt = build_system_prompt(ctx)
    history = _build_history(ctx)

    # 工具靠这个知道「是谁在问」，否则会读到别人的画像与路径
    set_tool_user(ctx.user_id)

    # 先按兜底方案决定第一顺位，AgentRun 里记的就是这个
    order = fallback_order()
    model = build_chat_model(order[0], temperature=0.3)

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

        result, used_provider, degraded_from = _invoke_with_fallback(order, system_prompt, messages)
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

        if answer and ctx.user_id is not None:
            _schedule_memory_extract(ctx, message, answer)

        return AgentResult(
            answer=answer or "（模型没有返回内容，请重试）",
            session_id=ctx.session_id,
            run_id=run_id,
            steps=steps,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=latency_ms,
            provider=used_provider,
            degraded_from=degraded_from,
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

    # 同上：工具需要知道当前用户。异步流式路径里工具仍在本协程上下文执行，
    # ContextVar 能正常传递。
    set_tool_user(ctx.user_id)

    # 按兜底方案决定第一顺位（原来写死 external，设置页的「兜底方案」形同虚设）
    order = fallback_order()
    model = build_chat_model(order[0], temperature=0.3, streaming=True)

    messages: list[dict] = list(history)
    messages.append({"role": "user", "content": message})

    collected: list[str] = []
    steps: list[dict] = []
    used_provider = order[0]
    degraded_from: str | None = None

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
        for index, provider in enumerate(order):
            model = build_chat_model(provider, temperature=0.3, streaming=True)
            agent = create_react_agent(model, ALL_TOOLS, prompt=system_prompt)
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
                used_provider = provider
                degraded_from = order[0] if index > 0 else None
                break
            except Exception as exc:  # noqa: BLE001
                # 已经吐过字/调过工具就不能换通道重来 —— 前端会看到两遍回答
                if collected or steps:
                    raise
                if index == len(order) - 1:
                    raise
                _log_channel_failure(provider, exc, channel="stream")

        answer = "".join(collected).strip()
        latency_ms = round((time.perf_counter() - started) * 1000)

        # 补一次轻量检索作为「引用卡片」数据源。
        # 走工具轨迹解析太脆弱（返回的是给人读的格式化文本），
        # 这里多花约 30ms 换前端可直接跳转的结构化片段。
        #
        # 只有「课程推荐 / 知识问答」才做这一步 —— 学习总结、任务拆解这类
        # 问题甩三条不相关视频出来只会干扰阅读，还白花一次 rerank 调用。
        references: list[dict] = []
        if _needs_video_references(ctx.intent, message):
            try:
                from app.services.hybrid_search import hybrid_search
                from app.utils.textclean import clean_promo_text
                from app.utils.paths import display_folder_path

                # 参数必须和 search_videos 工具（tools.py:65）一致，否则会出现
                # 「AI 回答引用了正确的课，下面相关片段却是另外三个不相关的」——
                # 因为这两批结果来自**两次不同的检索**：
                #   工具：  candidate_k=30, use_rerank=True   ← AI 实际依据
                #   卡片：  candidate_k=15, use_rerank=False  ← 用户看到的
                # 候选池小一半、还不重排，质量自然差一截。
                #
                # 代价是多一次 rerank API 调用（约 200-500ms），
                # 但比"答得对、引用却不相干"值。
                ref_result = hybrid_search(message, top_k=6, candidate_k=30, use_rerank=True)
                # 只保留真正相关的片段：低于 0.5 的多是「词面沾边」，点了也是浪费时间
                strong = [h for h in ref_result["hits"] if (h.vector_score or 0) >= 0.5]
                picked = strong[:5] if strong else ref_result["hits"][:3]
                # 显式按相关度降序，不依赖上游顺序。
                #
                # 前端「相关片段」是按数组顺序从上往下渲染的，用户扫这个列表
                # 是从上往下读 —— 所以最相关的必须排第一。
                # 这和聊天消息相反（消息是时间序，最新的在底部），
                # 两套排法混在一起就容易反。上游改了排序策略也不会影响这里。
                #
                # 用 vector_score 排而不是 rrf score：UI 上展示的分数就是
                # vector_score，排序键和显示值必须一致，否则看起来是乱的。
                picked = sorted(
                    picked,
                    key=lambda h: (h.vector_score or 0, h.score or 0),
                    reverse=True,
                )
                references = [
                    {
                        "video_id": hit.video_id,
                        "video_title": hit.video_title,
                        # 只给相对文件夹层级，不给磁盘路径（安全 + 可读性）
                        "folder_path": display_folder_path(getattr(hit, "filepath", None)),
                        "start_sec": round(hit.start_sec, 1),
                        # 带上结束时间：块平均跨 114 秒（最长 7000+ 秒），
                        # 前端只显示起点会让用户以为「就这一秒的内容」，
                        # 点进去发现要听两分钟，像是时间戳错了。
                        "end_sec": round(getattr(hit, "end_sec", None) or hit.start_sec, 1),
                        "text": clean_promo_text(hit.text)[:200],
                        "score": round(hit.vector_score or hit.lexical_score or 0, 3),
                    }
                    for hit in picked
                ]
            except Exception as exc:
                logger.warning("补充引用片段失败: %s", exc)

        # ── 正文里提到的视频 → 可点跳转 ──
        # 回答里会写《01、01-【基础认知】AI产品经理岗位及就业规划 194:47》这种，
        # 但工具返回给模型的文本里**没有 video_id**，模型也不可能凭空输出链接。
        # 所以在这里做一次反向匹配：从回答里提取所有书名号内容，
        # 去掉尾部的时长，回视频表做模糊匹配，命中的给前端一份映射，
        # 前端把对应的书名号片段渲染成可点按钮。
        mentioned_videos: list[dict] = []
        try:
            import re as _re

            raw_titles = _re.findall(r"《([^》]{2,120})》", answer or "")
            if raw_titles:
                db_lookup = SessionLocal()
                try:
                    seen_ids: set[int] = set()
                    for raw in raw_titles:
                        # 「标题 194:47」「标题 3:28-03:47」→ 去掉尾部时长
                        candidate = _re.sub(
                            r"\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s*-\s*\d{1,2}:\d{2}(?::\d{2})?)?\s*$",
                            "",
                            raw,
                        ).strip()
                        if len(candidate) < 2:
                            continue
                        matches = (
                            db_lookup.query(Video.id, Video.title)
                            .filter(Video.title.ilike(f"%{candidate}%"))
                            .limit(3)
                            .all()
                        )
                        # 多个命中时取标题最短的那个：候选串通常是标题的一部分，
                        # 最短标题最接近「AI 想指的那一个」。
                        matches.sort(key=lambda row: len(row[1] or ""))
                        for vid, _title in matches:
                            if vid in seen_ids:
                                break
                            seen_ids.add(vid)
                            mentioned_videos.append(
                                {"text": f"《{raw}》", "video_id": int(vid)}
                            )
                            break
                finally:
                    db_lookup.close()
        except Exception as exc:
            logger.warning("匹配正文视频链接失败: %s", exc)

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

        yield {
            "type": "done",
            "run_id": run_id,
            "session_id": ctx.session_id,
            "latency_ms": latency_ms,
            "steps": steps,
            "references": references,
            "mentioned_videos": mentioned_videos,
            # 前端据此提示「已降级到本地 LLM」：变慢/变差时用户能知道原因
            "provider": used_provider,
            "degraded_from": degraded_from,
        }
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
        # 别再用一句「对话生成失败」把原因盖住：能分类的就告诉用户是什么问题
        # （两台通道都试过还在 this 里，说明确实没救了）
        detail = (
            describe_llm_error(exc, provider=used_provider)
            if classify_llm_error(exc) != ERR_UNKNOWN
            else ""
        )
        yield {
            "type": "error",
            "message": f"对话生成失败：{detail}" if detail else "对话生成失败，请稍后重试或换用本地模型。",
            "provider": used_provider,
            "degraded_from": degraded_from,
        }
