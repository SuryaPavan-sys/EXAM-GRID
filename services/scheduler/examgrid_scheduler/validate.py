"""Independent checks on a finished timetable.

This does not trust the scheduler: it re-derives every number from the
timetable slots and the raw registrations, so the report doubles as proof.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date

from .data import ExamInput


def validate(slots: dict[str, tuple[date, str]], inp: ExamInput) -> dict:
    papers_of, regular_of = inp.papers_of, inp.regular_papers_of
    unscheduled = sorted(set(inp.students_of) - set(slots))

    same_session = 0              # a student with two papers in one session: impossible to sit
    regular_same_day = 0          # a regular student with two papers in one day: forbidden
    backlog_same_day = 0          # students (with backlogs) writing FN + AN on one day: allowed, reported
    back_to_back_students = 0
    min_gap_hist: Counter = Counter()
    for roll, papers in papers_of.items():
        placed = [slots[p] for p in papers if p in slots]
        same_session += sum(n - 1 for n in Counter(placed).values() if n > 1)
        reg_days = Counter(slots[p][0] for p in regular_of.get(roll, ()) if p in slots)
        regular_same_day += sum(n - 1 for n in reg_days.values() if n > 1)
        days = Counter(d for d, _ in placed)
        backlog_same_day += any(n > 1 for n in days.values()) and not any(n > 1 for n in reg_days.values())
        ordered = sorted(days)
        gaps = [(b - a).days for a, b in zip(ordered, ordered[1:])]
        back_to_back_students += any(g == 1 for g in gaps)
        if gaps:
            min_gap_hist[min(min(gaps), 4)] += 1

    load: dict[tuple[date, str], int] = defaultdict(int)
    for code, slot in slots.items():
        load[slot] += len(inp.students_of.get(code, ()))
    over = {f"{d.isoformat()} {s}": n for (d, s), n in load.items() if n > inp.seats_per_session}

    dates_used = sorted({d for d, _ in slots.values()})
    n = len(papers_of)
    ok = (not unscheduled and same_session == 0 and regular_same_day == 0 and not over
          and (inp.allow_backlog_same_day or backlog_same_day == 0))
    return dict(
        ok=ok,
        subjects_total=len(inp.students_of),
        subjects_scheduled=len(slots),
        unscheduled_subjects=unscheduled,
        students=n,
        papers=sum(len(p) for p in papers_of.values()),
        clashes_same_session=same_session,
        regular_students_two_exams_same_day=regular_same_day,
        backlog_students_two_exams_same_day=backlog_same_day,
        backlog_same_day_allowed=inp.allow_backlog_same_day,
        sessions_over_capacity=over,
        seats_per_session=inp.seats_per_session,
        peak_session_load=max(load.values(), default=0),
        avg_session_utilisation=round(sum(load.values()) / (len(load) * inp.seats_per_session), 3) if load else 0,
        exam_days_used=len(dates_used),
        sessions_used=len(load),
        first_exam=dates_used[0].isoformat() if dates_used else None,
        last_exam=dates_used[-1].isoformat() if dates_used else None,
        students_with_back_to_back=back_to_back_students,
        pct_students_with_back_to_back=round(100 * back_to_back_students / n, 1) if n else 0,
        students_by_min_gap_days={("4+" if k == 4 else str(k)): v for k, v in sorted(min_gap_hist.items())},
    )
