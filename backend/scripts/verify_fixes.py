"""A/B/C 三组修复的针对性验证。

跑法（容器内）：
    docker cp scripts/verify_fixes.py siteyeb-backend:/tmp/
    docker exec siteyeb-backend python /tmp/verify_fixes.py

每条都验证「修之前会错、修之后对」，不是「接口返回 200」。
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"
PASS, FAIL = [], []


def check(name: str, ok: bool, detail: str = "") -> None:
    (PASS if ok else FAIL).append(name)
    mark = "OK  " if ok else "FAIL"
    print(f"  [{mark}] {name}" + (f"  ({detail})" if detail else ""))


def call(method: str, path: str, token: str | None = None, body: dict | None = None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw) if raw else None
        except Exception:
            return e.code, raw[:200].decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return 0, str(e)


def login(user: str, pwd: str) -> str | None:
    st, data = call("POST", "/api/auth/login", body={"username": user, "password": pwd})
    if st == 200 and isinstance(data, dict):
        return data.get("access_token")
    return None


def main() -> None:
    admin = login("demo", "Demo2026")
    if not admin:
        print("无法登录 demo，中止")
        return

    print("\n=== A2: GET /videos/{id}/notes 需要鉴权 ===")
    st, _ = call("GET", "/api/videos/1/notes")
    check("匿名读视频笔记被拒", st in (401, 403), f"HTTP {st}")

    print("\n=== A1: 转写只取 shared 笔记，不碰私有 ===")
    from app.database import SessionLocal
    from app.models import Note, Video
    from app.services.ai_jobs import ensure_video_note

    db = SessionLocal()
    try:
        video = db.query(Video).first()
        before = (
            db.query(Note)
            .filter(Note.video_id == video.id, Note.scope == "shared")
            .count()
        )
        picked = ensure_video_note(db, video)
        check(
            "ensure_video_note 返回的是 shared",
            picked.scope == "shared",
            f"scope={picked.scope}",
        )
        private_n = (
            db.query(Note)
            .filter(Note.video_id == video.id, Note.scope == "private")
            .count()
        )
        if private_n:
            check(
                "存在私有笔记时也不会被选中",
                picked.scope == "shared",
                f"该视频有 {private_n} 条私有笔记",
            )
    finally:
        db.close()

    print("\n=== A4: 会话归属校验 ===")
    from app.database import SessionLocal as SL2
    from app.models import ChatSession
    from app.services.memory import ensure_session

    db2 = SL2()
    try:
        from app.models import User as _U

        uids = [r[0] for r in db2.query(_U.id).order_by(_U.id).limit(2).all()]
        if len(uids) < 2:
            check("会话归属校验", False, "库里少于两个用户，跳过")
        else:
            owner, intruder = uids[0], uids[1]
            sid = "verify-owner-abc123"
            db2.query(ChatSession).filter(ChatSession.id == sid).delete()
            db2.commit()
            s_owner = ensure_session(db2, None, user_id=owner, title="owner test")
            s_owner.id = sid
            db2.commit()
            got = ensure_session(db2, sid, user_id=intruder, title="intruder test")
            check(
                "别人的 session_id 不会返回原会话",
                got.id != sid,
                f"owner={owner} intruder={intruder} 返回 {got.id[:12]}",
            )
            same = ensure_session(db2, sid, user_id=owner)
            check("本人仍能拿回自己的会话", same.id == sid)
            db2.query(ChatSession).filter(ChatSession.id == sid).delete()
            db2.query(ChatSession).filter(
                ChatSession.id == got.id
            ).delete()
            db2.commit()
    finally:
        db2.close()

    print("\n=== A5: 观看进度按用户隔离 ===")
    st, anon_video = call("GET", "/api/videos/1")
    check("匿名读视频详情不报错", st == 200, f"HTTP {st}")
    if st == 200:
        check(
            "匿名看不到别人的进度",
            not anon_video.get("watch_progress"),
            f"watch_progress={anon_video.get('watch_progress')}",
        )

    st, cont = call("GET", "/api/videos/continue/last")
    check("匿名没有「继续观看」", st == 404, f"HTTP {st}")

    print("\n=== B1: /api/auth/migrate 不再 500 ===")
    st, data = call(
        "POST",
        "/api/auth/migrate",
        token=admin,
        body={
            "users": [{"username": "verify-migrate-u1", "passwordHash": "a" * 64}],
            "kv_data": {},
        },
    )
    check("migrate 带 passwordHash 不 500", st != 500, f"HTTP {st}")

    st2, data2 = call(
        "POST",
        "/api/auth/migrate",
        token=admin,
        body={"users": [{"username": "verify-migrate-u2"}], "kv_data": {}},
    )
    check("migrate 缺 passwordHash 也不 500", st2 != 500, f"HTTP {st2}")

    print("\n=== B2: 学习路径全部完成后自动收口 ===")
    from app.database import SessionLocal as SL3
    from app.models import LearningGoal, LearningPath, LearningPathStep

    db3 = SL3()
    try:
        goal_id = "verify-goal-1"
        path_id = "verify-path-1"
        db3.query(LearningPathStep).filter(LearningPathStep.path_id == path_id).delete()
        db3.query(LearningPath).filter(LearningPath.id == path_id).delete()
        db3.query(LearningGoal).filter(LearningGoal.id == goal_id).delete()
        db3.commit()

        from app.models import User

        uid = db3.query(User.id).filter(User.username == "demo").scalar()
        db3.add(LearningGoal(id=goal_id, user_id=uid, title="verify", status="active"))
        db3.add(
            LearningPath(
                id=path_id, goal_id=goal_id, user_id=uid, title="verify path",
                status="active", total_est_minutes=10,
            )
        )
        for i in range(2):
            db3.add(
                LearningPathStep(
                    id=f"{path_id}-s{i}", path_id=path_id, order_index=i,
                    title=f"step {i}", status="pending", est_minutes=5,
                )
            )
        db3.commit()
    finally:
        db3.close()

    for i in range(2):
        st, _ = call(
            "PATCH", f"/api/learning/steps/{path_id}-s{i}",
            token=admin, body={"status": "done"},
        )
        if st not in (200, 204):
            check(f"步骤 {i} 更新成功", False, f"HTTP {st}")
            break
    else:
        db3 = SL3()
        try:
            status = (
                db3.query(LearningPath.status)
                .filter(LearningPath.id == path_id)
                .scalar()
            )
            check("最后一步完成后路径自动 completed", status == "completed", f"status={status}")
            db3.query(LearningPathStep).filter(
                LearningPathStep.path_id == path_id
            ).delete()
            db3.query(LearningPath).filter(LearningPath.id == path_id).delete()
            db3.query(LearningGoal).filter(LearningGoal.id == goal_id).delete()
            db3.commit()
        finally:
            db3.close()

    print("\n=== B3: _mark_failed 同步视频状态 ===")
    from app.models import AiJob
    from app.services.ai_job_tasks import _mark_failed

    db4 = SL3()
    try:
        vid = db4.query(Video.id).order_by(Video.id).limit(1).scalar()
        job_id = "verify-fail-job"
        db4.query(AiJob).filter(AiJob.id == job_id).delete()
        db4.add(AiJob(id=job_id, video_id=vid, status="queued", stage="queued"))
        db4.query(Video).filter(Video.id == vid).update(
            {"ai_status": "queued", "ai_stage": "queued"}, synchronize_session=False
        )
        db4.commit()

        job = db4.query(AiJob).filter(AiJob.id == job_id).first()
        _mark_failed(db4, job, "verify: file moved")
        db4.expire_all()
        vstatus = db4.query(Video.ai_status).filter(Video.id == vid).scalar()
        check("失败后视频不再是 queued", vstatus == "failed", f"ai_status={vstatus}")

        db4.query(AiJob).filter(AiJob.id == job_id).delete()
        db4.query(Video).filter(Video.id == vid).update(
            {"ai_status": "idle", "ai_stage": None, "ai_error": None},
            synchronize_session=False,
        )
        db4.commit()
    finally:
        db4.close()

    print("\n=== C1: 视频流仍可用（Range 206）===")
    st, data = call("GET", "/api/videos")
    vid = None
    if st == 200 and isinstance(data, dict):
        items = data.get("videos") or data.get("items") or []
        if items:
            vid = items[0].get("id")
    if vid:
        req = urllib.request.Request(f"{BASE}/api/videos/{vid}/file")
        req.add_header("Range", "bytes=0-1023")
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read()
                check("Range 请求返回 206", r.status == 206, f"HTTP {r.status}")
                check("返回 1024 字节", len(body) == 1024, f"{len(body)} bytes")
        except urllib.error.HTTPError as e:
            check("Range 请求返回 206", False, f"HTTP {e.code}")
    else:
        check("找到可测视频", False, "列表为空")

    print("\n" + "=" * 58)
    print(f"通过 {len(PASS)} / 失败 {len(FAIL)}")
    if FAIL:
        for name in FAIL:
            print(f"  失败: {name}")
        sys.exit(1)


if __name__ == "__main__":
    main()
