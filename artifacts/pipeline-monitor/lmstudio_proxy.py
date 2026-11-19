"""LM Studio LAN bridge for Docker workers.

The laptop runs LM Studio on 192.168.3.250:1234. Docker containers on the
tower cannot reach that LAN address directly (the container route resolves
host.docker.internal to IPv6 and times out on the laptop IP), so this process
listens on 0.0.0.0:1236 and forwards /v1/* to the laptop.

Run with pythonw.exe so it stays out of the interactive desktop:
    pythonw.exe C:\\SiteYeb\\artifacts\\pipeline-monitor\\lmstudio_proxy.py
"""
from __future__ import annotations

import json
import logging
import os
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from logging.handlers import RotatingFileHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TARGET = (os.getenv("LMSTUDIO_TARGET") or "http://192.168.3.250:1234").rstrip("/")
PORT = int(os.getenv("LMSTUDIO_PROXY_PORT") or "1236")
LOG_PATH = ROOT / "lmstudio_lan_proxy_1236.log"

logger = logging.getLogger("lmstudio-proxy")
logger.setLevel(logging.INFO)
handler = RotatingFileHandler(LOG_PATH, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8")
handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(handler)
logger.propagate = False


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _read_body(self) -> bytes:
        length = self.headers.get("Content-Length")
        if not length:
            return b""
        try:
            return self.rfile.read(int(length))
        except (ValueError, OSError):
            return b""

    def _send(self, status: int, body: bytes, headers: list[tuple[str, str]] | None = None) -> None:
        self.send_response(status)
        for key, value in headers or []:
            if key.lower() in {"transfer-encoding", "connection", "content-length"}:
                continue
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def _proxy(self) -> None:
        if self.path == "/health":
            self._send(200, json.dumps({"ok": True, "target": TARGET, "port": PORT}).encode(), [("Content-Type", "application/json")])
            return

        body = self._read_body()
        headers = {
            key: value
            for key, value in self.headers.items()
            if key.lower() not in {"host", "content-length", "connection", "accept-encoding"}
        }
        url = TARGET + self.path
        request = urllib.request.Request(url, data=body if body else None, headers=headers, method=self.command)
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                payload = response.read()
                self._send(response.status, payload, list(response.headers.items()))
                logger.info("%s %s -> %s (%d bytes)", self.command, self.path, response.status, len(payload))
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            self._send(exc.code, payload, list(exc.headers.items()))
            logger.warning("%s %s -> HTTP %s: %s", self.command, self.path, exc.code, payload[:200])
        except Exception as exc:  # noqa: BLE001
            payload = json.dumps({"error": {"message": f"LM Studio proxy failed: {exc}", "type": "proxy_error"}}).encode()
            self._send(502, payload, [("Content-Type", "application/json")])
            logger.warning("%s %s -> 502: %s", self.command, self.path, exc)

    def do_GET(self) -> None:
        self._proxy()

    def do_POST(self) -> None:
        self._proxy()

    def do_OPTIONS(self) -> None:
        self._send(204, b"", [("Access-Control-Allow-Origin", "*"), ("Access-Control-Allow-Methods", "GET,POST,OPTIONS")])

    def log_message(self, fmt: str, *args) -> None:
        return


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    logger.info("LM Studio proxy listening on 0.0.0.0:%s -> %s", PORT, TARGET)
    print(f"LM Studio proxy listening on 0.0.0.0:{PORT} -> {TARGET}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
