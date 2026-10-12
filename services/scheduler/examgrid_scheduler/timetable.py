"""Full timetable pipeline: conflict graph -> DSatur (with seats) -> slot placement -> checks."""
from __future__ import annotations

import time
from dataclasses import dataclass

import networkx as nx

from .conflict_graph import build_conflict_graph, graph_stats
from .data import ExamInput
from .dsatur import dsatur
from .refine import refine
from .spread import BACKLOG_SAME_DAY, REGULAR_SAME_DAY, Placement, assign_slots, overlaps
from .validate import validate


class TimetableError(Exception):
    """The exams cannot fit the window/seats given; `details` says why."""

    def __init__(self, message: str, details: dict):
        super().__init__(message)
        self.details = details


@dataclass
class TimetableResult:
    rows: list[dict]        # one row per subject: code, name, date, weekday, session, students
    report: dict            # validation + algorithm stats


def generate_timetable(inp: ExamInput, seed: int = 0) -> TimetableResult:
    t0 = time.perf_counter()
    g = build_conflict_graph(inp)
    col = dsatur(g, inp.seats_per_session)
    t_colour = time.perf_counter()

    if col.too_big:
        raise TimetableError("Some subjects have more students than one session's seats.",
                             {"subjects": {c: len(inp.students_of[c]) for c in col.too_big},
                              "seats_per_session": inp.seats_per_session})
    n_slots = len(inp.exam_dates) * len(inp.sessions)
    if col.n_colours > n_slots:
        raise TimetableError("Not enough exam sessions in the window.",
                             {"sessions_needed": col.n_colours, "sessions_available": n_slots})

    # A forbidden same-day pair costs more than all soft costs together could,
    # so the search removes those first; backlog same-day is "very undesirable"
    # or effectively forbidden depending on the college's policy.
    backlog_cost = BACKLOG_SAME_DAY if inp.allow_backlog_same_day else REGULAR_SAME_DAY
    ov = overlaps(col.colour_of, inp.papers_of, inp.regular_papers_of, col.n_colours)
    naive = [(i // len(inp.sessions), i % len(inp.sessions)) for i in range(col.n_colours)]
    naive_cost = Placement(naive, inp.exam_dates, ov, backlog_cost).total()
    placed, cost = assign_slots(col.n_colours, inp.exam_dates, len(inp.sessions), ov,
                                backlog_same_day=backlog_cost, seed=seed)
    t_place = time.perf_counter()

    slot_idx = {code: placed[c] for code, c in col.colour_of.items()}
    size = {code: len(r) for code, r in inp.students_of.items()}

    # Exams the exam cell pinned to a slot override the search; refine() then moves
    # whatever now clashes with them and never moves the pinned ones.
    pins = {}
    for code, (d, session) in inp.fixed_slots.items():
        if code not in slot_idx:
            continue
        if d not in inp.exam_dates or session not in inp.sessions:
            raise TimetableError(f"{code} is pinned to {d} {session}, which is not an exam session in the window.",
                                 {"subject": code, "date": d.isoformat(), "session": session})
        pins[code] = (inp.exam_dates.index(d), inp.sessions.index(session))
        slot_idx[code] = pins[code]

    slot_idx, refine_before, refine_after = refine(
        slot_idx, g, size, inp.exam_dates, len(inp.sessions), inp.seats_per_session,
        backlog_same_day=backlog_cost, allow_backlog_same_day=inp.allow_backlog_same_day, seed=seed,
        frozen=set(pins))
    t_refine = time.perf_counter()

    slots = {code: (inp.exam_dates[d], inp.sessions[k]) for code, (d, k) in slot_idx.items()}
    rows = []
    for code, (d, session) in sorted(slots.items(), key=lambda kv: (kv[1][0], kv[1][1], kv[0])):
        s = inp.subjects.get(code, {})
        rows.append(dict(subject_code=code, subject_name=s.get("subject_name", code),
                         department=s.get("department", ""), year=s.get("year", ""),
                         category=s.get("category", ""), exam_date=d.isoformat(),
                         weekday=d.strftime("%A"), session=session,
                         students=len(inp.students_of[code]),
                         regular=len(inp.regular_of.get(code, ())),
                         backlog=len(inp.students_of[code]) - len(inp.regular_of.get(code, ()))))

    report = validate(slots, inp)
    report["fixed_slots"] = {code: {"date": inp.exam_dates[d].isoformat(), "session": inp.sessions[k],
                                    "honoured": slot_idx[code] == (d, k)} for code, (d, k) in pins.items()}
    report["algorithm"] = dict(
        conflict_graph=graph_stats(g),
        dsatur_session_groups=col.n_colours,
        networkx_dsatur_groups_without_seat_limit=max(nx.greedy_color(g, strategy="DSATUR").values(), default=-1) + 1,
        sessions_available=n_slots,
        placement_cost_naive=naive_cost,
        placement_cost_optimised=cost,
        subject_moves_cost_before=refine_before,
        subject_moves_cost_after=refine_after,
        seconds_colouring=round(t_colour - t0, 3),
        seconds_placement=round(t_place - t_colour, 3),
        seconds_refine=round(t_refine - t_place, 3),
        seconds_total=round(t_refine - t0, 3),
    )
    return TimetableResult(rows=rows, report=report)
