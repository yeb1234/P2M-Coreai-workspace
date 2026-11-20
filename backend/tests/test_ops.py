"""P2 Transcribe 控制面边界测试。

重点不是扫描本身，而是两件最容易出事的事：
1. OPS_TOKEN 为空时接口必须关闭；
2. 控制台只能扫描视频库根目录内的路径。
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.database import settings
from app.routers import ops
from app.routers.ops import _target_path, require_ops_token


def test_ops_token_is_closed_when_empty(monkeypatch):
    monkeypatch.setattr(settings, "ops_token", "")
    with pytest.raises(HTTPException) as exc:
        require_ops_token(None)
    assert exc.value.status_code == 503


def test_ops_token_rejects_wrong_value(monkeypatch):
    monkeypatch.setattr(settings, "ops_token", "local-secret")
    with pytest.raises(HTTPException) as exc:
        require_ops_token("wrong")
    assert exc.value.status_code == 401


def test_ops_token_accepts_matching_value(monkeypatch):
    monkeypatch.setattr(settings, "ops_token", "local-secret")
    assert require_ops_token("local-secret") is None


def test_scan_target_is_confined_to_video_library(monkeypatch, tmp_path):
    video_root = tmp_path / "videos"
    video_root.mkdir()
    monkeypatch.setattr(settings, "video_folder", str(video_root))

    assert _target_path("") is None
    assert _target_path("course-a") == str(video_root / "course-a")
    assert _target_path(str(video_root / "course-a")) == str(video_root / "course-a")


def test_scan_target_rejects_outside_path(monkeypatch, tmp_path):
    video_root = tmp_path / "videos"
    video_root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    monkeypatch.setattr(settings, "video_folder", str(video_root))

    with pytest.raises(HTTPException) as exc:
        _target_path(str(outside))
    assert exc.value.status_code == 400


def test_scan_worker_waits_when_library_scan_is_busy(monkeypatch):
    calls = []

    def fake_rescan(target=None):
        calls.append(target)
        if len(calls) == 1:
            return {"status": "busy"}
        return {"status": "ok", "added": 0, "removed": 0, "total": 625, "scope": target, "pruned": False}

    monkeypatch.setattr(ops, "rescan_library", fake_rescan)
    monkeypatch.setattr(ops.time, "sleep", lambda _seconds: None)
    ops._scan_state.update(running=True, message="已提交，等待扫描开始")
    ops._scan_worker("/videos/mksz")

    assert calls == ["/videos/mksz", "/videos/mksz"]
    assert ops._scan_state["running"] is False
    assert ops._scan_state["result"]["status"] == "ok"
    assert ops._scan_state["message"] is None
