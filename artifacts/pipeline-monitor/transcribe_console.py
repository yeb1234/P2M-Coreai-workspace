"""P2 Transcribe 独立控制台。

运行：
  python artifacts/pipeline-monitor/transcribe_console.py

它复用 `monitor_server.py` 的只读快照，但增加一层控制面：
扫描路径、候选视频、批量转写/总结、队列暂停/恢复。
写操作全部转给主后端的 /api/ops 接口，控制台不直接改数据库。

只绑定 127.0.0.1，默认端口 12703。不要把它暴露到公网。
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parents[1]
MONITOR_HTML = ROOT / "监控面板.html"
OVERLAY = ROOT / "transcribe_console_overlay.html"
ASSETS = ROOT / "assets"
HOST = "127.0.0.1"
PORT = int(os.getenv("TRANSCRIBE_CONSOLE_PORT", "12703"))


def _read_env_file() -> dict[str, str]:
    values: dict[str, str] = {}
    env_file = REPO_ROOT / ".env"
    if not env_file.exists():
        return values
    for raw in env_file.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


ENV_FILE = _read_env_file()


def _setting(key: str, default: str = "") -> str:
    return os.getenv(key) or ENV_FILE.get(key) or default


OPS_TOKEN = _setting("OPS_TOKEN")
API_BASE = _setting("TRANSCRIBE_API_BASE", "http://127.0.0.1:12402").rstrip("/")
VIDEO_HOST_PATH = _setting("VIDEO_HOST_PATH", "").replace("\\", "/").rstrip("/")


def _render_html() -> str:
    page = MONITOR_HTML.read_text(encoding="utf-8")
    overlay = OVERLAY.read_text(encoding="utf-8")
    css = _between(overlay, "<!-- P2_TRANSCRIBE_CSS -->", "<!-- /P2_TRANSCRIBE_CSS -->")
    body = _between(overlay, "<!-- P2_TRANSCRIBE_HTML -->", "<!-- /P2_TRANSCRIBE_HTML -->")
    js = _between(overlay, "<!-- P2_TRANSCRIBE_JS -->", "<!-- /P2_TRANSCRIBE_JS -->")
    page = page.replace(
        "<title>P2 Pipeline Manager</title>",
        "<title>P2 7.2 Transcribe · 转写控制台</title>",
        1,
    )
    page = page.replace("<h1>P2 Pipeline Manager</h1>", "<h1>P2 7.2 Transcribe</h1>", 1)
    page = page.replace("PIPELINE MANAGER / LIVE", "TRANSCRIBE CONTROL / LIVE", 1)
    page = page.replace("</head>", css + "\n</head>", 1)
    page = page.replace("</header>", "</header>\n" + body, 1)
    page = page.replace("</body>", js + "\n</body>", 1)
    return page


def _between(value: str, start: str, end: str) -> str:
    left = value.find(start)
    if left < 0:
        return ""
    left += len(start)
    right = value.find(end, left)
    if right < 0:
        return ""
    return value[left:right]


def _api_call(method: str, path: str, payload: dict | None = None, timeout: int = 20) -> tuple[int, dict]:
    if not OPS_TOKEN:
        return 503, {"detail": "OPS_TOKEN 未配置，请在 .env 设置后重启 backend 与控制台"}
    data = None
    headers = {"X-Ops-Token": OPS_TOKEN, "Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(API_BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return response.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(raw)
        except json.JSONDecodeError:
            detail = {"detail": raw or str(exc)}
        return exc.code, detail
    except Exception as exc:  # 控制台只把失败原因回给本机页面
        return 502, {"detail": f"后端不可达：{exc}"}


def _map_scan_path(raw_path: str) -> str:
    """把用户输入的 Windows / 容器路径收敛为后端可见的 /videos 路径。"""
    raw = (raw_path or "").strip().replace("\\", "/")
    if not raw:
        return ""
    if raw.startswith("/videos"):
        return raw.rstrip("/") or "/videos"
    if VIDEO_HOST_PATH:
        host = VIDEO_HOST_PATH.rstrip("/")
        if raw.lower() == host.lower():
            return "/videos"
        if raw.lower().startswith(host.lower() + "/"):
            relative = raw[len(host):].lstrip("/")
            return "/videos/" + relative
    if raw.startswith("/") or (len(raw) > 1 and raw[1] == ":"):
        raise ValueError("只接受视频库根目录或其子目录；D:\\ITJC 下的路径会自动映射")
    return "/videos/" + raw.strip("/")


class ConsoleHandler(BaseHTTPRequestHandler):
    server_version = "P2Transcribe/7.2"

    def _send(self, body: bytes, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            return

    def _json(self, payload: dict, status: int = 200) -> None:
        self._send(
            json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            "application/json; charset=utf-8",
            status,
        )

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path in ("/", "/index.html", "/transcribe", "/console"):
            self._send(_render_html().encode("utf-8"), "text/html; charset=utf-8")
            return
        if path in ("/api/status", "/status.json"):
            self._json(_monitor_status())
            return
        if path == "/api/console/config":
            self._json(
                {
                    "backend": API_BASE,
                    "token_configured": bool(OPS_TOKEN),
                    "video_host_path": VIDEO_HOST_PATH,
                    "video_container_path": "/videos",
                    "version": "7.2",
                }
            )
            return
        if path == "/api/console/overview":
            status, payload = _api_call("GET", "/api/ops/overview")
            self._json(payload, status)
            return
        if path == "/api/console/settings":
            status, payload = _api_call("GET", "/api/ops/settings")
            self._json(payload, status)
            return
        if path == "/api/console/videos":
            query = parse_qs(parsed.query)
            mode = (query.get("mode") or ["missing_subtitles"])[0]
            limit = (query.get("limit") or ["50"])[0]
            status, payload = _api_call("GET", f"/api/ops/videos?mode={urllib.parse.quote(mode)}&limit={urllib.parse.quote(limit)}")
            self._json(payload, status)
            return
        if path == "/api/console/scan/status":
            status, payload = _api_call("GET", "/api/ops/scan/status")
            self._json(payload, status)
            return
        if path == "/api/console/queue":
            status, payload = _api_call("GET", "/api/ops/queue")
            self._json(payload, status)
            return
        if path.startswith("/assets/"):
            name = Path(path).name
            asset = ASSETS / name
            if name and asset.is_file():
                types = {
                    ".png": "image/png",
                    ".jpg": "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".svg": "image/svg+xml",
                    ".webp": "image/webp",
                }
                self._send(asset.read_bytes(), types.get(asset.suffix.lower(), "application/octet-stream"))
            else:
                self._send(b"not found", "text/plain; charset=utf-8", 404)
            return
        self._json({"detail": "not found"}, 404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path not in {
            "/api/console/scan",
            "/api/console/batch",
            "/api/console/queue/pause",
            "/api/console/queue/resume",
        }:
            self._json({"detail": "not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except (ValueError, json.JSONDecodeError):
            self._json({"detail": "请求体必须是 JSON"}, 400)
            return
        if parsed.path == "/api/console/scan":
            try:
                mapped = _map_scan_path(str(payload.get("path") or ""))
            except ValueError as exc:
                self._json({"detail": str(exc)}, 400)
                return
            status, response = _api_call("POST", "/api/ops/scan", {"path": mapped}, timeout=15)
            self._json(response, status)
            return
        if parsed.path == "/api/console/batch":
            status, response = _api_call("POST", "/api/ops/batch", payload, timeout=60)
            self._json(response, status)
            return
        if parsed.path == "/api/console/queue/pause":
            status, response = _api_call("POST", "/api/ops/queue/pause", {}, timeout=15)
            self._json(response, status)
            return
        if parsed.path == "/api/console/queue/resume":
            status, response = _api_call("POST", "/api/ops/queue/resume", {}, timeout=15)
            self._json(response, status)
            return

    def log_message(self, fmt: str, *args) -> None:
        return


def _monitor_status() -> dict:
    # 复用只读监控的缓存/采集逻辑；控制台只多包一层控制面。
    import monitor_server

    return monitor_server.get_status()


def main() -> None:
    if not MONITOR_HTML.exists():
        raise SystemExit(f"missing monitor html: {MONITOR_HTML}")
    if not OVERLAY.exists():
        raise SystemExit(f"missing overlay html: {OVERLAY}")
    server = ThreadingHTTPServer((HOST, PORT), ConsoleHandler)
    print(f"P2 Transcribe control listening on http://{HOST}:{PORT}")
    if not OPS_TOKEN:
        print("WARN: OPS_TOKEN is empty; control actions will return 503 until configured.")
    server.serve_forever()


if __name__ == "__main__":
    main()
