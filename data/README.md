# ExamGrid datasets: SRKR Engineering College

The datasets are for **SRKR Engineering College (Autonomous), Bhimavaram**, for the
NOV-2026 semester-end exams (odd semester: I-I, II-I, III-I and IV-I).

Every scale folder holds the CSV files and one Excel workbook
(`ExamGrid_SRKR_<scale>.xlsx`). The workbook has an About sheet, a Summary sheet calculated
with formulas, and one sheet per dataset.

```bash
python scripts/generate_datasets.py                  # full SRKR size (default)
python scripts/generate_datasets.py --scale medium   # 40%
python scripts/generate_datasets.py --scale small    # 10%, for tests
python scripts/fetch_srkr_curriculum.py              # re-download SRKR's syllabus PDFs and rebuild the curriculum
```

| Scale  | Students | Lateral | Subjects | Registrations | Backlog regs | Usable rooms | Seats | Faculty |
|--------|---------:|--------:|---------:|--------------:|-------------:|-------------:|------:|--------:|
| small  | 844      | 54      | 273      | 4,582         | 148          | 12           | 504   | 58      |
| medium | 3,015    | 204     | 280      | 16,392        | 555          | 42           | 1,782 | 188     |
| full   | 7,551    | 516     | 280      | 40,919        | 1,277        | 102          | 4,458 | 474     |

## Real vs synthetic

| Item | Status | Source |
|---|---|---|
| **Curriculum**: every written-exam course code, name, category, credits, CIE/SEE marks; PE-I, PE-IV and PE-V options; OE-I, OE-III and OE-IV lists with "offered by / offered to" rules | **Real** (R23) | SRKR syllabus PDFs, https://srkrec.ac.in/syllabus/ |
| Roll number format `23B91A0512`, lateral entry `24B95A0503` | **Real** | SRKR published result lists |
| Branch roll codes 01 CIVIL, 02 EEE, 03 MECH, 04 ECE, 05 CSE, 12 IT, 54 AIDS, 57 CSBS | **Real** | SRKR published result lists |
| Branch roll codes AIML 61, CSIT 59, CSD 44, CIC 49 | **Assumed**: confirm and edit `BRANCHES` in the generator | — |
| Intake per branch (CSE 360, AIDS 240, AIML 240, IT 180, ECE 180, CSIT 120, EEE/CIVIL/MECH 120, CSBS/CSD/CIC 60) | Real (2026) | Collegedunia |
| Students, faculty, names, sections, backlogs, rooms, blocks, leave, attendance | **Synthetic** | generated, no real person's data |

`data/reference/srkr_r23_curriculum.json` is the parsed curriculum: all 12 branches, all 8
semesters, PE options and open electives. The generator uses only the odd semesters.

## What counts as an exam paper

A course gets a written semester-end exam when it has lecture hours (L > 0) and SEE marks, and
is not a lab, skill course (SEC), mandatory course (MC), audit course (AC) or project (PR).
MOOC electives are excluded, since they have no college exam. Per semester, a student writes:

| Year | Papers | Electives the student picks |
|---|---|---|
| I-I | 5 common courses (two first-year groups take different papers) | — |
| II-I | 5 courses (e.g. CSE: DMGT, UHV-II, DLCO, DBMS, OOP through Java) | — |
| III-I | 3 core + PE-I + OE-I | 1 PE-I from own department; 1 OE-I offered to their branch by another department |
| IV-I | 1–2 core + PE-IV + PE-V + OE-III + OE-IV | 2 PEs, 2 OEs |

Elective choice is weighted (some options are more popular), as in real registrations. Codes
shared across branches, such as `B23BS2101` (Discrete Mathematics, 8 branches) and the open
electives, are what make the timetable a real clash problem.

## Files

### students.csv
`roll_no, name, gender, branch, year, semester, section, admission_type, admission_year, needs_ground_floor`.
Sections hold 60 students. Lateral entrants join in year 2 and continue the batch's section
letters. `needs_ground_floor=yes` covers about 1.5% of students and is a hard seating rule.

### subjects.csv
`subject_code, subject_name, department, year, semester, category, elective_slot, credits, cie_marks, see_marks, duration_min, offered_to`.
`category` is SRKR's own: BS, HS, ES, PC, PE or OE. `department` comes from the code prefix
(BS/HS = BSH, CS = CSE, AD = AIDS, AM = AIML, CT = CSIT, CD = CSD, CI = CIC, CB = CSBS, ...).
`offered_to` lists the branches that write the paper.

### registrations.csv
One row for every student-paper. `reg_type` is `REGULAR` or `BACKLOG`. About 16% of seniors
carry 1–3 backlogs from earlier odd semesters. Lateral entrants only get backlogs from
semesters they studied.

### rooms.csv
Rooms are spread across named blocks, with ids like `CS-204`. Seats form a `rows × cols` grid,
which defines each seat's neighbours. **Seats cover the two largest year-groups plus 15%**, so
the timetable must also respect seat capacity per session.

### faculty.csv, faculty_subjects.csv, faculty_unavailability.csv
About one faculty member per 16 students, with ids `SRKR0001`…. `max_duties`: Professor 4,
Associate 7, Assistant 10. Every faculty member teaches at least one subject and must not
invigilate it. Leave days (`FN`, `AN` or `BOTH`) are hard constraints.

### branches.csv
Branch name, roll code, whether that code is confirmed, and 2026 intake.

### exam_config.json
NOV-2026 window (starts Mon 16 Nov 2026, no Sundays, one example holiday), FN 10:00–13:00
and AN 14:00–17:00, 1 exam per student per day, 30 students per invigilator.
**Session times are assumed**; replace them with SRKR's actual timings if they differ.

### attendance_history.csv
Turnout from four past cycles (Nov 2022–2025) over the real core courses, one row per course
per section (regular) or per branch (backlog group). This is the training data for the
turnout model. Electives are left out.

## The hidden attendance rule

| factor | effect |
|---|---|
| base: regular / backlog | 96.5% / 70% |
| afternoon (AN) session | −1.5 points |
| Monday / Friday / Saturday | −1.0 / −0.5 / −3.0 points |
| year 1 / year 4 | +1.0 / −1.5 points |
| 1 day since previous exam / 3+ days | −1.0 / +0.5 points |
| first exam of the cycle | −0.5 points |
| per-subject difficulty | random, about ±1.2 points (3× stronger for backlog) |

## Invalid samples (`<scale>/invalid_samples/`)
CSVs with deliberate mistakes, plus `expected_errors.json` (the header is row 1), for testing
the importer's validation.
