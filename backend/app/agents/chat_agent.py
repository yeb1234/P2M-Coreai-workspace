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

from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, SystemMessage, ToolMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import create_react_agent
from langgraph.types import Command, interrupt

from app.agents.tool_runtime import build_governed_toolset
from app.agents.tools import (
    ask_user,
    begin_search_trace,
    current_run_id,
    set_tool_note_context,
    set_tool_run,
    set_tool_user,
    take_search_hits,
)
from app.agents.write_guard import (
    WRITE_TOOL_LABELS,
    WRITE_TOOL_NAMES,
    clear_write_grants,
    grant_write,
)
from app.database import SessionLocal, settings
from app.models import AgentRun, Video
from app.services.learning_context import active_path_text
from app.services.agent_actions import actions_for_run
from app.services.llm import (
    ERR_UNKNOWN,
    build_chat_model,
    classify_llm_error,
    describe_llm_error,
    fallback_order,
)
from app.services.memory import load_conversation, memory_text
from app.services.profile import get_profile_data, profile_summary_text
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

## 主动澄清、补充与确认

你有一个 `ask_user` 工具，可以在执行前暂停并给用户 A/B/C 选项。它不是装饰，
是避免「猜错意图后白跑一轮」的刹车。只有下面三种情况才用：

1. **意图澄清**：同一句话存在两种以上合理解释，且选错会改变答案方向。
   例：用户说「帮我规划一下学习」，先问是「按现有路径继续 / 换一个方向 / 先做能力诊断」。
2. **人工补充**：缺少执行必需的关键信息，例如目标岗位、时间预算、要保存的标题或范围。
3. **人工确认**：保存笔记、总结后另存、创建日历、创建 Todo 等写操作由运行时确认闸门自动暂停，
   不要提前用 `ask_user` 问「要不要执行」，直接调用对应写工具，图会在真正写入前弹出确认卡。
   覆盖/删除类操作仍用 `ask_user` 的 confirm 先问清范围。

使用规则：
- 一次只问一个问题，2-4 个选项，选项要短、互斥、能直接执行；前端会自动补「其它（自己填写）」。
- 能从上下文、画像、历史记录里查到的信息，不要问。
- 简单知识问答、明确检索、闲聊不要调用 `ask_user`，不要为了显得礼貌而打断用户。
- 用户回答后必须按选择继续执行，不要换个说法重复问同一个问题。
- 保存类写操作不要预先调用 `ask_user`；运行时确认闸门会兜底，用户确认前不会落库。

## 输出长度
默认 150-400 字。除非用户明确要求展开，否则不要写长文。"""


LITE_BASE_PROMPT = """你是「灵境小助手 Lite」，P2 Lite 的面试与学习 Agent。

## 这个版本没有什么
- 没有视频库、视频字幕、视频检索，也没有向量索引；不要声称能找视频或课程片段。
- 没有学习路径规划器；不要承诺生成或调整学习路径。
- 你的知识来自通用模型能力、面试题库、知识库文章、私人笔记和用户档案；
  Lite 站内的 Todo、日历、笔记、面试练习和使用痕迹，只能通过
  `get_lite_learning_status` 工具读取，不能凭空编造。

## 你的职责
1. 讲解面试题：先给结论，再给关键点、易错点和可能的追问。
2. 用户问「有没有类似题」时，检索题库；问概念时，检索知识库文章。
3. 用户要保存笔记、建待办或排日历，直接调用对应工具，由确认卡兜底。
4. 用户问学习安排时，结合当前时间、笔记和已确认的目标给可执行的小步骤，不编造课程。
5. 用户问「我最近学得怎么样 / 学习状态 / 坚持得如何」时，必须先调用
   `get_lite_learning_status`，只基于它返回的站内记录评价；记录少就直说
   「这段时间站内数据很少」，不要用视频观看、课程进度或学习时长来补。

## 硬性规则
- 不引用视频标题、时间点或「第几节课」，不编造站内内容。
- 检索 0 条就如实说没找到，并建议换关键词或直接讲通用解法。
- 中文回答，技术术语保留英文原名；不用表情符号堆砌。
- 默认 150-400 字；用户明确要求展开时再写长。

## 主动澄清与确认
有 `ask_user` 时，仅在意图存在两种以上合理解释、或缺少执行必需信息时使用。
保存笔记、创建日历、创建 Todo 等写操作不要预先询问；直接调工具，运行时确认闸门会暂停。
"""


@dataclass
class AgentContext:
    session_id: str
    user_id: int | None = None
    video_id: int | None = None
    page_context: str = ""
    # 当前笔记的完整标题/正文。page_context 只放前 800 字给模型看，
    # 保存工具需要全文，所以单独放在请求体并在工具层用 ContextVar 取。
    note_context: dict[str, str] | None = None
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
#   question-answer   直接讲代码/技术概念，正文不依赖视频库；相关片段
#                     只作为回答后的延伸推荐，因此也生成 references
#   knowledge-qa      要看问题里有没有「视频 / 课程 / 哪节课 / 讲过」这类
#                     明确指向「找某个视频」的词。问「什么是 GC 算法」
#                     这种纯知识问题不该配视频卡片 —— 模型直接回答就好，
#                     硬塞片段只会让人以为答非所问。
#
# 其余意图（学习总结 / 路径规划 / 代码助手 / 任务拆解）一律不给。
# intent 为空时也走内容判断（而不是无脑给），避免再出现"答 Python 推前端"。
_COURSE_INTENT = "course-recommend"
_QUESTION_ANSWER_INTENT = "question-answer"
_INTERVIEW_INTENT = "interview-question"

# 「我要找某个视频/课程」的信号词。宁可窄一点：漏给卡片只是少个便利，
# 错给卡片会让用户怀疑整个检索是坏的。
_VIDEO_SEEKING_RE = re.compile(
    r"(?:视频|课程|教程|网课|哪一?节|第几[节课集]|哪一?集|哪一?个视频|讲过|讲过吗|有讲)"
)


def _needs_video_references(intent: str | None, message: str = "") -> bool:
    if settings.is_lite:
        return False
    if intent == _COURSE_INTENT:
        return True
    # 问题解答的正文来自通用知识，相关视频是回答后的延伸入口；
    # 前端只对该意图渲染卡片。
    if intent == _QUESTION_ANSWER_INTENT:
        return True
    # 面试题讲解默认不推视频；只有用户明确要视频/课程，或在题目详情里点
    # “推荐相关视频”时才生成引用卡片，避免每道题都挂一堆不相关课程。
    if intent == _INTERVIEW_INTENT:
        return bool(_VIDEO_SEEKING_RE.search(message or ""))
    if intent == "knowledge-qa":
        return bool(_VIDEO_SEEKING_RE.search(message or ""))
    # 认不出意图时按内容判断：问题里明确要视频才给
    if not intent:
        return bool(_VIDEO_SEEKING_RE.search(message or ""))
    return False


def _tools_for_intent(intent: str | None, user_id: int | None = None):
    """兼容旧调用：返回该意图对应的 governed tool 列表。

    真正的策略在 `app.agents.skills` 里：question-answer 是零工具包，
    其他意图只拿自己那组工具，不再把全部工具无脑挂给模型。
    """
    return build_governed_toolset(intent, user_id=user_id).tools


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

# HITL（human-in-the-loop）中断状态只保存在进程内。
# 单机/单容器足够支撑一次「问一句 → 用户点选项 → 继续」；
# 多 worker 或重启后要恢复，需要换 SqliteSaver/PostgresSaver 或落库。
_HITL_CHECKPOINTER = MemorySaver()

# 写操作的人工确认不能只靠提示词：模型完全可能直接传 confirm=true。
# 这里在图层面加一道闸门，模型刚生成 tool_calls、工具还没执行时先中断。
# 写工具名单与许可逻辑集中在 write_guard，工具侧会消费一次性许可。
# 注意：hook 在 LangGraph 图节点里运行，不能把它包进线程池，否则会丢暂停上下文。
_WRITE_TOOL_NAMES = WRITE_TOOL_NAMES
_WRITE_TOOL_LABELS = WRITE_TOOL_LABELS


def _tool_call_name(call) -> str:
    if isinstance(call, dict):
        return str(call.get("name") or "")
    return str(getattr(call, "name", "") or "")


def _tool_call_args(call) -> dict:
    if isinstance(call, dict):
        args = call.get("args")
        return args if isinstance(args, dict) else {}
    args = getattr(call, "args", None)
    return args if isinstance(args, dict) else {}


def _write_call_preview(name: str, args: dict) -> str:
    """确认卡上给用户看的具体对象，不要只写工具名。"""
    title = str(args.get("title") or "").strip()
    if name in {"save_note", "summarize_and_save_note"}:
        body = str(args.get("content") or "").strip()
        suffix = f"（{len(body)} 字）" if body else "（当前页面笔记）"
        return f"《{title or '未命名笔记'}》{suffix}"
    if name == "create_calendar_event":
        when = " ".join(
            part for part in (
                str(args.get("date") or "").strip(),
                str(args.get("start_time") or "").strip(),
            ) if part
        )
        return f"《{title or '未命名日程'}》{f'（{when}）' if when else ''}"
    if name == "create_todo":
        due = str(args.get("due_date") or "").strip()
        try:
            rounds = max(0, int(args.get("pomodoro_rounds") or 0))
        except (TypeError, ValueError):
            rounds = 0
        details = []
        if due:
            details.append(f"截止 {due}")
        if rounds:
            details.append(f"预计 {rounds} 个番茄")
        suffix = f"（{'，'.join(details)}）" if details else ""
        return f"《{title or '未命名 Todo'}》{suffix}"
    return title or name


def _is_write_approved(selected: str, label_text: str, text: str) -> bool:
    """判断确认卡的选择是否真的是“确认”。

    不能只做 `"确认" in text`：用户回“不确认”“取消确认”时同样包含
    “确认”两个字，会被误判成批准。这里先排除否定词，再要求确认语义。
    """
    if selected == "B":
        return False
    if selected == "A" or "确认" in label_text:
        return True
    candidate = text.strip()
    negative = ("不确认", "不要", "不用", "取消", "否", "别")
    return bool(candidate) and "确认" in candidate and not any(
        word in candidate for word in negative
    )


def _pending_write_step(steps: list[dict] | None) -> dict | None:
    """从审计轨迹里找回「已弹确认卡、但工具还没执行」的那一步。

    这层兜底只服务于写操作：checkpoint 丢失后仍能凭这一步的参数完成
    用户已经确认过的写入，不需要重新问一遍模型，也不会重新生成动作。
    """
    for step in reversed(steps or []):
        if not isinstance(step, dict):
            continue
        if step.get("tool") not in WRITE_TOOL_NAMES:
            continue
        if step.get("ok") is None:
            return step
    return None


def _write_result_ok(result: str) -> bool:
    """工具返回的是自然语言；用稳定的失败前缀判断，而不是假设一定抛异常。"""
    text = str(result or "").strip()
    return not any(
        marker in text
        for marker in (
            "失败",
            "需要用户明确确认",
            "请先登录",
            "没有可保存的内容",
            "正文太长",
            "Error:",
            "Traceback",
        )
    )


def _write_confirmation_hook(state):
    """模型决定写个人数据后、ToolNode 真正落库前，暂停一次并等待人工确认。

    返回空 dict 表示放行；返回一条新的 AIMessage 表示取消本轮写操作。
    取消时不要保留原 AIMessage 的 tool_calls，否则图还会继续调度工具。
    """
    messages = state.get("messages") or ()
    if not messages:
        return {}
    last = messages[-1]
    tool_calls = list(getattr(last, "tool_calls", None) or [])
    write_calls = [
        call for call in tool_calls
        if _tool_call_name(call) in _WRITE_TOOL_NAMES
    ]
    if not write_calls:
        return {}

    # 一次只确认一个动作。模型如果一口气生成多个写调用，全部拒绝，
    # 避免用户点一次「确认」实际改了笔记 + 日历 + Todo 三处。
    if len(write_calls) > 1:
        names = "、".join(_tool_call_name(call) for call in write_calls)
        return {
            "messages": [
                AIMessage(
                    content=(
                        f"检测到一次性发起了 {len(write_calls)} 个写动作（{names}）。"
                        "本轮一个都没有执行。请只保留一个动作，等我确认后再继续。"
                    )
                )
            ]
        }

    name = _tool_call_name(write_calls[0])
    args = _tool_call_args(write_calls[0])
    label = _WRITE_TOOL_LABELS.get(name, name)
    preview = _write_call_preview(name, args)
    answer = interrupt(
        {
            "kind": "confirm",
            "question": f"执行前确认：准备{label}。确认写入吗？",
            "options": [
                {"id": "A", "label": "确认执行"},
                {"id": "B", "label": "取消，不写入"},
            ],
            "allow_custom": True,
            "context": f"将要执行：{label} {preview}。确认后才会写入；取消不会产生任何改动。",
        }
    )

    selected = ""
    label_text = ""
    text = ""
    if isinstance(answer, dict):
        selected = str(answer.get("selected") or answer.get("selected_id") or "").strip()
        text = str(answer.get("text") or "").strip()
        for option in ({"id": "A", "label": "确认执行"}, {"id": "B", "label": "取消，不写入"}):
            if selected == option["id"] or selected == option["label"]:
                selected = option["id"]
                label_text = option["label"]
                break
    elif answer is not None:
        text = str(answer).strip()
        if text in {"A", "a", "A.", "a."}:
            selected = "A"

    approved = _is_write_approved(selected, label_text, text)
    if approved:
        # 用户确认后发放一次性许可；工具侧只认这个许可，不再认模型传入的
        # confirm=true。这样同步 /chat 等没有 HITL 的链路也写不进去。
        grant_write(name, current_run_id())
        return {}

    suffix = f" 你的补充：{text}" if text else ""
    return {
        "messages": [
            AIMessage(
                content=f"已取消写入，没有保存任何内容。{suffix} 需要调整标题、正文或保存位置时，直接告诉我。"
            )
        ]
    }


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
    parts = [LITE_BASE_PROMPT if settings.is_lite else BASE_PROMPT]

    if ctx.system_prompt_extra.strip():
        parts.append(f"## 用户自定义要求\n{ctx.system_prompt_extra.strip()}")

    db = SessionLocal()
    try:
        if not settings.is_lite:
            try:
                profile_data = get_profile_data(db, ctx.user_id)
                parts.append(f"## 学习者真实数据\n{profile_summary_text(profile_data)}")
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
        # Lite 没有学习路径模块，整段跳过。
        if not settings.is_lite:
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
        parts.append(f"## 当前页面上下文\n{ctx.page_context.strip()[:2200]}")

    # 日期要显式给模型：模型本身不知道「今天」是哪天，安排日历/ Todo 时会算错。
    now = datetime.now()
    parts.append(
        "## 当前时间\n"
        f"{now.strftime('%Y-%m-%d %H:%M')}（Asia/Shanghai）\n"
        "安排日历或 Todo 时以这个时间为基准；日期写成 YYYY-MM-DD，时间写成 HH:MM。"
    )

    # 个人动作工具在所有意图下都可用，但必须把「写」和「说」分开。
    # 这里专门堵住历史问题：模型没调工具，却在回答里说「确认卡应该弹出来了」。
    parts.append(
        "## 个人动作工具（任何意图下都可调用）\n"
        "- 保存笔记：save_note；总结后保存：summarize_and_save_note；\n"
        "- 安排日历：create_calendar_event；创建待办：create_todo。\n"
        "- 用户明确要求执行时，直接调用对应工具，不要先用 ask_user 问「要不要」；\n"
        "  运行时会在真正写入前弹出确认卡，用户确认后才落库。\n"
        "- 创建 Todo 时同时给 pomodoro_rounds：按任务内容估 1–8 个番茄，\n"
        "  只是截止日期落在某一天并不等于要占满 24 小时，不要因此默认成 8 个。\n"
        "- 一次只执行一个写动作，不要把同一个计划拆成多个笔记、多个日程或多个 Todo。\n"
        "  Todo 只创建一个汇总大块，把步骤写进同一个 content，不拆碎项。\n"
        "- 没有真正调用工具时，绝对不要声称「确认卡已弹出」「已保存」「已加入日历」\n"
        "  或「已创建 Todo」。只有工具返回了成功结果，才能说已经写入。\n"
        "- 用户说「可以 / 好 / 行」承接上一轮保存/排期建议时，按上一轮的具体对象执行，\n"
        "  不要把确认卡当成已经发生过的事实。\n"
        "- 承接上一轮「保存这份清单/这段回答」时，把要保存的正文完整写进 content；\n"
        "  只传标题不传正文，工具会在确认后报「没有可保存的内容」。"
    )

    if ctx.intent == "note-save" and ctx.note_context and ctx.note_context.get("markdown"):
        title = ctx.note_context.get("title") or "未命名笔记"
        length = len(ctx.note_context.get("markdown") or "")
        parts.append(
            "## 当前笔记（保存目标）\n"
            f"标题：{title}\n正文长度：{length} 字（完整正文已随请求传给工具，不在提示词里展开）\n"
            "用户本轮要求保存笔记。工具选择：\n"
            "- 只保存原文：调用 save_note，content 留空；\n"
            "- 总结后保存：调用 summarize_and_save_note，content 留空，工具会读取完整正文并生成总结；\n"
            "- 两个工具都只在用户明确要求保存时直接调用；confirm 由运行时人工确认闸门补上，\n"
            "  不要在回答里假装已经保存；\n"
            "- 不要用回答正文冒充笔记保存，也不要把原文改写后再保存。"
        )
    elif ctx.intent == "note-save":
        parts.append(
            "## 本轮意图：保存笔记\n"
            "当前没有打开笔记正文。如果用户在本轮给出了要保存的内容，或明确要求保存"
            "上一轮回答，把完整正文写进 save_note 的 content 再调用；"
            "如果用户既没给正文也没说要保存什么，先让用户提供内容，不要空调用。"
        )

    if ctx.intent == _QUESTION_ANSWER_INTENT:
        parts.append(
            "## 本轮意图：问题解答（优先于上面的检索分流）\n"
            "用户问的是具体的代码/技术概念，不是让你找站内视频。\n"
            "- 直接依据通用知识与最小可验证示例回答，先把概念讲清楚；\n"
            "- 不调用任何工具，不声称「视频库里讲过」，不编造视频标题或时间点；\n"
            "- 站内视频只作为回答后的延伸推荐。若回答已经完整，结尾用一句话自然引导："
            "「如果你想更系统地看，我可以按这个方向给你推荐站内相关视频。」"
        )

    if ctx.intent == _INTERVIEW_INTENT:
        parts.append(
            "## 本轮意图：面试题讲解（当前页面是面试题库）\n"
            "先读「当前页面上下文」里的当前标签、题号、题干、评分点和追问。\n"
            "- 用户说「这题 / 继续 / 展开 / 再讲讲 / 标准答案」时，默认指当前题号，"
            "不要反问是哪一道；先给答题骨架，再展开关键点和易错点。\n"
            "- 页面上下文只有题目开头，需要完整参考答案时调用 get_interview_question；"
            "用户提到另一道题，也先用它按题号/标题取题。\n"
            "- 用户要同类题、下一题、按分组/题型练：调用 search_interview_questions。\n"
            "- 用户问原理、争议、版本演进、设计取舍：调用 search_interview_knowledge，"
            "并保留文章标题与来源链接。\n"
            "- 视频推荐只在用户明确说「视频 / 课程 / 相关视频 / 推荐视频」时做："
            "调用 search_videos；需要核对某门课的时长/摘要时再用 get_video_summary。"
            "正文必须写《视频标题》和 mm:ss，找不到就如实说，不要拿无关课程凑数。"
            "不要用 search_video_titles 搜「ReAct」这类词，它会把前端 React 课也带进来。\n"
            "- 当前标签对应的功能：题库/项目题 → 题目讲解与同类题；模拟面试 → 按评分点"
            "给追问和追问方向；知识库 → 先检索专题；原书 → 引用书页。"
            "用户问「这个页面还能做什么」时，只按当前标签回答，不要编造不存在的页面功能。\n"
            "- 不要直接粘贴整篇参考答案；先给结论/骨架，再给 3-5 个关键点，"
            "最后给 1-2 个面试官可能追问的问题。"
        )

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


def _invoke_with_fallback(
    order: list[str],
    system_prompt: str,
    messages: list[dict],
    *,
    tools: list | None = None,
):
    """按兜底方案依次尝试 provider，返回 (结果, 实际用的 provider, 降级来源)。

    原来这里写死 `build_chat_model("external")`：既不看设置页的「兜底方案」，
    也没有 local 兜底 —— 外部一挂用户就只能看到「对话生成失败」。
    现在 401/403/404 或 429/5xx 重试耗尽后都会自动换另一套模型。
    """
    last_exc: Exception | None = None
    active_tools = tools if tools is not None else []
    for index, provider in enumerate(order):
        try:
            model = build_chat_model(provider, temperature=0.3)
            agent = create_react_agent(model, active_tools, prompt=system_prompt)
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
    set_tool_run(run_id, ctx.session_id)
    set_tool_note_context(ctx.note_context)
    # 同步路径原来没有清空检索轨迹，引用区可能继承上一轮命中；这里补上。
    begin_search_trace()
    # 同步 /chat 没有 HITL 确认卡，不能挂写工具。历史上这条链路曾让模型
    # 直接调用 create_todo，用户没点确认却已经落库；现在只给它只读工具。
    toolset = build_governed_toolset(
        ctx.intent, user_id=ctx.user_id, allow_writes=False
    )
    system_prompt += (
        "\n\n## 当前是同步只读接口\n"
        "本接口没有确认卡，不能创建 Todo、日历、笔记，也不能执行任何写操作。\n"
        "如果用户要求保存或创建，明确告诉他：请在聊天窗口中确认后执行，"
        "或改用流式对话入口；不要声称已经写入。"
    )
    logger.info(
        "agent_toolset",
        extra={
            "extra_fields": {
                "skill": toolset.skill.name,
                "skill_version": toolset.skill.version,
                "tools": list(toolset.tool_names),
                "max_tool_calls": toolset.budget.max_total_calls,
            }
        },
    )

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

        result, used_provider, degraded_from = _invoke_with_fallback(
            order,
            system_prompt,
            messages,
            tools=toolset.tools,
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


def _recover_stale_write(
    *,
    ctx: AgentContext,
    resume: dict,
    run_id: str,
    started: float,
    tools: list,
):
    """确认卡还在、但 LangGraph 的内存 checkpoint 已经丢了时的兜底。

    典型场景：Lite 后端在用户点「确认执行」前被重建/重启。卡片来自旧进程，
    MemorySaver 里的暂停点随进程消失，直接 resume 会断开 SSE，页面只剩一句
    「请求失败」。这里用 AgentRun.steps 里已保存的工具名和参数，把用户已经
    确认过的这一次写入直接执行掉；没有确认（B）就只记录取消，绝不补写。
    """
    db = SessionLocal()
    try:
        run = db.query(AgentRun).filter(AgentRun.id == run_id).first()
        if run is None:
            yield {"type": "error", "message": "找不到这条确认对应的执行记录，请重新发起。"}
            return
        if run.status == "completed":
            yield {"type": "error", "message": "这条确认已经执行过了，不需要重复提交。"}
            return

        steps = [dict(item) for item in (run.steps or []) if isinstance(item, dict)]
        pending = _pending_write_step(steps)
        if pending is None:
            run.status = "failed"
            run.error = "HITL checkpoint lost and no pending write step"
            db.commit()
            yield {
                "type": "error",
                "message": "确认状态已失效（后端重启过），且没有找到待执行的写入。请重新发起这条操作。",
            }
            return

        name = str(pending.get("tool") or "")
        args = pending.get("args") if isinstance(pending.get("args"), dict) else {}
        selected = str(resume.get("selected") or "").strip()
        text = str(resume.get("text") or "").strip()
        approved = _is_write_approved(selected, "", text)

        if not approved:
            result = "已取消写入，没有保存任何内容。需要调整标题、正文或保存位置时，直接告诉我。"
            pending["ok"] = False
            pending["result_preview"] = "用户取消"
            latency_ms = round((time.perf_counter() - started) * 1000)
            run.status = "completed"
            run.output_text = result[:4000]
            run.steps = steps
            run.latency_ms = latency_ms
            run.error = None
            db.commit()
            yield {"type": "token", "text": result}
            yield {
                "type": "done",
                "run_id": run_id,
                "session_id": ctx.session_id,
                "latency_ms": latency_ms,
                "steps": steps,
                "actions": [],
                "references": [],
                "mentioned_videos": [],
                "provider": "hitl-recovery",
            }
            return

        tool = next((item for item in tools if getattr(item, "name", "") == name), None)
        if tool is None:
            run.status = "failed"
            run.error = f"pending write tool unavailable: {name}"
            db.commit()
            yield {
                "type": "error",
                "message": f"确认状态已恢复，但当前执行器没有挂载 {name}，请重新发起这条操作。",
            }
            return

        grant_write(name, run_id)
        try:
            result = str(tool.invoke(args))
        except Exception as exc:  # noqa: BLE001 - 工具失败也要变成可读回执
            logger.exception("HITL 兜底执行写入失败")
            result = f"写入失败：{exc}"
        finally:
            clear_write_grants(run_id)

        ok = _write_result_ok(result)
        pending["ok"] = ok
        pending["result_preview"] = result[:200]
        latency_ms = round((time.perf_counter() - started) * 1000)
        run.status = "completed" if ok else "failed"
        run.output_text = result[:4000]
        run.steps = steps
        run.latency_ms = latency_ms
        run.error = None if ok else result[:1000]
        db.commit()

        logger.info(
            "HITL 兜底完成写入",
            extra={
                "extra_fields": {
                    "run_id": run_id,
                    "tool": name,
                    "ok": ok,
                    "provider": "hitl-recovery",
                }
            },
        )

        actions = actions_for_run(db, user_id=ctx.user_id, run_id=run_id)
        yield {"type": "token", "text": result}
        yield {
            "type": "done",
            "run_id": run_id,
            "session_id": ctx.session_id,
            "latency_ms": latency_ms,
            "steps": steps,
            "actions": actions,
            "references": [],
            "mentioned_videos": [],
            "provider": "hitl-recovery",
        }
    finally:
        db.close()
        clear_write_grants(run_id)


async def stream_chat(
    ctx: AgentContext,
    message: str,
    *,
    resume: dict | None = None,
    run_id: str | None = None,
    original_message: str | None = None,
):
    """异步流式执行，yield SSE 事件字典。

    事件类型：token / tool_start / tool_end / interrupt / done / error

    普通请求使用 `messages` 启动；HITL 中断后用同一个 run_id + `Command(resume)`
    续跑。中断状态存在 `_HITL_CHECKPOINTER`，所以续跑时不需要把上一轮
    用户消息再塞一遍——否则模型会看到两条相同问题。
    """
    started = time.perf_counter()
    run_id = run_id or unique_suffix()
    source_message = (original_message or message).strip()
    system_prompt = build_system_prompt(ctx)
    history = _build_history(ctx) if not resume else []

    # 同上：工具需要知道当前用户。异步流式路径里工具仍在本协程上下文执行，
    # ContextVar 能正常传递。
    set_tool_user(ctx.user_id)
    set_tool_run(run_id, ctx.session_id)
    set_tool_note_context(ctx.note_context)
    # 清空上一轮的检索命中：引用卡片只认本轮工具实际召回的片段
    begin_search_trace()
    toolset = build_governed_toolset(ctx.intent, user_id=ctx.user_id)
    logger.info(
        "agent_toolset",
        extra={
            "extra_fields": {
                "skill": toolset.skill.name,
                "skill_version": toolset.skill.version,
                "tools": [*toolset.tool_names, "ask_user"],
                "max_tool_calls": toolset.budget.max_total_calls,
                "hitl": bool(resume),
            }
        },
    )

    # 按兜底方案决定第一顺位（原来写死 external，设置页的「兜底方案」形同虚设）
    order = fallback_order()

    # 确认卡跨进程失效：MemorySaver 只在当前进程里有暂停点。Lite 重建/重启后，
    # 旧卡片再点「确认执行」会拿不到 checkpoint，直接 resume 只会断开 SSE。
    # 这里先用审计轨迹里的待写参数兜底，能写就直接写，绝不把用户确认吞掉。
    if resume:
        checkpoint = await _HITL_CHECKPOINTER.aget_tuple(
            {"configurable": {"thread_id": run_id}}
        )
        if checkpoint is None:
            for event in _recover_stale_write(
                ctx=ctx,
                resume=resume,
                run_id=run_id,
                started=started,
                tools=toolset.tools,
            ):
                yield event
            return

    model = build_chat_model(order[0], temperature=0.3, streaming=True)

    messages: list[dict] = list(history)
    if not resume:
        messages.append({"role": "user", "content": message})

    collected: list[str] = []
    steps: list[dict] = []
    used_provider = order[0]
    degraded_from: str | None = None

    db = SessionLocal()
    try:
        run = db.query(AgentRun).filter(AgentRun.id == run_id).first()
        if run:
            run.status = "running"
            run.error = None
            # HITL resume 是同一轮执行的续跑，上一段已经发生的工具轨迹
            # 存在 AgentRun.steps 里；不能从空列表重新开始，否则审计丢前半段。
            if resume and isinstance(run.steps, list):
                steps = [dict(item) for item in run.steps if isinstance(item, dict)]
        else:
            db.add(
                AgentRun(
                    id=run_id,
                    session_id=ctx.session_id,
                    user_id=ctx.user_id,
                    kind="chat",
                    status="running",
                    input_text=source_message,
                    model=getattr(model, "model_name", None),
                )
            )
        db.commit()
    finally:
        db.close()

    graph_input = Command(resume=resume) if resume else {"messages": messages}
    started_tool_calls = {
        str(step.get("tool_call_id"))
        for step in steps
        if step.get("tool_call_id")
    }

    try:
        for index, provider in enumerate(order):
            model = build_chat_model(provider, temperature=0.3, streaming=True)
            agent = create_react_agent(
                model,
                [*toolset.tools, ask_user],
                prompt=system_prompt,
                checkpointer=_HITL_CHECKPOINTER,
                post_model_hook=_write_confirmation_hook,
            )
            try:
                async for mode, payload in agent.astream(
                    graph_input,
                    config={
                        "recursion_limit": 12,
                        "configurable": {"thread_id": run_id},
                    },
                    stream_mode=["messages", "updates"],
                ):
                    if mode == "messages":
                        chunk, metadata = payload
                        if metadata.get("langgraph_node") != "agent":
                            continue
                        if not isinstance(chunk, (AIMessage, AIMessageChunk)):
                            continue
                        text = getattr(chunk, "content", "")
                        if isinstance(text, str) and text:
                            collected.append(text)
                            yield {"type": "token", "text": text}

                        # tool_start 从模型返回的 tool_calls 里取；
                        # ask_user 不展示成普通工具步骤，避免前端出现
                        # 「调用工具…」转圈后被中断卡片打断。
                        for call in getattr(chunk, "tool_calls", None) or []:
                            call_id = str(call.get("id") or "")
                            name = str(call.get("name") or "")
                            if not call_id or call_id in started_tool_calls or name == "ask_user":
                                continue
                            started_tool_calls.add(call_id)
                            step = {
                                "tool": name,
                                "args": call.get("args"),
                                "ok": None,
                                "tool_call_id": call_id,
                            }
                            steps.append(step)
                            yield {"type": "tool_start", "tool": name}
                        continue

                    # updates 里才会出现真正的 __interrupt__。
                    # 这是 HITL 的暂停点：流在这里结束，前端渲染 A/B/C 卡片。
                    if "__interrupt__" in payload:
                        interrupts = payload["__interrupt__"] or ()
                        first = interrupts[0] if interrupts else None
                        value = getattr(first, "value", None)
                        if not isinstance(value, dict):
                            value = {}
                        interrupt_id = str(getattr(first, "id", "") or "")
                        db = SessionLocal()
                        try:
                            run = db.query(AgentRun).filter(AgentRun.id == run_id).first()
                            if run:
                                run.status = "awaiting_input"
                                run.latency_ms = round((time.perf_counter() - started) * 1000)
                                # 中断时也要先把已发生的工具调用落盘：
                                # resume 会以这份 steps 为前半段轨迹继续补全。
                                run.steps = steps
                                db.commit()
                        finally:
                            db.close()
                        yield {
                            "type": "interrupt",
                            "run_id": run_id,
                            "session_id": ctx.session_id,
                            "interrupt_id": interrupt_id,
                            "kind": value.get("kind", "clarify"),
                            "question": value.get("question", ""),
                            "options": value.get("options", []),
                            "allow_custom": bool(value.get("allow_custom", True)),
                            "context": value.get("context", ""),
                            "intent": ctx.intent,
                            "original_message": source_message,
                        }
                        return

                    # updates.agent.messages 里有完整 tool_calls 参数；
                    # 只靠 messages 流的 chunk.tool_calls，写进 AgentRun 的
                    # args 经常是 {}（截图里 search_video_titles 就是这样）。
                    # 这里用完整消息把同一个 tool_call_id 的 args 补齐。
                    if "agent" in payload:
                        for message in payload.get("agent", {}).get("messages", []) or []:
                            if not isinstance(message, AIMessage):
                                continue
                            for call in getattr(message, "tool_calls", None) or []:
                                call_id = str(call.get("id") or "")
                                if not call_id:
                                    continue
                                full_args = call.get("args")
                                matched = next(
                                    (item for item in steps if item.get("tool_call_id") == call_id),
                                    None,
                                )
                                if matched is None:
                                    matched = {
                                        "tool": str(call.get("name") or ""),
                                        "args": full_args,
                                        "ok": None,
                                        "tool_call_id": call_id,
                                    }
                                    steps.append(matched)
                                else:
                                    matched["args"] = full_args

                    if "tools" in payload:
                        tool_messages = payload.get("tools", {}).get("messages", [])
                        for tool_message in tool_messages:
                            if not isinstance(tool_message, ToolMessage):
                                continue
                            if tool_message.name == "ask_user":
                                continue
                            call_id = str(getattr(tool_message, "tool_call_id", "") or "")
                            content = getattr(tool_message, "content", "")
                            preview = str(content)[:200]
                            matched = next(
                                (item for item in steps if item.get("tool_call_id") == call_id),
                                steps[-1] if steps else None,
                            )
                            if matched is not None:
                                matched["ok"] = not preview.startswith(("Error", "Traceback"))
                                matched["result_preview"] = preview
                            yield {
                                "type": "tool_end",
                                "tool": tool_message.name,
                                "ok": matched.get("ok") if matched else None,
                            }

                # 有些模型工具返回后只补一小段“我先检索一下”就结束，
                # 真正的答案留在最终状态里而不在 stream token 里。
                # 当前可见文本过短时，再从最终状态补一次正文，避免用户
                # 只看到一句工具预告。
                current_text = "".join(collected).strip()
                if len(current_text) < 30:
                    try:
                        snapshot = await agent.aget_state(
                            {"configurable": {"thread_id": run_id}}
                        )
                        values = getattr(snapshot, "values", None) or {}
                        for item in reversed(values.get("messages", [])):
                            if not isinstance(item, AIMessage):
                                continue
                            content = item.content
                            if not isinstance(content, str) or not content.strip():
                                continue
                            final_text = content.strip()
                            if final_text and final_text not in current_text:
                                collected.append(final_text)
                                yield {"type": "token", "text": final_text}
                            break
                    except Exception:  # noqa: BLE001 - 兜底展示，不影响主流程
                        logger.debug("读取最终回答失败", exc_info=True)

                # 写操作确认放行后，工具会真正执行；有些模型在工具返回后
                # 不再补一句自然语言，直接拿“确认前”的旧文本会误导用户。
                # 优先用最后一个成功写工具的结果作为可见回答。
                if not collected:
                    write_steps = [
                        step for step in steps
                        if step.get("tool") in _WRITE_TOOL_NAMES and step.get("ok")
                    ]
                    if write_steps:
                        result_text = str(write_steps[-1].get("result_preview") or "").strip()
                        if result_text:
                            collected.append(result_text)
                            yield {"type": "token", "text": result_text}

                # post_model_hook 取消写操作时返回的是一条 AIMessage，
                # 它不属于 `agent` 的流式 token；这里从最终状态补一次正文，
                # 否则用户点“取消”后会看到空白回答。
                if not collected:
                    try:
                        snapshot = await agent.aget_state(
                            {"configurable": {"thread_id": run_id}}
                        )
                        values = getattr(snapshot, "values", None) or {}
                        for item in reversed(values.get("messages", [])):
                            if not isinstance(item, AIMessage):
                                continue
                            content = item.content
                            if isinstance(content, str) and content.strip():
                                collected.append(content)
                                yield {"type": "token", "text": content}
                                break
                    except Exception:  # noqa: BLE001 - 兜底展示，不影响主流程
                        logger.debug("读取 HITL 最终状态失败", exc_info=True)

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
        # 只有「课程推荐 / 问题解答 / 明确找视频的知识问答」才做这一步 ——
        # 学习总结、任务拆解这类问题甩三条不相关视频出来只会干扰阅读，
        # 还白花一次 rerank 调用。
        references: list[dict] = []
        if _needs_video_references(ctx.intent, source_message):
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
                # 指代消解：「那如果我想学 Java 呢」这种短句单看没有锚点，
                # 检索会完全飘走（实测推回四条前端课，和上文毫无关系）。
                # 把上一条用户消息的关键词拼进来当检索 query。
                #
                # 只影响检索，不影响意图判断（用原话更准）和 LLM（它本来
                # 就有完整 history，再塞一遍是重复）。
                from app.services.query_rewrite import resolve_anaphora

                prev_user: str | None = None
                for _m in reversed(history):
                    if _m.get("role") == "user" and (_m.get("content") or "").strip() != source_message.strip():
                        prev_user = _m.get("content")
                        break
                retrieval_query = resolve_anaphora(source_message, prev_user)

                # 引用卡片的数据源：优先用模型**真正看过**的那批命中。
                #
                # 旧实现是回答生成完再跑一次 hybrid_search 取结构化字段，
                # 于是正文和引用区来自两轮不同的检索 —— 实测会出现
                # 「正文点名了某视频，下面引用卡片却没有它」，或者卡片有、
                # 正文没提。参数对齐只能降低概率，消不掉。
                traced = take_search_hits()
                if traced:
                    cited = [
                        re.sub(
                            r"\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s*-\s*\d{1,2}:\d{2}(?::\d{2})?)?\s*$",
                            "",
                            raw,
                        ).strip()
                        for raw in re.findall(r"《([^》]{2,120})》", answer or "")
                    ]
                    cited = [item for item in cited if len(item) >= 2]

                    def _hit_cited(hit, _titles=cited) -> bool:
                        title = hit.video_title or ""
                        return any(t in title or title in t for t in _titles)

                    # 正文点名的排前面，其余按相关度补位；最多 5 张卡，
                    # 再多用户点不过来，还挤压正文。
                    picked = sorted(
                        traced[:12],
                        key=lambda h: (
                            1 if _hit_cited(h) else 0,
                            h.vector_score or 0,
                            h.score or 0,
                        ),
                        reverse=True,
                    )[:5]
                else:
                    # 模型没调检索工具（纯概念题 / 闲聊），退化成一次独立检索
                    ref_result = hybrid_search(retrieval_query, top_k=6, candidate_k=30, use_rerank=True)
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
                        # 课程 / 章 / 课时 + 序号（第 N/M 节、上一节、下一节）。
                        #
                        # folder_path 只到前 2 层，对「黑马前端V7.6 / 5-5 jQuery动画」
                        # 这种已经在第 4、5 层的课，看不出是第几章哪一节。
                        # meta 是元数据通道算好的结构化线索，直接给前端渲染。
                        # 取不到就是 None，前端去掉这一行即可。
                        "meta": getattr(hit, "meta", None),
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
        action_records: list[dict] = []
        try:
            run = db.query(AgentRun).filter(AgentRun.id == run_id).first()
            if run:
                run.status = "completed"
                run.output_text = answer[:4000]
                run.steps = steps
                run.latency_ms = latency_ms
                db.commit()
            action_records = actions_for_run(db, user_id=ctx.user_id, run_id=run_id)
        finally:
            db.close()

        # 正常结束/异常结束都清掉未消费的许可，避免同一 run_id 残留到下一轮。
        clear_write_grants(run_id)

        yield {
            "type": "done",
            "run_id": run_id,
            "session_id": ctx.session_id,
            "latency_ms": latency_ms,
            "steps": steps,
            "actions": action_records,
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
        clear_write_grants(run_id)
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
