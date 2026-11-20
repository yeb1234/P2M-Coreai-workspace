"""P2 Lite 演示环境的固定演示数据。

只对独立 demo 库运行：按 DEMO_USERNAME 重置该账号的私人数据，
不触碰其他用户，也不连接正式 Lite 的 db_p2。

数据覆盖：便签、Markdown 笔记、待办、日历事件、番茄历史、面试练习、
AI 对话历史。每次执行都会把这些内容恢复成同一份可演示状态。
"""

from __future__ import annotations

import json
import os
from datetime import datetime, time, timedelta

from app.auth import hash_password
from app.database import Base, SessionLocal, engine
from app.models import (
    CalendarEvent,
    ChatMessage,
    ChatSession,
    InterviewAttempt,
    InterviewCardState,
    Note,
    ScheduleItem,
    User,
    UserData,
)

DEMO_USERNAME = os.getenv("DEMO_USERNAME", "demo").strip().lower()
DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "P2Demo2026")
DEMO_DISPLAY_NAME = os.getenv("DEMO_DISPLAY_NAME", "演示用户")

TODAY = datetime.now().date()


def dt(day_offset: int, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(TODAY + timedelta(days=day_offset), time(hour, minute))


def iso(value: datetime) -> str:
    return value.isoformat(timespec="seconds")


def day_start(day_offset: int = 0) -> datetime:
    return dt(day_offset, 0, 0)


def day_end(day_offset: int = 0) -> datetime:
    return dt(day_offset, 23, 59)


STICKY_NOTES = [
    {
        "id": "demo-sticky-1",
        "title": "FDE 项目叙事：先讲业务闭环",
        "content": "面试先讲客户问题、交付边界、上线结果，再补技术栈。顺序反过来，面试官只会听到一堆工具名。",
        "color": "sticky-yellow",
        "pinned": True,
        "tag": "求职",
        "createdAt": iso(dt(-2, 10, 20)),
        "updatedAt": iso(dt(-1, 21, 10)),
    },
    {
        "id": "demo-sticky-2",
        "title": "RAG 召回链路复盘",
        "content": "query 改写 → 多路召回 → RRF 融合 → rerank → 上下文预算。先确认召回率，再谈生成质量。",
        "color": "sticky-blue",
        "pinned": True,
        "tag": "RAG",
        "createdAt": iso(dt(-4, 14, 0)),
        "updatedAt": iso(dt(-2, 9, 40)),
    },
    {
        "id": "demo-sticky-3",
        "title": "LangGraph 中断恢复要点",
        "content": "checkpoint 里要能找回已确认的工具名和参数；进程重启后不能让用户重新点一遍确认卡。",
        "color": "sticky-pink",
        "pinned": False,
        "tag": "Agent",
        "createdAt": iso(dt(-3, 16, 30)),
        "updatedAt": iso(dt(-1, 15, 5)),
    },
    {
        "id": "demo-sticky-4",
        "title": "FastAPI 依赖注入速记",
        "content": "Depends 解决的是请求级依赖复用；数据库 Session 的生命周期跟着请求走，别把连接挂在全局对象上。",
        "color": "sticky-green",
        "pinned": False,
        "tag": "FastAPI",
        "createdAt": iso(dt(-5, 11, 0)),
        "updatedAt": iso(dt(-3, 20, 0)),
    },
    {
        "id": "demo-sticky-5",
        "title": "本周面试反馈",
        "content": "项目数字还不够硬：QPS、P95、召回率、人工介入率都要能一句话说清。下周补压测和成本对比。",
        "color": "sticky-orange",
        "pinned": False,
        "tag": "面试",
        "createdAt": iso(dt(-1, 18, 10)),
        "updatedAt": iso(dt(0, 8, 30)),
    },
    {
        "id": "demo-sticky-6",
        "title": "演示环境检查清单",
        "content": "登录预填、便签/笔记、待办、日历、番茄、面试题库、AI 会话各走一遍；确认没有空页面和 404。",
        "color": "sticky-purple",
        "pinned": False,
        "tag": "Demo",
        "createdAt": iso(dt(0, 7, 50)),
        "updatedAt": iso(dt(0, 7, 50)),
    },
]


MD_NOTES = [
    {
        "title": "P2 Lite 演示脚本：5 分钟讲清 Agent 闭环",
        "content": """# P2 Lite 演示脚本

## 1. 先看工作台

- 今日待办、日历、番茄、便签四块数据都来自独立 demo 库。
- 数据不是截图，点进待办/日历/便签都能继续操作。

## 2. 走一条写动作

1. 打开灵境小助手，问「帮我把今天的复盘写成便签」。
2. 确认卡出现后点「确认执行」。
3. 便签页立刻出现新卡片，刷新后仍在。

## 3. 讲清技术点

| 环节 | 实现 |
| --- | --- |
| 意图识别 | Lite 能力包 + 工具白名单 |
| 写动作 | HITL 确认卡，一次性写许可 |
| 页面回填 | `done` 事件按 `target_id` 回填本地 store |
| 恢复 | checkpoint 丢失时从 `AgentRun.steps` 兜底 |

## 4. 收尾一句话

Lite 不是完整版截屏，是一套能在 2GB 共享库上跑通的交付 demo。
""",
        "createdAt": iso(dt(-2, 9, 0)),
        "updatedAt": iso(dt(0, 8, 10)),
    },
    {
        "title": "B-4-1 手写 query 改写：答题骨架、易错点与追问",
        "content": """# B-4-1 手写 query 改写

## 答题骨架

1. 先判定问题类型：事实型、比较型、流程型。
2. 抽取实体和约束，补全省略的主语。
3. 生成 2~3 个改写版本，分别覆盖同义词、上位词和英文术语。
4. 用召回结果反验改写，不把改写当成最终答案。

## 易错点

- 只做同义词替换，召回集合没有变化。
- 改写后丢掉时间、版本、环境等硬约束。
- 多路召回后不做融合，直接按分数截断。

## 追问

- 怎么评估改写有效？看 Recall@K、MRR 和最终答案采纳率。
- 改写会不会放大延迟？缓存 query 向量，并限制改写路数。
""",
        "createdAt": iso(dt(-8, 10, 0)),
        "updatedAt": iso(dt(-2, 22, 0)),
    },
    {
        "title": "RAGAS 评估指标与项目数字",
        "content": """# RAGAS 评估指标与项目数字

## 四个核心指标

- **Faithfulness**：答案是否能被检索上下文支持。
- **Answer Relevancy**：答案是否正面回应用户问题。
- **Context Precision**：相关片段是否排在前面。
- **Context Recall**：该召回的证据是否都召回。

## 项目口径

- 评测集：120 条真实问题，覆盖 Agent、RAG、FastAPI、交付流程。
- 基线：Recall@5 0.78，Faithfulness 0.81。
- 优化后：Recall@5 0.89，Faithfulness 0.87，P95 延迟 1.8s。

## 面试怎么讲

先说业务目标，再说指标怎么定，最后说哪一条指标没达标、为什么。
""",
        "createdAt": iso(dt(-6, 15, 0)),
        "updatedAt": iso(dt(-1, 19, 30)),
    },
    {
        "title": "FDE 交付流程：从需求澄清到上线复盘",
        "content": """# FDE 交付流程

1. **需求澄清**：确认客户真实目标、现有系统边界、验收口径。
2. **方案设计**：先画数据流，再定接口和权限，最后选模型。
3. **最小闭环**：用一条真实业务链路跑通，先不追求全量覆盖。
4. **上线观测**：记录失败率、人工介入率、单次任务成本。
5. **复盘**：把踩坑写成文档，下一版直接复用。

## 交付物

- 一页纸方案（问题 → 方案 → 数字）
- 部署脚本与回滚步骤
- 验收清单和已知边界
""",
        "createdAt": iso(dt(-10, 11, 0)),
        "updatedAt": iso(dt(-4, 17, 20)),
    },
    {
        "title": "Redis 多 DB 隔离与队列设计",
        "content": """# Redis 多 DB 隔离与队列设计

## 为什么要隔离

多个项目共用一个 Redis 时，key 前缀和 DB 编号必须同时约束，否则队列和缓存会互相污染。

## 当前约定

- P1：DB 0
- P2 Lite：DB 1，前缀 `p2:`
- P2 Demo：独立 DB，前缀 `p2demo:`
- 队列使用 `noeviction`，缓存写满宁可报错也不丢任务。

## 失败路径

- 入队失败要返回可重试错误，不能静默吞掉。
- 消费端必须幂等，重复投递不能产生两条业务记录。
""",
        "createdAt": iso(dt(-12, 9, 30)),
        "updatedAt": iso(dt(-5, 21, 0)),
    },
]


def seed_user(db) -> User:
    user = db.query(User).filter(User.username == DEMO_USERNAME).first()
    if user is None:
        user = User(username=DEMO_USERNAME)
        db.add(user)
    user.display_name = DEMO_DISPLAY_NAME
    user.password_hash = hash_password(DEMO_PASSWORD)
    user.role = "admin"
    user.is_active = True
    user.token_version = 0
    db.flush()
    return user


def reset_user_data(db, user: User) -> None:
    session_ids = [
        row[0]
        for row in db.query(ChatSession.id).filter(ChatSession.user_id == user.id).all()
    ]
    if session_ids:
        db.query(ChatMessage).filter(ChatMessage.session_id.in_(session_ids)).delete(
            synchronize_session=False
        )
    db.query(ChatSession).filter(ChatSession.user_id == user.id).delete(
        synchronize_session=False
    )
    db.query(Note).filter(Note.user_id == user.id).delete(synchronize_session=False)
    db.query(ScheduleItem).filter(ScheduleItem.user_id == user.id).delete(
        synchronize_session=False
    )
    db.query(CalendarEvent).filter(CalendarEvent.user_id == user.id).delete(
        synchronize_session=False
    )
    db.query(InterviewAttempt).filter(InterviewAttempt.user_id == user.id).delete(
        synchronize_session=False
    )
    db.query(InterviewCardState).filter(InterviewCardState.user_id == user.id).delete(
        synchronize_session=False
    )
    db.query(UserData).filter(UserData.user_id == user.id).delete(
        synchronize_session=False
    )


def seed_notes(db, user: User) -> None:
    for item in STICKY_NOTES:
        db.add(
            Note(
                user_id=user.id,
                scope="private",
                surface="sticky",
                source="manual",
                title=item["title"],
                content=item["content"],
                created_at=datetime.fromisoformat(item["createdAt"]),
                updated_at=datetime.fromisoformat(item["updatedAt"]),
            )
        )
    for item in MD_NOTES:
        db.add(
            Note(
                user_id=user.id,
                scope="private",
                surface="md",
                source="manual",
                title=item["title"],
                content=item["content"],
                created_at=datetime.fromisoformat(item["createdAt"]),
                updated_at=datetime.fromisoformat(item["updatedAt"]),
            )
        )


def seed_schedule(db, user: User) -> None:
    rows = [
        # 今日待办：一条已完成、一条进行中、两条待处理
        {
            "id": "demo-todo-1",
            "type": "todo",
            "title": "整理 FDE 项目一页纸（问题 → 方案 → 数字）",
            "description": "把客户问题、方案边界、上线指标压到 1 页；面试时 3 分钟讲完。",
            "status": "pending",
            "priority": "high",
            "start_at": day_start(),
            "due_at": day_end(),
            "pomodoro_count": 2,
            "sort_order": 0,
        },
        {
            "id": "demo-todo-2",
            "type": "todo",
            "title": "把 LangGraph 中断恢复画成时序图",
            "description": "覆盖 checkpoint 丢失、从 AgentRun.steps 兜底、重复确认拒绝三条路径。",
            "status": "in_progress",
            "priority": "medium",
            "start_at": day_start(),
            "due_at": day_end(),
            "pomodoro_count": 1,
            "pomodoro_rounds": 1,
            "total_focus_minutes": 25,
            "sort_order": 1,
        },
        {
            "id": "demo-todo-3",
            "type": "todo",
            "title": "刷 5 道 Agent / RAG 面试题并录音",
            "description": "优先 B-1-1、B-1-2、B-3-1、B-4-1；录音后回听卡壳点。",
            "status": "pending",
            "priority": "high",
            "start_at": dt(1, 0, 0),
            "due_at": day_end(1),
            "pomodoro_count": 2,
            "sort_order": 2,
        },
        {
            "id": "demo-todo-4",
            "type": "todo",
            "title": "FastAPI 依赖注入复盘",
            "description": "请求级 Session、依赖覆盖、异常处理各写一个最小例子。",
            "status": "completed",
            "priority": "low",
            "start_at": day_start(),
            "due_at": day_end(),
            "pomodoro_count": 2,
            "pomodoro_rounds": 2,
            "total_focus_minutes": 50,
            "completed_at": dt(0, 10, 30),
            "sort_order": 3,
        },
        {
            "id": "demo-todo-5",
            "type": "todo",
            "title": "复盘上周面试反馈，改简历项目段",
            "description": "补 QPS、P95、召回率、人工介入率；每条数字都要有口径。",
            "status": "pending",
            "priority": "high",
            "start_at": day_start(-1),
            "due_at": day_end(-1),
            "pomodoro_count": 2,
            "sort_order": 4,
        },
        {
            "id": "demo-todo-6",
            "type": "todo",
            "title": "准备 3 分钟自我介绍（中英各一版）",
            "description": "中文版对国内岗位，英文版对海外业务岗位；开头先给岗位匹配点。",
            "status": "completed",
            "priority": "medium",
            "start_at": day_start(-1),
            "due_at": day_end(-1),
            "pomodoro_count": 1,
            "pomodoro_rounds": 1,
            "total_focus_minutes": 25,
            "completed_at": dt(-1, 20, 0),
            "sort_order": 5,
        },
        # 今日日程
        {
            "id": "demo-event-1",
            "type": "event",
            "title": "晨会 · 交付同步",
            "description": "同步当前项目风险、今天要收口的演示项。",
            "status": "pending",
            "priority": "medium",
            "start_at": dt(0, 9, 30),
            "due_at": dt(0, 9, 50),
            "sort_order": 10,
        },
        {
            "id": "demo-event-2",
            "type": "event",
            "title": "产品演示彩排",
            "description": "按 5 分钟脚本走一遍：工作台 → 待办 → 便签 → AI 确认卡。",
            "status": "pending",
            "priority": "high",
            "start_at": dt(0, 15, 0),
            "due_at": dt(0, 16, 0),
            "sort_order": 11,
        },
        {
            "id": "demo-event-3",
            "type": "event",
            "title": "技术面试模拟",
            "description": "重点练 Agent 循环、RAG 评估、故障恢复三类追问。",
            "status": "pending",
            "priority": "high",
            "start_at": dt(0, 19, 30),
            "due_at": dt(0, 20, 30),
            "sort_order": 12,
        },
        {
            "id": "demo-event-4",
            "type": "event",
            "title": "和导师复盘项目",
            "description": "带一页纸方案和演示录屏，收集下一版改进点。",
            "status": "pending",
            "priority": "medium",
            "start_at": dt(1, 10, 0),
            "due_at": dt(1, 11, 0),
            "sort_order": 13,
        },
        {
            "id": "demo-event-5",
            "type": "event",
            "title": "FDE 岗位投递批次",
            "description": "优先有海外业务/出差机会的中厂，投 5 家并记录 JD 关键词。",
            "status": "pending",
            "priority": "medium",
            "start_at": dt(2, 14, 0),
            "due_at": dt(2, 15, 0),
            "sort_order": 14,
        },
        {
            "id": "demo-event-6",
            "type": "event",
            "title": "周复盘",
            "description": "看本周番茄、面试得分、笔记产出，决定下周主攻方向。",
            "status": "pending",
            "priority": "low",
            "start_at": dt(4, 17, 0),
            "due_at": dt(4, 18, 0),
            "sort_order": 15,
        },
    ]
    for row in rows:
        db.add(
            ScheduleItem(
                user_id=user.id,
                deleted_at=None,
                created_at=dt(-2, 9, 0),
                updated_at=dt(0, 7, 40),
                **row,
            )
        )


def seed_pomodoro(db, user: User) -> None:
    sessions = {
        "demo-focus-1": {
            "id": "demo-focus-1",
            "todoId": "demo-todo-4",
            "phase": "work",
            "plannedDuration": 25,
            "actualDuration": 25,
            "completed": True,
            "startTime": iso(dt(0, 9, 0)),
            "endTime": iso(dt(0, 9, 25)),
            "calendarEventId": None,
        },
        "demo-focus-2": {
            "id": "demo-focus-2",
            "todoId": "demo-todo-4",
            "phase": "work",
            "plannedDuration": 25,
            "actualDuration": 25,
            "completed": True,
            "startTime": iso(dt(0, 9, 35)),
            "endTime": iso(dt(0, 10, 0)),
            "calendarEventId": None,
        },
        "demo-focus-3": {
            "id": "demo-focus-3",
            "todoId": "demo-todo-2",
            "phase": "work",
            "plannedDuration": 25,
            "actualDuration": 25,
            "completed": True,
            "startTime": iso(dt(0, 13, 40)),
            "endTime": iso(dt(0, 14, 5)),
            "calendarEventId": None,
        },
        "demo-focus-4": {
            "id": "demo-focus-4",
            "todoId": None,
            "phase": "work",
            "plannedDuration": 25,
            "actualDuration": 25,
            "completed": True,
            "startTime": iso(dt(-1, 20, 0)),
            "endTime": iso(dt(-1, 20, 25)),
            "calendarEventId": None,
        },
    }
    snapshot = {
        "kind": "pomodoro-history-v2",
        "sessions": sessions,
        "deviceId": "demo-seed",
        "updatedAt": iso(datetime.now()),
    }
    db.add(
        UserData(
            user_id=user.id,
            store_key="p2m-pomodoro-history-v2",
            value=json.dumps(snapshot, ensure_ascii=False),
        )
    )


def seed_notes_snapshot(db, user: User) -> None:
    snapshot = {
        "kind": "notes-v1",
        "notes": STICKY_NOTES,
        "trash": {},
        "updatedAt": iso(datetime.now()),
    }
    db.add(
        UserData(
            user_id=user.id,
            store_key="p2m-notes-v1",
            value=json.dumps(snapshot, ensure_ascii=False),
        )
    )


def seed_interview(db, user: User) -> None:
    questions = {
        "B-1-1": ("手写 ReAct 循环", "agent", 82, "pass", "today"),
        "B-1-2": ("简化 LangGraph", "agent", 76, "borderline", "yesterday"),
        "B-4-1": ("手写 query 改写", "agent", 91, "pass", "three_days_ago"),
        "B-2-1": ("手写 tool schema", "agent", 68, "fail", "four_days_ago"),
    }

    def when(kind: str) -> datetime:
        if kind == "today":
            return datetime.now() - timedelta(hours=2)
        if kind == "yesterday":
            return dt(-1, 16, 20)
        if kind == "three_days_ago":
            return dt(-3, 11, 10)
        return dt(-4, 15, 30)

    for qid, (title, group, score, verdict, kind) in questions.items():
        feedback = {
            "dimensions": [
                {"name": "概念准确性", "score": score, "comment": "术语基本准确，能区分相近概念。"},
                {"name": "链路完整性", "score": score - 3, "comment": "主链路完整，恢复路径还可以再具体。"},
                {"name": "边界与失败路径", "score": score - 6, "comment": "提到了超时和重试，缺少幂等细节。"},
                {"name": "项目落地", "score": score - 2, "comment": "有项目例子，数字还可以再加一条。"},
            ],
            "strengths": ["先给结论再展开", "能落到自己的项目"],
            "gaps": ["失败路径只讲了一层", "缺少可验证的指标数字"],
            "rewrite": "建议按「问题 → 方案 → 数据 → 边界」四段重写，每段不超过三句。",
            "followUps": ["如果工具连续失败两次，循环怎么退出？", "这套方案的成本怎么估算？"],
        }
        db.add(
            InterviewAttempt(
                id=f"demo-attempt-{qid}",
                user_id=user.id,
                question_id=qid,
                group_key=group,
                question_title=title,
                mode="evaluate",
                answer="演示数据：这是该题的一份示例作答，重点覆盖主链路和失败路径。",
                score=score,
                verdict=verdict,
                feedback=feedback,
                provider="demo-seed",
                model="demo-data",
                latency_ms=900,
                created_at=when(kind),
            )
        )
        db.add(
            InterviewCardState(
                user_id=user.id,
                question_id=qid,
                starred=qid in {"B-1-1", "B-4-1"},
                mastered=score >= 80,
                confidence=2 if score >= 80 else 1,
                last_score=score,
                practice_count=1,
                last_practiced_at=when(kind),
            )
        )


def seed_chat(db, user: User) -> None:
    sessions = [
        (
            "demo-chat-1",
            "近期学习与求职复盘",
            [
                (
                    "demo-msg-1",
                    "user",
                    "我最近学习状态怎么样？下一步该补什么？",
                ),
                (
                    "demo-msg-2",
                    "assistant",
                    "从站内记录看，你这周的动作比较集中在三块：\n\n"
                    "1. **Agent/RAG 基础**：完成了 ReAct 循环、LangGraph 和 query 改写的练习。\n"
                    "2. **交付表达**：待办里已经有 FDE 一页纸和演示彩排，但项目数字还没补齐。\n"
                    "3. **面试训练**：最近 4 次练习平均 79 分，边界与失败路径是最弱的一项。\n\n"
                    "下一步建议先把「QPS / P95 / 召回率 / 人工介入率」四个数字写进项目一页纸，"
                    "再用 B-1-1 做一次录音复述。",
                ),
                (
                    "demo-msg-3",
                    "user",
                    "帮我把今天的复盘写成便签。",
                ),
                (
                    "demo-msg-4",
                    "assistant",
                    "可以。我会走确认卡，确认后再写入便签，不会直接改你的数据。",
                ),
            ],
            datetime.now() - timedelta(hours=3),
        ),
        (
            "demo-chat-2",
            "P2 Lite 演示讲解",
            [
                (
                    "demo-msg-5",
                    "user",
                    "用一段话介绍这个 Lite 演示环境。",
                ),
                (
                    "demo-msg-6",
                    "assistant",
                    "这是一个独立的 P2 Lite 演示库：保留工作台、待办、日历、便签、笔记、"
                    "番茄钟、数据中心、面试题库和灵境小助手，不接视频库和转写流水线。"
                    "登录页已经填好演示账号，点登录就能看到一整套可操作的样例数据。",
                ),
            ],
            datetime.now() - timedelta(hours=1),
        ),
    ]
    for session_id, title, messages, created_at in sessions:
        db.add(
            ChatSession(
                id=session_id,
                title=title,
                scope="global",
                user_id=user.id,
                message_count=len(messages),
                created_at=created_at,
                updated_at=created_at + timedelta(minutes=10),
            )
        )
        # ChatMessage 只有外键、没有 ORM relationship；先 flush 父行，
        # 避免 SQLAlchemy 在同一次 flush 里把子表排在父表前面。
        db.flush()
        for index, (message_id, role, content) in enumerate(messages):
            db.add(
                ChatMessage(
                    id=message_id,
                    session_id=session_id,
                    role=role,
                    content=content,
                    created_at=created_at + timedelta(minutes=index * 3),
                )
            )


def main() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        user = seed_user(db)
        reset_user_data(db, user)
        seed_notes(db, user)
        seed_schedule(db, user)
        seed_notes_snapshot(db, user)
        seed_pomodoro(db, user)
        seed_interview(db, user)
        seed_chat(db, user)
        db.commit()

        counts = {
            "notes": db.query(Note).filter(Note.user_id == user.id).count(),
            "schedule": db.query(ScheduleItem).filter(ScheduleItem.user_id == user.id).count(),
            "interviews": db.query(InterviewAttempt).filter(InterviewAttempt.user_id == user.id).count(),
            "chat_sessions": db.query(ChatSession).filter(ChatSession.user_id == user.id).count(),
        }
        print(f"demo seed ok user={DEMO_USERNAME} {counts}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
