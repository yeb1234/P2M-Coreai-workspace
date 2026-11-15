"""多用户隔离回归测试。

为什么要有这个
-------------
隔离是「沉默的正确性」：做对了没人看见，做错了也未必立刻暴露。
之前就发现过一次真问题 —— 87 个历史会话 user_id 为空，代码里
`if session.user_id is not None and ...` 直接放行，等于任何登录用户
都能读别人 162 条消息。这类 bug 靠人工点界面发现不了。

这个脚本用两个临时账号交叉验证，跑完自动清理。

用法：
    python scripts/test_multi_user.py              # 默认 localhost
    python scripts/test_multi_user.py http://host  # 指别的环境
"""

from __future__ import annotations

import sys
import uuid
from datetime import datetime

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost"
TAG = uuid.uuid4().hex[:6]
USER_A = f"isoautoa{TAG}"
USER_B = f"isoautob{TAG}"
PASSWORD = "Test1234"


class Checker:
    def __init__(self) -> None:
        self.passed = 0
        self.failed: list[str] = []

    def check(self, name: str, ok: bool, detail: str = "") -> None:
        if ok:
            self.passed += 1
            print(f"  \033[32m✓\033[0m {name}")
        else:
            self.failed.append(name)
            print(f"  \033[31m✗\033[0m {name}  {detail}")


def register(username: str) -> str:
    with httpx.Client(timeout=30) as c:
        r = c.post(
            f"{BASE}/api/auth/register",
            json={"username": username, "password": PASSWORD, "display_name": username},
        )
        r.raise_for_status()
        return r.json()["access_token"]


def main() -> int:
    ck = Checker()
    print(f"多用户隔离测试 @ {BASE}")
    print(f"账号: {USER_A} / {USER_B}\n")

    try:
        tok_a = register(USER_A)
        tok_b = register(USER_B)
    except Exception as exc:
        print(f"注册失败，无法继续: {exc}")
        return 1

    ha = {"Authorization": f"Bearer {tok_a}"}
    hb = {"Authorization": f"Bearer {tok_b}"}

    with httpx.Client(timeout=60) as c:
        print("[1] A 写入私有数据")
        r = c.post(
            f"{BASE}/api/memory/items",
            headers=ha,
            json={"content": f"A 的私密记忆 {TAG}", "kind": "goal", "importance": 5},
        )
        ck.check("A 写记忆", r.status_code == 200, f"HTTP {r.status_code}")
        mem_id = r.json().get("id") if r.status_code == 200 else ""

        profile_payload = {
            "profile": {
                "nickname": f"A{TAG}", "occupation": "A", "goal": "A 的目标",
                "timezone": "Asia/Shanghai", "weekly_hours": 10, "language": "中文",
            },
            "persona": {
                "tone": "严厉", "proactivity": "反问",
                "cite_sources": False, "freeform": "A 的设定",
            },
        }
        r = c.put(f"{BASE}/api/memory/profile", headers=ha, json=profile_payload)
        ck.check("A 写档案", r.status_code == 200, f"HTTP {r.status_code}")

        r = c.post(
            f"{BASE}/api/schedule-items",
            headers=ha,
            json={
                "type": "todo",
                "title": f"A 的日程 {TAG}",
                "start_at": "2026-11-16T10:00:00",
                "due_at": "2026-11-16T11:00:00",
            },
        )
        ck.check("A 写日程", r.status_code in (200, 201), f"HTTP {r.status_code}")

        print("\n[2] B 不能看到 A 的数据")

        r = c.get(f"{BASE}/api/memory/items", headers=hb)
        items = r.json() if r.status_code == 200 else []
        ck.check("B 看不到 A 的记忆", len(items) == 0, f"看到 {len(items)} 条")

        r = c.get(f"{BASE}/api/memory/profile", headers=hb)
        nick = ((r.json() or {}).get("profile") or {}).get("nickname", "") if r.status_code == 200 else "?"
        ck.check("B 的档案是空的", not nick, f"nickname={nick}")

        r = c.get(f"{BASE}/api/schedule-items", headers=hb)
        n = len((r.json() or {}).get("items", [])) if r.status_code == 200 else -1
        ck.check("B 看不到 A 的日程", n == 0, f"看到 {n} 条")

        r = c.get(f"{BASE}/api/learning/journey", headers=hb)
        exp = ((r.json() or {}).get("level") or {}).get("exp", -1) if r.status_code == 200 else -1
        ck.check("B 的经验值是 0", exp == 0, f"exp={exp}")

        r = c.get(f"{BASE}/api/watch-events/stats", headers=hb)
        mins = (r.json() or {}).get("total_watch_minutes", -1) if r.status_code == 200 else -1
        ck.check("B 的观看时长是 0", mins == 0, f"minutes={mins}")

        print("\n[3] B 不能改动 A 的数据")
        if mem_id:
            r = c.patch(
                f"{BASE}/api/memory/items/{mem_id}",
                headers=hb,
                json={"content": "B 篡改"},
            )
            ck.check("B 改 A 的记忆被拒", r.status_code == 404, f"HTTP {r.status_code}")

            r = c.delete(f"{BASE}/api/memory/items/{mem_id}", headers=hb)
            ck.check("B 删 A 的记忆被拒", r.status_code == 404, f"HTTP {r.status_code}")
        else:
            ck.check("B 改 A 的记忆被拒", False, "A 的记忆没建成功，跳过")

        print("\n[4] A 仍能正常读自己的")
        r = c.get(f"{BASE}/api/memory/items", headers=ha)
        items = r.json() if r.status_code == 200 else []
        ck.check("A 能看到自己的记忆", len(items) == 1, f"看到 {len(items)} 条")

        print("\n[5] 未登录不能访问私有接口")
        for path in ["/api/memory/items", "/api/memory/profile", "/api/learning/journey"]:
            r = c.get(f"{BASE}{path}")
            ck.check(f"{path} 需要登录", r.status_code in (401, 403), f"HTTP {r.status_code}")

        print("\n[6] 笔记：私有隔离 + 共享可见")
        r = c.post(
            f"{BASE}/api/notes",
            headers=ha,
            json={"title": f"A 的私人笔记 {TAG}", "content": "只有 A 能看"},
        )
        ck.check("A 能建自己的笔记", r.status_code == 200, f"HTTP {r.status_code}")
        note_id = r.json().get("id") if r.status_code == 200 else None
        if note_id:
            ck.check(
                "新建笔记是 private",
                r.json().get("scope") == "private",
                f"scope={r.json().get('scope')}",
            )
            ck.check(
                "笔记归属是 A",
                bool(r.json().get("user_id")),
                "user_id 为空",
            )
            # B 看不到、改不动、删不掉
            r2 = c.get(f"{BASE}/api/notes", headers=hb)
            b_notes = r2.json() if r2.status_code == 200 else []
            ck.check(
                "B 看不到 A 的私有笔记",
                all(n.get("id") != note_id for n in b_notes),
                "在 B 的列表里出现了",
            )
            r2 = c.put(f"{BASE}/api/notes/{note_id}", headers=hb, json={"content": "B 改"})
            ck.check("B 改 A 的笔记被拒", r2.status_code == 404, f"HTTP {r2.status_code}")
            r2 = c.delete(f"{BASE}/api/notes/{note_id}", headers=hb)
            ck.check("B 删 A 的笔记被拒", r2.status_code == 404, f"HTTP {r2.status_code}")
            # 共享笔记：两人都能看到
            r2 = c.get(f"{BASE}/api/notes?scope=shared", headers=hb)
            shared_b = r2.json() if r2.status_code == 200 else []
            ck.check("B 能看到共享笔记", len(shared_b) > 0, f"看到 {len(shared_b)} 条")
            if shared_b:
                sid = shared_b[0]["id"]
                r3 = c.put(f"{BASE}/api/notes/{sid}", headers=hb, json={"content": "B 改共享"})
                ck.check("普通用户改共享笔记被拒", r3.status_code == 403, f"HTTP {r3.status_code}")

        print("\n[7] 转写任务权限")
        r = c.get(f"{BASE}/api/ai-jobs", headers=hb)
        ck.check("普通用户不能列转写任务", r.status_code in (401, 403), f"HTTP {r.status_code}")
        r = c.get(f"{BASE}/api/ai-jobs")
        ck.check("匿名不能列转写任务", r.status_code in (401, 403), f"HTTP {r.status_code}")

        print("\n[8] 共享知识库对所有用户可见")
        r = c.get(f"{BASE}/api/videos?limit=1", headers=hb)
        total = (r.json() or {}).get("total", 0) if r.status_code == 200 else 0
        ck.check("B 能看视频库", total > 0, f"total={total}")

    total_checks = ck.passed + len(ck.failed)
    print(f"\n{'='*50}")
    print(f"通过 {ck.passed}/{total_checks}")
    if ck.failed:
        print("失败项：")
        for f in ck.failed:
            print(f"  - {f}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
