"""Command line: build a timetable from a dataset folder.

    python -m examgrid_scheduler.cli ../../data/full --out ../../output/full
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

from .data import load_dataset
from .timetable import TimetableError, generate_timetable


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Generate a clash-free exam timetable.")
    ap.add_argument("dataset", type=Path, help="folder with subjects.csv, registrations.csv, rooms.csv, exam_config.json")
    ap.add_argument("--out", type=Path, default=None, help="where to write timetable.csv and timetable_report.json")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args(argv)

    inp = load_dataset(args.dataset)
    try:
        result = generate_timetable(inp, seed=args.seed)
    except TimetableError as e:
        print(f"FAILED: {e}\n{json.dumps(e.details, indent=2)}", file=sys.stderr)
        return 1

    r, a = result.report, result.report["algorithm"]
    print(f"Timetable for {r['students']:,} students, {r['subjects_scheduled']} subjects, {r['papers']:,} papers")
    print(f"  conflict graph       {a['conflict_graph']['subjects']} nodes, {a['conflict_graph']['conflict_edges']:,} edges, "
          f"largest clique {a['conflict_graph']['largest_clique_found']}")
    print(f"  exam days            {r['exam_days_used']} days, {r['sessions_used']} of "
          f"{a['sessions_available']} sessions ({r['first_exam']} to {r['last_exam']})")
    print(f"  clashes              {r['clashes_same_session']} same-session, "
          f"{r['regular_students_two_exams_same_day']} regular students with 2 exams in a day")
    print(f"  backlog FN+AN days   {r['backlog_students_two_exams_same_day']} students "
          f"({'allowed' if r['backlog_same_day_allowed'] else 'NOT allowed'})")
    print(f"  seat capacity        peak {r['peak_session_load']:,} of {r['seats_per_session']:,} seats, "
          f"{len(r['sessions_over_capacity'])} sessions over")
    print(f"  back-to-back days    {r['pct_students_with_back_to_back']}% of students "
          f"(cost: naive {a['placement_cost_naive']:,} -> placed {a['placement_cost_optimised']:,} "
          f"-> refined {a['subject_moves_cost_after']:,})")
    print(f"  min gap per student  {r['students_by_min_gap_days']}")
    print(f"  time                 {a['seconds_total']} s")
    print(f"  RESULT               {'VALID' if r['ok'] else 'INVALID'}")

    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)
        with (args.out / "timetable.csv").open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(result.rows[0]))
            w.writeheader()
            w.writerows(result.rows)
        (args.out / "timetable_report.json").write_text(json.dumps(r, indent=2), encoding="utf-8")
        print(f"  wrote                {args.out / 'timetable.csv'}")
    return 0 if r["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
