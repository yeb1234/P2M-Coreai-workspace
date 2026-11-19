from pydantic import ValidationError
import pytest

from app.routers.learning import GoalCreate
from app.routers.memory_admin import ProfilePayload


def test_learning_goal_caps_weekly_hours_at_ten_per_day():
    goal = GoalCreate(title="7.1 学习计划", weekly_hours=70)
    assert goal.weekly_hours == 70

    with pytest.raises(ValidationError):
        GoalCreate(title="7.1 学习计划", weekly_hours=71)


def test_profile_caps_weekly_hours_at_ten_per_day():
    profile = ProfilePayload(weekly_hours=70)
    assert profile.weekly_hours == 70

    with pytest.raises(ValidationError):
        ProfilePayload(weekly_hours=71)
