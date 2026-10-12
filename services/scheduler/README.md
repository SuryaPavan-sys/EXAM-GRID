# ExamGrid scheduler service (Python / FastAPI)

This service builds clash-free semester-end exam timetables for SRKR Engineering College.

## How it works

1. **Conflict graph** (`conflict_graph.py`). Each subject is a node. Two subjects are joined
   when at least one student writes both. The edge records how many students they share,
   and how many of those write both as *regular* papers.
2. **DSatur colouring with seat limits** (`dsatur.py`), hand-written so every step can be explained.
   - Each colour is one exam session.
   - The next subject coloured is the one whose neighbours already use the most colours.
   - It gets the lowest colour that none of its neighbours uses **and** that still has seats for it.
3. **Session placement** (`spread.py`). DSatur's groups are placed on (date, FN/AN) slots by
   local search (swap groups, move a group to a free slot).
4. **Subject refinement** (`refine.py`). Single subjects move to any session where every hard
   rule still holds, so branches can alternate days.
5. **Independent validation** (`validate.py`). Every number in the report is recomputed from the
   finished timetable and the raw registrations.

### Rules

| Rule | Type |
|---|---|
| No student has two papers in the same session | hard |
| A *regular* student has at most one paper per day | hard |
| No session seats more students than the exam-usable seats | hard |
| Only dates in the window: no Sundays, no holidays | hard |
| A backlog student writing FN + AN on the same day | soft (avoided; can be made hard with `allow_backlog_same_day: false`) |
| Exams on consecutive days / two days apart | soft (cost 3 / 1 per shared student) |

Why backlog students may write two papers in a day: the full SRKR data has a **16-subject
clique**, mainly because of backlog students writing papers from several years. If every
student were limited to one exam per day, no algorithm could fit it into the 18-day window.

## Results on the SRKR datasets

| Dataset | Students | Subjects | Papers | Days used | Sessions | Same-session clashes | Regular same-day | Back-to-back students | Time |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| small  | 844   | 273 | 4,582  | 17 | 21 | 0 | 0 | 5.3%  | 0.5 s |
| medium | 3,015 | 280 | 16,392 | 18 | 23 | 0 | 0 | 11.7% | 1.0 s |
| full   | 7,551 | 280 | 40,919 | 18 | 34 | 0 | 0 | 7.4%  | 1.2 s |

On the full data, the refinement step cut students with back-to-back exams from 30.9% to 7.4%.

## Turnout prediction (`turnout.py`)

The model predicts what share of registered students will actually sit each paper. It learns
from `attendance_history.csv`, using paper type (regular/backlog), FN/AN, weekday, year, branch
and days since the student's previous exam.

**Backtest:** trained on Nov 2022–2024 and tested on Nov 2025, a cycle it has never seen.

| Model | Error per group | Error per session | Worst session under-prediction |
|---|---:|---:|---:|
| Assume everyone attends (today's practice) | 6.84 pts | 7.59% | — (over-books 7.3%) |
| Average by regular/backlog | 3.08 pts | 1.67% | 3.34% |
| **Linear regression (ridge)** ← chosen | **2.93 pts** | **0.96%** | 2.03% |
| Gradient boosting | 3.08 pts | 1.08% | 1.89% |

**The model rediscovers the hidden rule** that generated the data (attendance points):

| Factor | Hidden | Learned |
|---|---:|---:|
| backlog vs regular | −26.5 | −26.8 |
| afternoon (AN) | −1.5 | −1.6 |
| Saturday | −3.0 | −3.3 |
| 1 day since last exam | −1.0 | −1.0 |
| first exam of cycle | −0.5 | −0.6 |

**Forecast for the full SRKR timetable.** Seats are booked per session as
expected + 3 × binomial s.d. + 2.03% (the worst backtest miss), so running short of seats is
very unlikely:

| | If everyone attends | Booked with the model | Saved |
|---|---:|---:|---:|
| Seats | 40,919 | 40,097 | 2.0% |
| Room-sessions | 835 | 819 | 1.9% |
| Invigilator duties | 1,647 | 1,613 | 2.1% |

These savings are honest but small. Only about 5.7% of papers go unattended, because 97% of
papers belong to regular students, who attend about 95% of the time, and the safety margin
takes most of that slack. The best single session saves 5% (8.8% expected absent). Savings
grow with the backlog share and with absenteeism, so a college with more supplementary
students saves more.

## Run it

```bash
cd services/scheduler
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt          # Windows (use .venv/bin/pip elsewhere)

.venv\Scripts\python -m examgrid_scheduler.cli ..\..\data\full --out ..\..\output\full   # CLI
.venv\Scripts\python -m examgrid_scheduler.turnout_cli ..\..\data\full --timetable ..\..\output\full\timetable.csv --out ..\..\output\full
.venv\Scripts\python -m uvicorn examgrid_scheduler.api:app --port 8001                  # API
.venv\Scripts\python -m pytest -q                                                        # tests
```

API docs: http://localhost:8001/docs

| Endpoint | Purpose |
|---|---|
| `GET /health` | liveness check |
| `POST /timetable` | body: `subjects`, `registrations`, `rooms`, `config`. Returns the timetable rows and the validation report |
| `POST /timetable/demo/{small,medium,full}` | runs on a bundled SRKR dataset |
| `POST /turnout/demo/{small,medium,full}` | timetable + turnout: backtest, learned effects, per-session seat/room/invigilator plan |

Impossible inputs (a subject bigger than all seats, or more sessions needed than the window
has) return **422** with the reason.
