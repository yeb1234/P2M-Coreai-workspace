#!/usr/bin/env python3
"""P2 7.2 Lite 冒烟：健康检查、登录、面试题、笔记、待办、日历。

不依赖第三方包，只用标准库。默认打 http://127.0.0.1:12305（nginx 入口）。
用法：
    python infra/lite/smoke.py --base-url http://127.0.0.1:12305
    python infra/lite/smoke.py --base-url http://127.0.0.1:12705 --direct-api
"""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import sys
import urllib.error
import urllib.request

DEFAULT_USER = "lite_smoke"
DEFAULT_PASSWORD = "LiteDemo2026"


class Client:
    def __init__(self, base_url: str):
        self.base = base_url.rstrip("/")
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar)
        )

    def request(self, method: str, path: str, body: dict | None = None) -> tuple[int, object]:
        data = None
        headers = {"Accept": "application/json"}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(
            f"{self.base}{path}", data=data, headers=headers, method=method
        )
        try:
            with self.opener.open(req, timeout=30) as resp:
                raw = resp.read()
                ctype = resp.headers.get("content-type", "")
                if "json" in ctype:
                    return resp.status, json.loads(raw.decode("utf-8"))
                return resp.status, raw.decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            try:
                parsed = json.loads(raw.decode("utf-8"))
            except Exception:
                parsed = raw.decode("utf-8", "replace")
            return exc.code, parsed


def check(name: str, ok: bool, detail: str = "") -> None:
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:12305")
    parser.add_argument("--username", default=DEFAULT_USER)
    parser.add_argument("--password", default=DEFAULT_PASSWORD)
    parser.add_argument("--direct-api", action="store_true", help="base-url 直接是后端 8000/12705")
    args = parser.parse_args()

    client = Client(args.base_url)

    status, ready = client.request("GET", "/ready")
    check("GET /ready", status == 200 and isinstance(ready, dict) and ready.get("ready") is True, str(ready)[:160])
    checks = ready.get("checks", {})
    check("profile=lite", checks.get("profile") == "lite", str(checks.get("profile")))
    check("vectors skipped", checks.get("vectors") == "skipped (lite)", str(checks.get("vectors")))

    status, info = client.request("GET", "/api/client-info")
    check(
        "GET /api/client-info",
        status == 200 and isinstance(info, dict) and info.get("app_profile") == "lite",
        str(info)[:160],
    )

    if not args.direct_api:
        status, html = client.request("GET", "/")
        check("frontend title", status == 200 and "P2 7.2 Lite" in str(html), "HTML 标题/描述已按 Lite 构建")

    # 注册可能因账号已存在失败；失败就回退登录
    status, reg = client.request(
        "POST", "/api/auth/register", {"username": args.username, "password": args.password}
    )
    if status not in (200, 201):
        status, login = client.request(
            "POST", "/api/auth/login", {"username": args.username, "password": args.password}
        )
        check("POST /api/auth/login", status == 200, str(login)[:160])
    else:
        check("POST /api/auth/register", True, "首次建号成功")

    status, me = client.request("GET", "/api/auth/me")
    check("GET /api/auth/me", status == 200 and isinstance(me, dict) and me.get("username") == args.username, str(me)[:160])

    status, questions = client.request("GET", "/api/interview/questions?limit=3")
    check("GET /api/interview/questions", status == 200 and isinstance(questions, (list, dict)), str(questions)[:160])

    status, notes = client.request("GET", "/api/notes")
    check("GET /api/notes", status == 200, str(notes)[:160])

    status, todo = client.request("GET", "/api/schedule-items")
    check("GET /api/schedule-items", status == 200, str(todo)[:160])

    status, calendar = client.request("GET", "/api/calendar-events")
    check("GET /api/calendar-events", status == 200, str(calendar)[:160])

    status, caps = client.request("GET", "/api/assistant/capabilities")
    skill_names = [s.get("name") for s in caps.get("skills", [])] if isinstance(caps, dict) else []
    tool_names = [t.get("name") for t in caps.get("tools", [])] if isinstance(caps, dict) else []
    check(
        "GET /api/assistant/capabilities",
        status == 200
        and "lite-general-answer" in skill_names
        and "lite-study-review" in skill_names
        and "general-answer" not in skill_names
        and "search_videos" not in tool_names
        and "get_lite_learning_status" in tool_names,
        f"skills={skill_names}, tools={tool_names}",
    )

    status, mcp = client.request("GET", "/api/mcp/tools")
    mcp_names = {t.get("name") for t in mcp.get("tools", [])} if isinstance(mcp, dict) else set()
    check(
        "GET /api/mcp/tools (Lite)",
        status == 200
        and "search_videos" not in mcp_names
        and "note_create" in mcp_names
        and "todo_create" in mcp_names
        and "calendar_create" in mcp_names
        and "get_lite_learning_status" in mcp_names,
        f"mcp={sorted(mcp_names)}",
    )

    status, health = client.request("GET", "/api/admin/health")
    health_names = {c.get("name") for c in health.get("checks", [])} if isinstance(health, dict) else set()
    check(
        "GET /api/admin/health (Lite)",
        status == 200
        and isinstance(health, dict)
        and health.get("ok") is True
        and "Lite 能力边界" in health_names
        and "CUDA / GPU" not in health_names
        and "whisper.cpp 模型" not in health_names,
        f"ok={health.get('ok') if isinstance(health, dict) else None}, checks={sorted(health_names)}",
    )

    status, sticky_notes = client.request("GET", "/api/notes?scope=private&surface=sticky")
    check("GET /api/notes?surface=sticky", status == 200, str(sticky_notes)[:160])

    status, md_notes = client.request("GET", "/api/notes?scope=private&surface=md")
    check("GET /api/notes?surface=md", status == 200, str(md_notes)[:160])

    print("\nLite 冒烟通过。")


if __name__ == "__main__":
    main()
