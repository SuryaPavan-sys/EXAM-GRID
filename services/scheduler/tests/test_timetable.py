from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from examgrid_scheduler.api import app
from examgrid_scheduler.data import build_input, load_dataset
from examgrid_scheduler.timetable import TimetableError, generate_timetable
from examgrid_scheduler.validate import validate

SMALL = Path(__file__).resolve().parents[3] / "data" / "small"
CONFIG = {"start_date": "2026-11-16", "last_allowed_date": "2026-11-21",  # Mon-Sat: 6 days
          "sessions": [{"code": "FN"}, {"code": "AN"}]}


def regs(*pairs, backlog=()):
    return [{"roll_no": r, "subject_code": s, "reg_type": "BACKLOG" if (r, s) in backlog else "REGULAR"}
            for r, s in pairs]


def rooms(seats):
    return [{"room_id": "R1", "capacity": seats, "exam_usable": "yes"}]


# ------------------------------------------------------------- real SRKR data
@pytest.fixture(scope="module")
def small_result():
    return generate_timetable(load_dataset(SMALL))


def test_small_dataset_is_valid(small_result):
    r = small_result.report
    assert r["ok"]
    assert r["clashes_same_session"] == 0
    assert r["regular_students_two_exams_same_day"] == 0
    assert r["sessions_over_capacity"] == {}
    assert r["unscheduled_subjects"] == []
    assert r["subjects_scheduled"] == r["subjects_total"]


def test_every_row_is_inside_the_exam_window(small_result):
    dates = {row["exam_date"] for row in small_result.rows}
    assert min(dates) >= "2026-11-16"
    assert all(date.fromisoformat(d).weekday() != 6 for d in dates)   # no Sundays
    assert "2026-11-24" not in dates                                   # declared holiday


def test_same_seed_gives_same_timetable(small_result):
    again = generate_timetable(load_dataset(SMALL))
    assert again.rows == small_result.rows


# ------------------------------------------------------------- hand-made cases
def test_triangle_of_conflicts_needs_three_sessions():
    # s1 writes A,B; s2 writes B,C; s3 writes A,C -> A, B, C pairwise conflict.
    inp = build_input([], regs(("s1", "A"), ("s1", "B"), ("s2", "B"), ("s2", "C"), ("s3", "A"), ("s3", "C")),
                      rooms(100), CONFIG)
    result = generate_timetable(inp)
    slots = {r["subject_code"]: (r["exam_date"], r["session"]) for r in result.rows}
    assert len(set(slots.values())) == 3
    # all are regular papers, so they must also be on three different days
    assert len({d for d, _ in slots.values()}) == 3


def test_backlog_student_may_write_two_papers_in_one_day_but_not_one_session():
    # 6 days x 2 sessions = 12 slots; one backlog student with 7 papers must double up somewhere.
    papers = [("b1", f"P{i}") for i in range(7)]
    inp = build_input([], regs(*papers, backlog=set(papers)), rooms(100), CONFIG)
    result = generate_timetable(inp)
    assert result.report["ok"]
    assert result.report["clashes_same_session"] == 0
    assert result.report["backlog_students_two_exams_same_day"] == 1


def test_seat_limit_splits_subjects_into_separate_sessions():
    # A and B share no student, but together they exceed one session's 50 seats.
    pairs = [(f"a{i}", "A") for i in range(30)] + [(f"b{i}", "B") for i in range(30)]
    result = generate_timetable(build_input([], regs(*pairs), rooms(50), CONFIG))
    slots = {r["subject_code"]: (r["exam_date"], r["session"]) for r in result.rows}
    assert slots["A"] != slots["B"]
    assert result.report["peak_session_load"] <= 50


def test_subject_bigger_than_all_rooms_is_rejected():
    pairs = [(f"s{i}", "HUGE") for i in range(60)]
    with pytest.raises(TimetableError) as e:
        generate_timetable(build_input([], regs(*pairs), rooms(50), CONFIG))
    assert "HUGE" in e.value.details["subjects"]


def test_too_few_sessions_is_rejected():
    # 13 subjects that all conflict (one regular student) cannot fit 12 sessions.
    pairs = [("s1", f"P{i}") for i in range(13)]
    with pytest.raises(TimetableError):
        generate_timetable(build_input([], regs(*pairs), rooms(100), CONFIG))


def test_validator_catches_a_clash():
    inp = build_input([], regs(("s1", "A"), ("s1", "B")), rooms(100), CONFIG)
    same = (date(2026, 11, 16), "FN")
    report = validate({"A": same, "B": same}, inp)
    assert not report["ok"]
    assert report["clashes_same_session"] == 1


# ------------------------------------------------------------- API
client = TestClient(app)


def test_health():
    assert client.get("/health").json()["status"] == "ok"


def test_api_timetable_round_trip():
    body = {
        "subjects": [{"subject_code": "A", "subject_name": "Alpha"}, {"subject_code": "B"}],
        "registrations": regs(("s1", "A"), ("s1", "B"), ("s2", "A")),
        "rooms": rooms(40),
        "config": CONFIG,
    }
    res = client.post("/timetable", json=body)
    assert res.status_code == 200
    data = res.json()
    assert data["report"]["ok"]
    assert {r["subject_code"] for r in data["timetable"]} == {"A", "B"}
    assert next(r for r in data["timetable"] if r["subject_code"] == "A")["subject_name"] == "Alpha"


def test_api_reports_impossible_input_as_422():
    body = {"subjects": [], "registrations": regs(*[(f"s{i}", "X") for i in range(10)]),
            "rooms": rooms(5), "config": CONFIG}
    res = client.post("/timetable", json=body)
    assert res.status_code == 422


def test_api_demo_dataset():
    res = client.post("/timetable/demo/small")
    assert res.status_code == 200
    assert res.json()["report"]["ok"]
