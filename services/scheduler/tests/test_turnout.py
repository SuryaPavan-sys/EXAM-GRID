import csv
from pathlib import Path

import pandas as pd
import pytest

from examgrid_scheduler.data import load_dataset
from examgrid_scheduler.timetable import generate_timetable
from examgrid_scheduler.turnout import forecast, plan_rooms, train

SMALL = Path(__file__).resolve().parents[3] / "data" / "small"
FULL = Path(__file__).resolve().parents[3] / "data" / "full"


def read(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


@pytest.fixture(scope="module")
def trained():
    return train(pd.read_csv(FULL / "attendance_history.csv"))


def test_backtest_uses_newest_cycle_as_unseen_test(trained):
    assert trained.test_cycle == "NOV-2025"


def test_learned_model_beats_assuming_everyone_attends(trained):
    chosen = trained.backtest[trained.model_name]["mae_rate_points"]
    naive = trained.backtest["assume everyone attends"]["mae_rate_points"]
    assert chosen < naive / 2


def test_model_rediscovers_the_hidden_rule(trained):
    e = trained.effects
    assert abs(e["backlog vs regular"]["learned"] - e["backlog vs regular"]["hidden_rule"]) < 2
    for k in ("AN vs FN", "Saturday", "1 day since last exam"):
        assert e[k]["learned"] < 0, k            # direction is right
        assert abs(e[k]["learned"] - e[k]["hidden_rule"]) < 1.0, k


def test_forecast_books_between_expected_and_registered(trained):
    inp = load_dataset(SMALL)
    timetable = generate_timetable(inp).rows
    result = forecast(trained, timetable, read(SMALL / "registrations.csv"),
                      read(SMALL / "students.csv"), read(SMALL / "rooms.csv"))
    for s in result["sessions"]:
        assert s["expected"] <= s["seats_booked"] <= s["registered"]
        assert s["rooms_booked"] <= s["rooms_if_all_attend"]
    assert result["summary"]["papers_registered"] == len(read(SMALL / "registrations.csv"))


def test_plan_rooms_fills_largest_rooms_first():
    rooms = [{"capacity": 30, "exam_usable": "yes"}, {"capacity": 60, "exam_usable": "yes"},
             {"capacity": 100, "exam_usable": "no"}]
    assert plan_rooms(50, rooms) == (1, 2)       # one 60-seat room, 2 invigilators for 50 students
    assert plan_rooms(70, rooms) == (2, 3)       # 60 + 10 -> 2 + 1 invigilators
