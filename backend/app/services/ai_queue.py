from __future__ import annotations

import threading


_paused = threading.Event()


def pause_queue() -> None:
    _paused.set()


def resume_queue() -> None:
    _paused.clear()


def is_queue_paused() -> bool:
    return _paused.is_set()
