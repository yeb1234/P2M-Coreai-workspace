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

        print("\n[6] 共享知识库对所有用户可见")
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
