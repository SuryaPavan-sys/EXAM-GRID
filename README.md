# ExamGrid

ExamGrid automates exam timetabling, seating and invigilation for **SRKR Engineering College
(Autonomous), Bhimavaram**, for the NOV-2026 semester-end exams, using SRKR's real R23 curriculum.

Exam cells usually plan exams by hand in spreadsheets. That causes clashes for backlog
students, same-paper students sitting side by side, uneven invigilation duties, and rooms booked
for students who never come. ExamGrid plans the whole cycle in about a minute and proves every
rule with an independent checker.

## Results on the full SRKR dataset

| | |
|---|---|
| Students / papers | **7,551** students in 12 branches, 280 R23 subjects, **40,919** papers (1,277 supply) |
| Timetable | 18 days, 34 sessions · **0 clashes** · 0 regular students with two exams in a day · 1.2 s |
| Spacing | students with back-to-back exam days cut from 30.9% to **7.4%** |
| Turnout model | ridge regression, **0.96%** session error on an unseen cycle; it rediscovers the true attendance effects |
| Seating | all 40,919 seated · **0 same-paper neighbours** (left/right/front/back) · ground-floor needs met |
| Invigilation | 1,932 duties · 0 own-subject · 0 double-booked · leave respected · 2–5 duties each |

## How it works

```
 React website (Vite, Tailwind, Recharts, dnd-kit)
        │
 Node.js + Express  ── JWT login (admin / faculty / student), seat editor, hall tickets (PDF + QR)
        │ runs the pipeline
        ├── Python  services/scheduler   timetable: conflict graph + DSatur colouring + local search
        │                                turnout:   ridge regression, backtested
        └── Java    services/solver      seating + invigilation: Timefold constraint solver
```

1. **Timetable (graph colouring).** Each subject is a node, linked to every subject that shares
   a student. A hand-written **DSatur** algorithm gives each subject a session without going over
   the seats. Local search then spreads out each student's exams.
   [details](services/scheduler/README.md)
2. **Turnout (machine learning).** A regression model learns from past attendance by paper type,
   FN/AN, weekday, year and gap since the last exam. Seats are booked as expected + 3σ + the worst
   backtest miss.
3. **Seating (constraint solving).** Each room is a chessboard, and each paper takes one colour,
   so same-paper students can never be neighbours. **Timefold** packs students into rooms (seats,
   ground floor) while opening as few rooms as possible and keeping each subject together.
4. **Invigilation (constraint solving).** Timefold assigns faculty under these rules: never their
   own subject, never two rooms at once, leave respected, duty caps by designation, fair load.
5. **Website.** Dashboard, timetable, seating editor (drag and drop, rules checked live), duties,
   turnout model, CSV import validation, one-click re-planning, student seat lookup, and hall
   tickets with a QR verification code.
6. **Plan Assistant (LLM chat).** The exam cell describes a problem or change in plain words, for
   example "Room CS-204 has no power, and SRKR0012 can't come on 2 Dec FN".
   - With Claude (`claude-opus-5-5`, tool use), the assistant looks up the plan, checks the
     request, and proposes changes. It can only propose a fixed set of validated actions: room
     availability, faculty leave, holiday, move/pin an exam, last exam date.
   - **Apply** backs up the data, re-runs timetable → turnout → seating → duties, and shows a
     before/after table. **Undo** restores the backup and re-plans.
   - Without an API key, a built-in parser handles clear commands. Put `ANTHROPIC_API_KEY` in
     `web/server/.env` (see `.env.example`) to enable Claude.

## Run the website

```bash
start.cmd
```

Then open **http://localhost:3000**. The login page shows the demo accounts (from
`web/server/seed/users.json`).

## Run everything from scratch

```bash
python scripts/generate_datasets.py                       # SRKR datasets (data/full) + Excel
cd services/scheduler && python -m venv .venv && .venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m examgrid_scheduler.cli ..\..\data\full --out ..\..\output\full
.venv\Scripts\python -m examgrid_scheduler.turnout_cli ..\..\data\full --timetable ..\..\output\full\timetable.csv --out ..\..\output\full
cd ..\solver && mvn package                                # needs Java 21 + Maven
java -jar target\examgrid-solver-0.1.0.jar batch ..\..\data\full ..\..\output\full
```

After the first run, the website's **Data & pipeline → Run full pipeline** button repeats the
last three steps.

## Project layout

| Folder | What |
|---|---|
| `data/` | SRKR datasets, as CSV and Excel ([data card](data/README.md)) |
| `scripts/` | dataset generator, SRKR syllabus parser, Excel export |
| `services/scheduler/` | Python: timetable (DSatur) + turnout model + FastAPI (port 8001) |
| `services/solver/` | Java 21 + Spring Boot + Timefold: seating + invigilation (port 8002) |
| `web/server/` | Node + Express API, auth, PDFs, pipeline runner (port 3000) |
| `web/client/` | React website |

## Honest notes

- All people and attendance data are **synthetic**. Only SRKR's public formats and curriculum are real.
- Backlog (supply) students may write FN + AN on the same day. The full data contains a 16-subject
  clique, so "one exam a day for everyone" cannot fit an 18-day window. Regular students always get
  one exam a day.
- Turnout prediction saves about **2%** of seats and duties, not the 10–20% first assumed: at
  SRKR-like attendance, only about 5.7% of papers go unattended.
- Storage is file-based (CSV/JSON in `output/`). MongoDB is planned but not wired in yet.
