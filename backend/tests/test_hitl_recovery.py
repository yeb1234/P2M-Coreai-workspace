"""确认卡跨后端重启后的兜底回归。

内存 checkpoint 丢掉后，不能把用户已经确认过的写入吞掉：
- A：按 AgentRun.steps 里的参数直接执行一次；
- B：只记录取消，不调用工具；
- 已完成的 run：拒绝重复提交。
"""

from __future__ import annotations

import time

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.agents import chat_agent
from app.agents.chat_agent import AgentContext, _pending_write_step, _recover_stale_write
from app.database import Base
from app.models import AgentRun


class FakeTool:
    def __init__(self, name: str, result: str):
        self.name = name
        self.result = result
        self.calls: list[dict] = []

    def invoke(self, args: dict):
        self.calls.append(dict(args))
        return self.result


@pytest.fixture()
def run_db(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(chat_agent, "SessionLocal", Session)
    yield Session


def _make_run(Session, *, status: str = "awaiting_input", tool: str = "save_note"):
    with Session() as db:
        run = AgentRun(
            id="stale-run",
            session_id="stale-session",
            user_id=1,
            kind="chat",
            status=status,
            input_text="帮我记下来",
            steps=[
                {"tool": "search_notes", "args": {"query": "B-2-2"}, "ok": True},
                {
                    "tool": tool,
                    "args": {
                        "title": "跨重启验收",
                        "content": "确认卡失效后仍应落库",
                    },
                    "ok": None,
                    "tool_call_id": "call-1",
                },
            ],
        )
        db.add(run)
        db.commit()


def _events(resume: dict, tools: list):
    ctx = AgentContext(session_id="stale-session", user_id=1)
    return list(
        _recover_stale_write(
            ctx=ctx,
            resume=resume,
            run_id="stale-run",
            started=time.perf_counter(),
            tools=tools,
        )
    )


def test_pending_write_step_skips_completed_reads():
    steps = [
        {"tool": "search_notes", "ok": True},
        {"tool": "save_note", "ok": None, "args": {"title": "x"}},
        {"tool": "create_todo", "ok": True},
    ]
    assert _pending_write_step(steps)["tool"] == "save_note"
    assert _pending_write_step([{"tool": "search_notes", "ok": True}]) is None


def test_stale_confirm_executes_once_with_stored_args(run_db):
    _make_run(run_db)
    tool = FakeTool("save_note", "已保存到个人笔记库：id=99，标题《跨重启验收》，正文 10 字。")
    events = _events({"selected": "A"}, [tool])

    assert [e["type"] for e in events] == ["token", "done"]
    assert tool.calls == [{"title": "跨重启验收", "content": "确认卡失效后仍应落库"}]
    with run_db() as db:
        run = db.query(AgentRun).filter(AgentRun.id == "stale-run").one()
        assert run.status == "completed"
        assert run.steps[-1]["ok"] is True
        assert "id=99" in (run.output_text or "")


def test_stale_cancel_does_not_write(run_db):
    _make_run(run_db)
    tool = FakeTool("save_note", "已保存")
    events = _events({"selected": "B"}, [tool])

    assert [e["type"] for e in events] == ["token", "done"]
    assert tool.calls == []
    with run_db() as db:
        run = db.query(AgentRun).filter(AgentRun.id == "stale-run").one()
        assert run.status == "completed"
        assert run.steps[-1]["ok"] is False


def test_completed_run_rejects_duplicate_confirm(run_db):
    _make_run(run_db, status="completed")
    tool = FakeTool("save_note", "已保存")
    events = _events({"selected": "A"}, [tool])

    assert [e["type"] for e in events] == ["error"]
    assert tool.calls == []
