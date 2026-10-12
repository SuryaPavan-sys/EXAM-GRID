"""Train the turnout model, show the backtest, and forecast a timetable.

    python -m examgrid_scheduler.turnout_cli ../../data/full --timetable ../../output/full/timetable.csv --out ../../output/full
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import joblib
import pandas as pd

from .data import load_dataset
from .timetable import generate_timetable
from .turnout import forecast, train


def _read(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Turnout prediction for an exam timetable.")
    ap.add_argument("dataset", type=Path)
    ap.add_argument("--timetable", type=Path, help="timetable.csv (built fresh if omitted)")
    ap.add_argument("--out", type=Path)
    args = ap.parse_args(argv)

    history = pd.read_csv(args.dataset / "attendance_history.csv")
    trained = train(history)

    print(f"Backtest: trained on {history['cycle'].nunique() - 1} cycles, tested on unseen {trained.test_cycle}")
    print(f"  {'model':30} {'error (pts)':>11} {'session err':>11} {'worst under':>11} {'seats vs actual':>15}")
    for name, m in trained.backtest.items():
        star = "  <- chosen" if name == trained.model_name else ""
        print(f"  {name:30} {m['mae_rate_points']:>10}% {m['session_mape_pct']:>10}% "
              f"{m['session_worst_under_pct']:>10}% {m['seats_booked_vs_actual_pct']:>+14}%{star}")

    print("\nWhat the model learned vs the hidden rule (attendance points):")
    for k, v in trained.effects.items():
        print(f"  {k:26} hidden {v['hidden_rule']:>+6}   learned {v['learned']:>+6}")

    timetable = _read(args.timetable) if args.timetable else generate_timetable(load_dataset(args.dataset)).rows
    result = forecast(trained, timetable, _read(args.dataset / "registrations.csv"),
                      _read(args.dataset / "students.csv"), _read(args.dataset / "rooms.csv"))
    s = result["summary"]
    print(f"\nForecast for the timetable ({s['model']}, safety margin {s['safety_margin_pct']}% + 3 s.d.):")
    print(f"  papers registered     {s['papers_registered']:,}")
    print(f"  expected to attend    {s['expected_present']:,}")
    print(f"  seats booked          {s['seats_booked']:,}  ({s['seats_saved_pct']}% fewer)")
    print(f"  room-sessions         {s['room_sessions_if_all_attend']} -> {s['room_sessions_booked']}  "
          f"({s['room_sessions_saved_pct']}% fewer)")
    print(f"  invigilator duties    {s['invigilator_duties_if_all_attend']} -> {s['invigilator_duties_booked']}  "
          f"({s['invigilator_duties_saved_pct']}% fewer)")

    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)
        report = dict(model=trained.model_name, test_cycle=trained.test_cycle, backtest=trained.backtest,
                      learned_effects=trained.effects, **result)
        (args.out / "turnout_report.json").write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
        with (args.out / "turnout_sessions.csv").open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(result["sessions"][0]))
            w.writeheader()
            w.writerows(result["sessions"])
        joblib.dump(trained, args.out / "turnout_model.joblib")
        print(f"  wrote                 {args.out / 'turnout_report.json'}, turnout_sessions.csv, turnout_model.joblib")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
