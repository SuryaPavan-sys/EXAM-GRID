"""Load the inputs the timetable needs, from a dataset folder or from API JSON."""
from __future__ import annotations

import csv
import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


@dataclass
class ExamInput:
    subjects: dict[str, dict]                  # subject_code -> subject row
    students_of: dict[str, set[str]]           # subject_code -> roll numbers writing it
    regular_of: dict[str, set[str]]            # subject_code -> roll numbers writing it as REGULAR
    seats_per_session: int                     # usable seats across all exam rooms
    exam_dates: list[date]                     # days exams may be held, in order
    sessions: list[str] = field(default_factory=lambda: ["FN", "AN"])
    # Regular students never get two exams in one day. Backlog (supplementary)
    # students may, when this is True - the usual practice when papers from
    # several years have to fit one exam window.
    allow_backlog_same_day: bool = True
    # Subjects the exam cell has pinned to a slot: code -> (date, session code).
    fixed_slots: dict[str, tuple[date, str]] = field(default_factory=dict)

    @property
    def papers_of(self) -> dict[str, set[str]]:
        """roll_no -> every subject that student writes."""
        return _invert(self.students_of)

    @property
    def regular_papers_of(self) -> dict[str, set[str]]:
        """roll_no -> subjects that student writes as REGULAR."""
        return _invert(self.regular_of)


def _invert(by_subject: dict[str, set[str]]) -> dict[str, set[str]]:
    out: dict[str, set[str]] = defaultdict(set)
    for code, rolls in by_subject.items():
        for r in rolls:
            out[r].add(code)
    return out


def exam_dates_from_config(config: dict) -> list[date]:
    start = date.fromisoformat(config["start_date"])
    end = date.fromisoformat(config["last_allowed_date"])
    holidays = {date.fromisoformat(h) for h in config.get("holidays", [])}
    excluded = {WEEKDAYS.index(d) for d in config.get("exclude_weekdays", ["Sunday"])}
    days, d = [], start
    while d <= end:
        if d.weekday() not in excluded and d not in holidays:
            days.append(d)
        d += timedelta(days=1)
    return days


def build_input(subjects: list[dict], registrations: list[dict], rooms: list[dict], config: dict) -> ExamInput:
    students_of: dict[str, set[str]] = defaultdict(set)
    regular_of: dict[str, set[str]] = defaultdict(set)
    for r in registrations:
        students_of[r["subject_code"]].add(r["roll_no"])
        if str(r.get("reg_type", "REGULAR")).upper() == "REGULAR":
            regular_of[r["subject_code"]].add(r["roll_no"])
    seats = sum(int(r["capacity"]) for r in rooms if str(r.get("exam_usable", "yes")).lower() == "yes")
    by_code = {s["subject_code"]: s for s in subjects}
    for code in students_of:  # a registration for an unlisted subject still needs a slot
        by_code.setdefault(code, {"subject_code": code, "subject_name": code})
    return ExamInput(
        subjects=by_code,
        students_of=dict(students_of),
        regular_of=dict(regular_of),
        seats_per_session=seats,
        exam_dates=exam_dates_from_config(config),
        sessions=[s["code"] for s in config.get("sessions", [{"code": "FN"}, {"code": "AN"}])],
        allow_backlog_same_day=bool(config.get("allow_backlog_same_day", True)),
        fixed_slots={code: (date.fromisoformat(v["date"]), v["session"])
                     for code, v in (config.get("fixed_slots") or {}).items()},
    )


def _read_csv(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load_dataset(folder: str | Path) -> ExamInput:
    folder = Path(folder)
    return build_input(
        subjects=_read_csv(folder / "subjects.csv"),
        registrations=_read_csv(folder / "registrations.csv"),
        rooms=_read_csv(folder / "rooms.csv"),
        config=json.loads((folder / "exam_config.json").read_text(encoding="utf-8")),
    )
