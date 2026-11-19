"""把当前分散的展示页同步到 Docker 演示中心。

用法：
  python sync_demo_pages.py

只复制展示用 HTML 和监控页需要的 logo，不改源文件。
monitor 页会做两处替换：
  1. /assets/ -> ../assets/（从 /demo/pages/ 回到 /demo/assets/）
  2. /api/status -> /demo/api/status（走 nginx 同源代理）
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SITE = ROOT / "artifacts" / "demo-hub" / "site"
PAGES = SITE / "pages"
ASSETS = SITE / "assets"

PAGE_MAP = {
    "multi-cluster.html": ROOT / "artifacts" / "multi-cluster-ops-demo" / "多集群监控DEMO.html",
    "ops-control.html": ROOT / "artifacts" / "language-ops-control-plane" / "自然语言运维控制面-设计稿.html",
    "ui-console.html": ROOT / "artifacts" / "ui-design-runs" / "换了UI以后摆放是不是稍-20261118-114550-ad7d" / "console" / "index.html",
    "eval-report.html": ROOT / "docs" / "eval" / "P2-2.94-AI检索评估报告.html",
    "port-plan.html": ROOT / "docs" / "2026-11-16-端口号段规划.html",
    "interview-handbook.html": ROOT / "artifacts" / "interview-prep" / "SiteYeb学习与面试冲刺手册.html",
}

MONITOR_SRC = ROOT / "artifacts" / "pipeline-monitor" / "监控面板.html"
MONITOR_DST = PAGES / "monitor.html"
MONITOR_LOGO = ROOT / "artifacts" / "pipeline-monitor" / "assets" / "p2-logo-pulse-128.png"
MONITOR_LOGO_DST = ASSETS / "p2-logo-pulse-128.png"


def sync_plain_pages() -> list[str]:
    copied = []
    for name, src in PAGE_MAP.items():
        if not src.exists():
            raise FileNotFoundError(f"缺少源页面: {src}")
        shutil.copy2(src, PAGES / name)
        copied.append(name)
    return copied


def sync_monitor() -> None:
    if not MONITOR_SRC.exists():
        raise FileNotFoundError(f"缺少监控页: {MONITOR_SRC}")
    text = MONITOR_SRC.read_text(encoding="utf-8")

    # 监控页在 /demo/pages/ 下，logo 在 /demo/assets/ 下。
    text = text.replace('src="/assets/', 'src="../assets/')

    # 只替换监控页自己的 API 声明，保留其余脚本。
    text, count = re.subn(
        r"const API = .*?;",
        'const API = "/demo/api/status";',
        text,
        count=1,
        flags=re.S,
    )
    if count != 1 or '/demo/api/status' not in text:
        raise RuntimeError("监控页 API 声明替换失败，请检查源文件结构")

    MONITOR_DST.write_text(text, encoding="utf-8")

    if not MONITOR_LOGO.exists():
        raise FileNotFoundError(f"缺少监控 logo: {MONITOR_LOGO}")
    shutil.copy2(MONITOR_LOGO, MONITOR_LOGO_DST)


def main() -> None:
    PAGES.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)
    copied = sync_plain_pages()
    sync_monitor()
    print("同步完成：")
    for name in copied:
        print(f"  pages/{name}")
    print("  pages/monitor.html (已改写 assets/API 路径)")
    print("  assets/p2-logo-pulse-128.png")
    print(f"输出目录: {SITE}")


if __name__ == "__main__":
    main()
