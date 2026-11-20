#!/usr/bin/env python3
"""P2 Lite 并发 Agent 峰值探针。

并发打 `/api/assistant/chat/stream`，同时每 1.5 秒采一次 docker stats，
记录 backend / PG / Redis 的峰值 RSS。用于回答「4 路并发会不会把
640MB 的 backend 顶爆」这类验收问题。

用法：
    python infra/lite/load_probe.py --base-url http://127.0.0.1:12305 --concurrency 4
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke import Client  # noqa: E402

CONTAINERS = ["p2lite-backend-1", "p2lite-frontend-1", "shared-postgres", "shared-redis"]


def _to_mib(raw: str) -> float:
    match = re.match(r"([0-9.]+)\s*([KMGT]?i?B)", raw.strip())
    if not match:
        return 0.0
    value = float(match.group(1))
    unit = match.group(2).lower()
    if unit.startswith("g"):
        return value * 1024
    if unit.startswith("k"):
        return value / 1024
    if unit == "b":
        return value / 1024 / 1024
    return value


def sample() -> dict[str, float]:
    try:
        out = subprocess.run(
            ["docker", "stats", "--no-stream", "--format", "{{.Name}}|{{.MemUsage}}", *CONTAINERS],
            capture_output=True,
            text=True,
            timeout=15,
            check=True,
        ).stdout
    except Exception:
        return {}
    result: dict[str, float] = {}
    for line in out.splitlines():
        if "|" not in line:
            continue
        name, usage = line.split("|", 1)
        result[name] = _to_mib(usage.split("/")[0])
    return result


def run_one(base: str, username: str, password: str, i: int, out: list) -> None:
    try:
        client = Client(base)
        client.request("POST", "/api/auth/login", {"username": username, "password": password})
        payload = {
            "message": f"用三句话讲一下 Agent 的工具调用怎么设计（并发 {i}）",
            "intent": "question-answer",
            "page_context": "aiagent",
        }
        req = urllib.request.Request(
            f"{base.rstrip('/')}/api/assistant/chat/stream",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
            method="POST",
        )
        terminal = None
        tokens = 0
        started = time.time()
        with client.opener.open(req, timeout=180) as resp:
            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data: "):
                    continue
                data = json.loads(line[6:])
                if data.get("type") == "token":
                    tokens += 1
                if data.get("type") in ("done", "error"):
                    terminal = data.get("type")
                    break
        out.append({"worker": i, "terminal": terminal, "tokens": tokens, "sec": round(time.time() - started, 1)})
    except Exception as exc:  # noqa: BLE001
        out.append({"worker": i, "terminal": "exception", "error": str(exc)[:160]})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:12305")
    parser.add_argument("--username", default="lite_smoke")
    parser.add_argument("--password", default="LiteDemo2026")
    parser.add_argument("--concurrency", type=int, default=4)
    args = parser.parse_args()

    samples: list[dict[str, float]] = []
    stop = threading.Event()

    def sampler() -> None:
        while not stop.is_set():
            snap = sample()
            if snap:
                samples.append(snap)
            stop.wait(1.5)

    sampler_thread = threading.Thread(target=sampler, daemon=True)
    sampler_thread.start()

    results: list[dict] = []
    workers = [
        threading.Thread(target=run_one, args=(args.base_url, args.username, args.password, i, results))
        for i in range(args.concurrency)
    ]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join()

    time.sleep(1.5)
    stop.set()
    sampler_thread.join(timeout=5)

    print(json.dumps(results, ensure_ascii=False, indent=2))
    if not samples:
        print("docker stats 不可用，跳过内存峰值")
        return

    peaks = {
        name: max(s.get(name, 0.0) for s in samples)
        for name in CONTAINERS
    }
    print("\n峰值 RSS（MiB）:")
    for name, value in peaks.items():
        print(f"  {name:24s} {value:8.1f}")
    app_total = peaks.get("p2lite-backend-1", 0) + peaks.get("p2lite-frontend-1", 0)
    print(f"  {'P2 Lite 应用两容器':24s} {app_total:8.1f}")


if __name__ == "__main__":
    main()
