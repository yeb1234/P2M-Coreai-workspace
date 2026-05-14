#!/usr/bin/env python3
"""Restart backend + frontend reliably on Windows."""

import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT, "backend")

def start_backend() -> None:
    """Start backend in a new cmd window."""
    cmd = r'.venv311\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 80 --reload'
    subprocess.Popen(
        ["cmd", "/k", cmd],
        cwd=BACKEND_DIR,
        creationflags=subprocess.CREATE_NEW_CONSOLE,
    )

def start_frontend() -> None:
    """Start frontend in a new cmd window."""
    subprocess.Popen(
        ["cmd", "/k", "npm", "run", "dev"],
        cwd=ROOT,
        creationflags=subprocess.CREATE_NEW_CONSOLE,
    )

def main() -> None:
    print("=" * 40)
    print("  SiteYeb / P2M CoreAI Workspace")
    print("=" * 40)
    print()

    print("Stopping old services...")
    subprocess.run([sys.executable, os.path.join(ROOT, "stop.py")], capture_output=True)

    print("Waiting for ports to be released...")
    for port in [80, 5002]:
        for _ in range(10):
            result = subprocess.run(
                f'netstat -ano | findstr ":{port} "',
                shell=True, capture_output=True, text=True
            )
            if not result.stdout.strip():
                break
            time.sleep(0.5)
    time.sleep(1)

    print("Starting backend (port 80)...")
    start_backend()
    time.sleep(2)

    print("Starting frontend dev server (port 5002)...")
    start_frontend()

    print()
    print("Restart complete.")
    print("  App / Backend: http://localhost")
    print("  Frontend dev:  http://localhost:5002")
    print()
    time.sleep(3)


if __name__ == "__main__":
    main()
