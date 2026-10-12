# ExamGrid

Automated exam timetabling, seating and invigilation for engineering colleges.
The demo data is modelled on SRKR Engineering College (Autonomous), Bhimavaram.

Exam cells usually plan timetables, seating and invigilation duties by hand in spreadsheets.
That leads to:
- clashes for backlog students
- students with the same subject sitting next to each other
- uneven invigilation duties
- rooms booked for students who never turn up

ExamGrid automates the whole pipeline:

1. **Data import:** CSV upload of students, subjects, registrations, rooms and faculty, with validation.
2. **Timetable:** graph colouring (DSatur) over a subject conflict graph. No student has two exams
   in one session, and every session fits within the seat capacity.
3. **Turnout prediction:** a regression model on past attendance estimates how many students will
   actually attend, so fewer rooms and invigilators are booked.
4. **Seating and invigilation:** a constraint solver.
   - Seating: no same-subject neighbours, ground-floor seats for students who need them, rooms filled evenly.
   - Invigilation: no one gets a duty for their own subject, there are no double bookings, and duties are spread evenly.
5. **Review and publish:** a drag-and-drop seat editor with live rule checks, a student seat lookup,
   faculty duty lists, and hall tickets with QR codes.

## Architecture

```
React (UI)  →  Node.js + Express (API, auth)  →  MongoDB
                    │                 │
                    ▼                 ▼
      Python (FastAPI)          Java (Spring Boot)
      timetable + turnout       seating + duty solver
```

| Layer | Technology |
|---|---|
| Frontend | React (Vite), Tailwind CSS, dnd-kit, Recharts |
| Backend API | Node.js, Express, JWT |
| Database | MongoDB, Mongoose |
| Scheduling & ML | Python, FastAPI, NetworkX, scikit-learn, pandas |
| Optimisation | Java 17+, Spring Boot, Timefold Solver |
| DevOps | Docker Compose, GitHub |

## Status

- [x] SRKR datasets on the real R23 curriculum, as CSV and Excel: [`data/`](data/README.md)
- [x] Timetable service (DSatur + seat capacity + local search, FastAPI): [`services/scheduler/`](services/scheduler/README.md).
  On the full SRKR data: 7,551 students, 280 subjects, **0 clashes**, 18 days, 1.2 s.
- [x] Turnout prediction: ridge regression, backtested on an unseen cycle (0.96% session error).
  It rediscovers the true attendance effects and books about 2% fewer seats, rooms and
  invigilator duties with a safety margin.
- [ ] Seating and invigilation solver
- [ ] API, dashboard and seat editor
- [ ] Hall tickets, room charts and deployment

## Datasets

```bash
python scripts/generate_datasets.py                  # full SRKR size (~6,500 students)
python scripts/generate_datasets.py --scale small    # ~700 students, for tests
```

All data is synthetic. Only SRKR's public formats (roll numbers, subject codes, branch codes,
intake) are copied, and no real student or staff data is included. See
[data/README.md](data/README.md) for the schema, the assumptions made, and the hidden attendance
rule the turnout model is evaluated against.
