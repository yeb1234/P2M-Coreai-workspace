"""生成演示用的播放行为数据。

场景依据真实处境：Python / FastAPI / LangChain / RAG / LangGraph 都学过一轮，
但「评估、测试、上线」这三块工程化闭环是空的。所以数据要能体现：
- 技术栈主题：大量观看，完成度 77%~88%（学过但没收尾）
- 评估 / 测试 / 上线：几乎为零，或点开几分钟就关（一头雾水）

生成的数据全部带 `demo-` 前缀的 session_id，方便随时清掉：
    DELETE FROM watch_events WHERE session_id LIKE 'demo-%';

用法：
    python scripts/seed_demo_watch.py            # 生成
    python scripts/seed_demo_watch.py --clean    # 只清理 demo 数据
    python scripts/seed_demo_watch.py --reset    # 先清再生成
"""

from __future__ import annotations

import argparse
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text

from app.database import SessionLocal
from app.models import User, Video, WatchEvent, WatchHistory
from app.services.profile import recompute_profile, profile_summary_text

random.seed(20261115)  # 固定种子，重跑结果一致

DEMO_PREFIX = "demo-"
HEARTBEAT_SEC = 15

# 主题 -> (标题匹配, 目标完成度, 取几个视频)
LEARNED_TOPICS = [
    ("Python", "%python%", 0.80, 12),
    ("FastAPI", "%fastapi%", 0.85, 6),
    ("LangChain", "%langchain%", 0.77, 4),
    ("RAG", "%rag%", 0.88, 18),
    ("LangGraph", "%langgraph%", 0.82, 15),
]

# 只点开过、没深入的（体现「一头雾水」）
SHALLOW_TOPICS = [
    ("评估", ["%评估%", "%评测%"], 0.12, 2),
    ("测试", ["%pytest%", "%单元测试%", "%接口测试%"], 0.18, 2),
]


def pick_videos(db, patterns: list[str], limit: int, min_dur: int = 480, max_dur: int = 4200):
    """挑时长适中、有字幕的视频。短视频凑不出真实观看量，超长的又不像「一节一节看」。"""
    conds = " OR ".join([f"lower(title) LIKE :p{i}" for i in range(len(patterns))])
    params = {f"p{i}": p.lower() for i, p in enumerate(patterns)}
    rows = db.execute(
        text(
            f"""
            SELECT id, title, duration FROM videos
            WHERE ({conds})
              AND transcription IS NOT NULL
              AND duration BETWEEN :min_dur AND :max_dur
            ORDER BY duration DESC
            LIMIT :limit
            """
        ),
        {**params, "min_dur": min_dur, "max_dur": max_dur, "limit": limit},
    ).fetchall()
    return rows


def evening_timestamp(day: datetime) -> datetime:
    """学习时间集中在晚上 20:00–23:00，少量在周末下午。"""
    if day.weekday() >= 5 and random.random() < 0.4:
        return day.replace(hour=random.randint(14, 17), minute=random.randint(0, 59))
    return day.replace(hour=random.randint(20, 22), minute=random.randint(0, 59), second=random.randint(0, 59))


def build_sessions(
    video_id: int,
    duration: float,
    target_ratio: float,
    base_day: datetime,
    session_tag: str,
) -> tuple[list[WatchEvent], WatchHistory]:
    """把一个视频拆成 1~3 次观看会话，模拟真实的分段学习。

    每次会话中途有 1~2 次拖动（跳着看/回看），偶尔开倍速 —— 这些都会体现在事件流里，
    让画像里的「专注时长」不是简单的总时长除以视频数。
    """
    events: list[WatchEvent] = []
    watch_total = duration * target_ratio
    sessions = random.choice([1, 2, 2, 3])
    per_session = watch_total / sessions

    played = 0.0
    for index in range(sessions):
        # 抖动控制在 0~1 天：抖动太大（比如 0~3 天）会把「最近一周很密集」
        # 的数据打散到十天前，画像上的冲刺感就没了
        started = evening_timestamp(base_day - timedelta(days=random.randint(0, 1)))
        cursor = played
        remaining = min(per_session, duration - cursor)
        if remaining <= 30:
            break

        session_id = f"{DEMO_PREFIX}{session_tag}-{index}"
        rate = 1.5 if random.random() < 0.18 else 1.0

        events.append(
            WatchEvent(
                video_id=video_id,
                session_id=session_id,
                event_type="play",
                position_sec=round(cursor, 2),
                duration_sec=duration,
                playback_rate=rate,
                delta_sec=0.0,
                occurred_at=started,
            )
        )

        consumed = 0.0
        while consumed < remaining:
            step = min(HEARTBEAT_SEC, remaining - consumed)
            # 15% 概率中途暂停一下再继续
            if random.random() < 0.03 and consumed > 60:
                events.append(
                    WatchEvent(
                        video_id=video_id,
                        session_id=session_id,
                        event_type="pause",
                        position_sec=round(cursor + consumed, 2),
                        duration_sec=duration,
                        playback_rate=rate,
                        delta_sec=0.0,
                        occurred_at=started + timedelta(seconds=int(consumed)),
                    )
                )

            consumed += step
            events.append(
                WatchEvent(
                    video_id=video_id,
                    session_id=session_id,
                    event_type="heartbeat",
                    position_sec=round(cursor + consumed, 2),
                    duration_sec=duration,
                    playback_rate=rate,
                    delta_sec=round(step, 2),
                    occurred_at=started + timedelta(seconds=int(consumed)),
                )
            )

        end_pos = cursor + remaining
        # 有一半概率在这里跳一下（回看或跳过听不懂的段落）
        if random.random() < 0.5 and end_pos < duration - 60:
            jump = random.choice([-90, -45, 30, 60])
            new_pos = max(0.0, min(duration - 5, end_pos + jump))
            events.append(
                WatchEvent(
                    video_id=video_id,
                    session_id=session_id,
                    event_type="seek",
                    position_sec=round(new_pos, 2),
                    duration_sec=duration,
                    playback_rate=rate,
                    delta_sec=0.0,
                    occurred_at=started + timedelta(seconds=int(consumed) + 2),
                )
            )
            end_pos = new_pos

        finished = end_pos >= duration * 0.95
        events.append(
            WatchEvent(
                video_id=video_id,
                session_id=session_id,
                event_type="ended" if finished else "close",
                position_sec=round(end_pos, 2),
                duration_sec=duration,
                playback_rate=rate,
                delta_sec=0.0,
                occurred_at=started + timedelta(seconds=int(consumed) + 3),
            )
        )

        played = end_pos
        if finished:
            break

    history = WatchHistory(
        video_id=video_id,
        progress=round(min(played, duration), 2),
        duration=round(duration, 2),
        completed=played >= duration * 0.95,
        watched_at=events[-1].occurred_at if events else base_day,
    )
    return events, history


def clean_demo(db, user_id: int | None = None) -> int:
    """清理 demo 事件。带 user_id 时只清这个人的，避免误删别人的真实数据。"""
    where = "session_id LIKE :p"
    params: dict = {"p": f"{DEMO_PREFIX}%"}
    if user_id is not None:
        where += " AND user_id = :uid"
        params["uid"] = user_id
    removed = db.execute(text(f"DELETE FROM watch_events WHERE {where}"), params).rowcount
    db.commit()
    return removed or 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--clean", action="store_true", help="只清理 demo 数据")
    parser.add_argument("--reset", action="store_true", help="先清理再生成")
    parser.add_argument("--days", type=int, default=30, help="数据跨度（天）")
    parser.add_argument("--user", default="", help="绑定到哪个用户名（画像按用户隔离后必须指定）")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        user = None
        if args.user:
            user = db.query(User).filter(User.username == args.user).first()
            if not user:
                print(f"用户 {args.user} 不存在，先创建账号")
                return 1
        uid = user.id if user else None
        if uid is None:
            print("警告：未指定 --user，埋点 user_id 会是 NULL，画像查不到")

        if args.clean or args.reset:
            removed = clean_demo(db, uid)
            print(f"已清理 demo 事件 {removed} 条")

        if args.clean:
            return 0

        now = datetime.now()
        all_events: list[WatchEvent] = []
        all_history: list[WatchHistory] = []
        summary: list[str] = []
        video_index = 0

        for topic, pattern, ratio, count in LEARNED_TOPICS:
            videos = pick_videos(db, [pattern], count)
            if not videos:
                print(f"  [{topic}] 没找到合适视频，跳过")
                continue
            topic_sec = 0.0
            for video in videos:
                # 前 21 个安排在过去 7 天（每天约 3 个），营造「最近在冲刺」；
                # 其余散在过去一个月，避免全挤在同一周
                if video_index < 21:
                    day = now - timedelta(days=(video_index % 7) + 1)
                else:
                    day = now - timedelta(days=random.randint(8, args.days))
                video_index += 1
                events, history = build_sessions(
                    video.id, float(video.duration or 0), ratio, day, f"{topic.lower()}-{video.id}"
                )
                all_events.extend(events)
                all_history.append(history)
                topic_sec += sum(e.delta_sec or 0 for e in events)
            summary.append(f"{topic}: {len(videos)} 个视频，{topic_sec/3600:.1f} 小时，完成度约 {ratio:.0%}")

        for topic, patterns, ratio, count in SHALLOW_TOPICS:
            videos = pick_videos(db, patterns, count, min_dur=300, max_dur=5400)
            if not videos:
                print(f"  [{topic}] 没找到合适视频（库里该主题素材很少）")
                continue
            topic_sec = 0.0
            for video in videos:
                day = now - timedelta(days=random.randint(1, args.days))
                events, history = build_sessions(
                    video.id, float(video.duration or 0), ratio, day, f"{topic.lower()}-{video.id}"
                )
                all_events.extend(events)
                all_history.append(history)
                topic_sec += sum(e.delta_sec or 0 for e in events)
            summary.append(f"{topic}: {len(videos)} 个视频，仅 {topic_sec/60:.0f} 分钟（点开就关）")

        # 上线部署：刻意不给任何记录 —— 完全没碰过
        summary.append("上线部署: 0 个视频（从未打开）")

        # 画像按 user_id 隔离后，不绑定用户的数据是谁都查不到的
        for event in all_events:
            event.user_id = uid
        for row in all_history:
            row.user_id = uid

        db.add_all(all_events)
        db.commit()

        # watch_history 同一视频只保留一条，避免重复
        video_ids = {h.video_id for h in all_history}
        db.query(WatchHistory).filter(
            WatchHistory.video_id.in_(video_ids), WatchHistory.user_id == uid
        ).delete(synchronize_session=False)
        db.add_all(all_history)
        db.commit()

        print(f"\n生成完成：{len(all_events)} 条事件，{len(all_history)} 条进度快照")
        for line in summary:
            print(f"  · {line}")

        profile = recompute_profile(db, uid)
        print("\n画像重算结果：")
        print(f"  {profile_summary_text(profile)}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
