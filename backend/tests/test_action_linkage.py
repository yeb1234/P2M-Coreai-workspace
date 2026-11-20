"""个人动作工具落库模型的回归：日历不能写进前端不读的 calendar_events。"""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.agents import tools as tools_module
from app.agents.tools import create_calendar_event, set_tool_run, set_tool_user
from app.agents.write_guard import clear_write_grants, grant_write
from app.database import Base
from app.models import AgentAction, CalendarEvent, ScheduleItem


@pytest.fixture()
def action_db(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(tools_module, "SessionLocal", Session)
    clear_write_grants()
    set_tool_user(1)
    set_tool_run("calendar-test-run", "calendar-test-session")
    try:
        yield Session
    finally:
        set_tool_user(None)
        set_tool_run(None, None)
        clear_write_grants()


def test_calendar_tool_writes_schedule_item_visible_to_calendar_pages(action_db):
    grant_write("create_calendar_event", "calendar-test-run")
    result = create_calendar_event.invoke(
        {
            "title": "日历联动回归",
            "date": "2026-11-21",
            "start_time": "09:30",
            "end_time": "10:45",
            "description": "应由日历/周历读取的 schedule_items",
        }
    )

    assert "已加入日历" in result
    with action_db() as db:
        item = db.query(ScheduleItem).filter(ScheduleItem.title == "日历联动回归").one()
        assert item.type == "event"
        assert item.start_at == datetime(2026, 11, 21, 9, 30)
        assert item.due_at == datetime(2026, 11, 21, 10, 45)
        action = db.query(AgentAction).filter(AgentAction.action_type == "calendar").one()
        assert action.target_id == item.id
        assert db.query(CalendarEvent).count() == 0


def test_all_day_calendar_uses_full_day_window(action_db):
    grant_write("create_calendar_event", "calendar-test-run")
    result = create_calendar_event.invoke(
        {"title": "全天日程回归", "date": "2026-11-22"}
    )

    assert "已加入日历" in result
    with action_db() as db:
        item = db.query(ScheduleItem).filter(ScheduleItem.title == "全天日程回归").one()
        assert item.start_at == datetime(2026, 11, 22, 0, 0)
        assert item.due_at == datetime(2026, 11, 22, 23, 59)
