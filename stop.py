#!/usr/bin/env python3
"""Stop backend / frontend services reliably on Windows."""

import subprocess
import sys
import time


def run(cmd: str) -> None:
    subprocess.run(cmd, shell=True, capture_output=True)


def get_pid_by_port(port: int) -> str | None:
    result = subprocess.run(
        f'netstat -ano | findstr ":{port} "',
        shell=True, capture_output=True, text=True,
        encoding="utf-8", errors="replace"
    )
    for line in result.stdout.splitlines():
        parts = line.strip().split()
        if parts and parts[-1].isdigit():
            return parts[-1]
    return None


def get_parent_pid(pid: str) -> str | None:
    result = subprocess.run(
        f'wmic process where "ProcessId={pid}" get ParentProcessId /value',
        shell=True, capture_output=True, text=True,
        encoding="utf-8", errors="replace"
    )
    for line in result.stdout.splitlines():
        if "ParentProcessId=" in line:
            val = line.split("=")[1].strip()
            if val and val != pid:
                return val
    return None


def kill_tree_by_title(title: str) -> None:
    """Kill process tree by window title (closes the cmd window too)."""
    run(f'taskkill /FI "WINDOWTITLE eq {title}" /T /F')


def kill_by_port(port: int) -> None:
    """Kill the process listening on the port, and its parent cmd window."""
    pid = get_pid_by_port(port)
    if not pid:
        return
    # Kill the child process (python/node)
    run(f"taskkill /PID {pid} /F")
    # Kill the parent cmd.exe so the window closes
    parent = get_parent_pid(pid)
    if parent:
        run(f"taskkill /PID {parent} /F")


def wait_port_free(port: int, timeout: float = 5.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        result = subprocess.run(
            f'netstat -ano | findstr ":{port} "',
            shell=True, capture_output=True, text=True
        )
        if not result.stdout.strip():
            return
        time.sleep(0.5)


def stop_backend() -> None:
    kill_tree_by_title("SiteYeb Backend")
    kill_by_port(80)
    wait_port_free(80)


def stop_frontend() -> None:
    kill_tree_by_title("SiteYeb Frontend")
    kill_by_port(5002)
    wait_port_free(5002)


def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else "all"
    if target in ("all", "backend"):
        stop_backend()
    if target in ("all", "frontend"):
        stop_frontend()


if __name__ == "__main__":
    main()
