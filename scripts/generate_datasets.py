#!/usr/bin/env python3
"""Generate the datasets ExamGrid runs on, for SRKR Engineering College
(Autonomous), Bhimavaram, and write them as CSV files plus one Excel workbook.

Real (from SRKR's public documents):
  * R23 curriculum - every theory course, PE option and open elective, with
    SRKR's course codes, names, categories, credits and CIE/SEE marks
    (data/reference/srkr_r23_curriculum.json, built by fetch_srkr_curriculum.py)
  * roll-number format 23B91A0512 / 24B95A0503 and branch codes 01 02 03 04 05 12 54 57
  * 2026 sanctioned intake per branch

Synthetic: every student, faculty member, room, leave entry and attendance
record. No real person's data is used. See data/README.md.

Usage:
    python scripts/generate_datasets.py                 # full SRKR size (~7,300 students)
    python scripts/generate_datasets.py --scale medium  # 40%
    python scripts/generate_datasets.py --scale small   # 10%, for tests
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import random
import re
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

from excel_export import export_workbook

ROOT = Path(__file__).resolve().parent.parent
CURRICULUM_FILE = ROOT / "data" / "reference" / "srkr_r23_curriculum.json"
SCALES = {"small": 0.1, "medium": 0.4, "full": 1.0}

COLLEGE = "SRKR Engineering College (Autonomous), Bhimavaram"
COLLEGE_CODE = "B9"
REGULATION = "R23"
CURRENT_EXAM_YEAR = 2026     # Nov 2026 = odd-semester exams; year 1 joined in 2026

# branch -> (roll branch code, code confirmed from SRKR documents?, 2026 intake, full name)
BRANCHES = {
    "CSE":   ("05", True, 360, "Computer Science & Engineering"),
    "AIDS":  ("54", True, 240, "Artificial Intelligence & Data Science"),
    "AIML":  ("61", False, 240, "Artificial Intelligence & Machine Learning"),
    "IT":    ("12", True, 180, "Information Technology"),
    "ECE":   ("04", True, 180, "Electronics & Communication Engineering"),
    "CSIT":  ("59", False, 120, "Computer Science & Information Technology"),
    "EEE":   ("02", True, 120, "Electrical & Electronics Engineering"),
    "CIVIL": ("01", True, 120, "Civil Engineering"),
    "MECH":  ("03", True, 120, "Mechanical Engineering"),
    "CSBS":  ("57", True, 60, "Computer Science & Business Systems"),
    "CSD":   ("44", False, 60, "Computer Science & Design"),
    "CIC":   ("49", False, 60, "CSE (IoT & Cyber Security incl. Blockchain Technology)"),
}
# Department that owns a course, from the two letters after "B23".
PREFIX_DEPT = {"BS": "BSH", "HS": "BSH", "CS": "CSE", "AD": "AIDS", "AM": "AIML", "IT": "IT",
               "EC": "ECE", "EE": "EEE", "CE": "CIVIL", "ME": "MECH", "CB": "CSBS", "CD": "CSD",
               "CT": "CSIT", "CI": "CIC"}
# Abbreviations used in SRKR's "offered to" lists.
OFFERED_ALIAS = {"CE": "CIVIL", "ME": "MECH", "MECH": "MECH", "CSG": "CSD"}
NO_WRITTEN_EXAM = {"MC", "AC", "PR", "SEC"}

LATERAL_SHARE = 0.10         # diploma holders joining in year 2
SECTION_SIZE = 60
MAX_SEQ = 359                # 01-99 then A0-Z9: the most one branch code can number

# Common Telugu given names and Godavari-region surnames, "Surname Given-name" as on rolls.
MALE = ["Sai Teja", "Venkata Ramana", "Srinivas", "Naga Raju", "Sai Kiran", "Pavan Kumar", "Ravi Teja",
        "Harsha Vardhan", "Mahesh Babu", "Vamsi Krishna", "Surya Prakash", "Lokesh", "Karthik",
        "Chaitanya", "Rohith", "Manikanta", "Durga Prasad", "Satya Narayana", "Siva Kumar", "Jaswanth",
        "Gopi Krishna", "Phanindra", "Bhanu Prakash", "Yaswanth", "Tarun", "Hemanth", "Abhiram",
        "Uday Kiran", "Rama Krishna", "Sri Harsha", "Praveen", "Ganesh", "Akhil", "Dinesh", "Nikhil"]
FEMALE = ["Sri Lakshmi", "Naga Lakshmi", "Sai Priya", "Divya Sri", "Bhavani", "Lavanya", "Harika",
          "Keerthana", "Mounika", "Sravani", "Swathi", "Tejaswi", "Vyshnavi", "Pranathi", "Sahithi",
          "Jahnavi", "Hema Latha", "Durga Bhavani", "Satya Sri", "Anusha", "Bhargavi", "Deepika",
          "Haritha", "Kavya", "Meghana", "Navya Sri", "Ramya", "Sindhuja", "Supriya", "Yamini"]
SURNAMES = ["Kalidindi", "Datla", "Penmetsa", "Bhupathiraju", "Alluri", "Rudraraju", "Gottumukkala",
            "Mudunuri", "Vegesna", "Chintalapati", "Nadimpalli", "Kanumuri", "Yerramsetti", "Kolli",
            "Grandhi", "Karri", "Tadi", "Bandaru", "Pydi", "Vadlamudi", "Thota", "Koppisetti",
            "Akula", "Bolla", "Chilukuri", "Dasari", "Gadi", "Jampana", "Kakarla", "Mandapati",
            "Nalla", "Pericherla", "Sirigineedi", "Uppalapati", "Vanapalli", "Velagala", "Addala"]


def roll_suffix(seq: int) -> str:
    """01..99, then A0..A9, B0..B9, ... Z9 (JNTUK convention)."""
    if seq < 100:
        return f"{seq:02d}"
    seq -= 100
    return chr(ord("A") + seq // 10) + str(seq % 10)


def write_csv(path: Path, fieldnames: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def person_name(rng: random.Random, female: bool) -> str:
    return f"{rng.choice(SURNAMES)} {rng.choice(FEMALE if female else MALE)}"


def dept_of(code: str) -> str:
    return PREFIX_DEPT.get(code[3:5], "BSH")


# ---------------------------------------------------------------- curriculum
def has_written_exam(course: dict) -> bool:
    try:
        lecture, see = float(course["L"]), float(course["see"])
    except ValueError:
        return False
    return lecture > 0 and see > 0 and course["category"] not in NO_WRITTEN_EXAM


def parse_offered_to(text: str, offered_by: str) -> list[str]:
    if not text or "all" in text.lower():
        return [b for b in BRANCHES if b != offered_by]
    tokens = [t.strip().upper() for t in re.split(r"[,&]|\band\b", text) if t.strip()]
    return sorted({OFFERED_ALIAS.get(t, t) for t in tokens} & set(BRANCHES))


class Curriculum:
    """Odd-semester (I semester of each year) written-exam courses, from SRKR's R23 syllabus."""

    def __init__(self, path: Path, rng: random.Random):
        raw = json.loads(path.read_text(encoding="utf-8"))
        self.subjects: dict[str, dict] = {}
        self.core: dict[tuple[str, int], list[str]] = {}
        self.slots: dict[tuple[str, int], list[str]] = {}
        self.pe: dict[tuple[str, str], list[str]] = {}
        self.oe: dict[str, list[dict]] = {}

        for branch in BRANCHES:
            for year in range(1, 5):
                sem = raw["curriculum"][branch][str(year)]["1"]
                codes = []
                for c in sem["courses"]:
                    if has_written_exam(c):
                        self._add(c["code"], c["name"], c["category"], year, c, branch, slot="")
                        codes.append(c["code"])
                self.core[(branch, year)] = codes
                self.slots[(branch, year)] = sem["elective_slots"]
            for slot, options in raw["pe_options"][branch].items():
                year = 3 if slot == "PE-I" else 4 if slot in ("PE-IV", "PE-V") else None
                if year is None:
                    continue  # PE-II/III run in even semesters
                for o in options:
                    self._add(o["code"], o["name"], "PE", year, None, branch, slot)
                self.pe[(branch, slot)] = [o["code"] for o in options]

        for slot, options in raw["open_electives"].items():
            year = 3 if slot == "OE-I" else 4
            for o in options:
                by = dept_of(o["code"])
                to = parse_offered_to(o["offered_to"], by)
                self._add(o["code"], o["name"], "OE", year, None, None, slot, offered_to=to)
                self.oe.setdefault(slot, []).append(dict(code=o["code"], offered_by=by, offered_to=to))

        # Fixed popularity per elective so choices are uneven, like real registrations.
        self.weight = {code: rng.uniform(0.3, 1.0) for code in self.subjects}

    def _add(self, code, name, category, year, course, branch, slot, offered_to=None):
        s = self.subjects.get(code)
        if s is None:
            s = self.subjects[code] = dict(
                subject_code=code, subject_name=name, department=dept_of(code), year=year, semester=1,
                category=category, elective_slot=slot,
                credits=(course or {}).get("credits", "3"), cie_marks=(course or {}).get("cie", "30"),
                see_marks=(course or {}).get("see", "70"), duration_min=180, _offered=set())
        if offered_to:
            s["_offered"].update(offered_to)
        elif branch:
            s["_offered"].add(branch)

    def subject_rows(self) -> list[dict]:
        rows = []
        for s in sorted(self.subjects.values(), key=lambda s: (s["year"], s["category"] != "BS", s["subject_code"])):
            row = {k: v for k, v in s.items() if k != "_offered"}
            row["offered_to"] = ";".join(sorted(s["_offered"]))
            rows.append(row)
        return rows

    def choose(self, rng, codes):
        return rng.choices(codes, weights=[self.weight[c] for c in codes])[0]

    def papers(self, branch: str, year: int, rng: random.Random) -> list[str]:
        """Written papers for one student of `branch` in semester 1 of `year`, electives chosen."""
        codes = list(self.core[(branch, year)])
        for slot in self.slots[(branch, year)]:
            if slot.startswith("PE") and (branch, slot) in self.pe:
                codes.append(self.choose(rng, self.pe[(branch, slot)]))
            elif slot in self.oe:
                eligible = [o["code"] for o in self.oe[slot]
                            if branch in o["offered_to"] and o["offered_by"] != branch and o["code"] not in codes]
                if eligible:
                    codes.append(self.choose(rng, eligible))
        return codes


# ---------------------------------------------------------------- students
def cohort_size(rng: random.Random, intake: int, scale: float, year: int) -> int:
    """Seats filled, minus a little attrition for senior batches."""
    filled = intake * scale * rng.uniform(0.93, 1.0) * (1 - 0.015 * (year - 1))
    return max(12, round(filled))


def build_students(rng: random.Random, scale: float, cur: Curriculum):
    students, registrations = [], []

    def add(roll, branch, year, seq, lateral):
        female = rng.random() < 0.45
        students.append(dict(
            roll_no=roll, name=person_name(rng, female), gender="F" if female else "M",
            branch=branch, year=year, semester=1,
            section=chr(ord("A") + (seq - 1) // SECTION_SIZE),
            admission_type="LATERAL" if lateral else "REGULAR",
            admission_year=CURRENT_EXAM_YEAR - year + 1 + (1 if lateral else 0),
            needs_ground_floor="yes" if rng.random() < 0.015 else "no",
        ))
        current = cur.papers(branch, year, rng)
        for code in current:
            registrations.append(dict(roll_no=roll, subject_code=code, reg_type="REGULAR", attempt=1))
        # Seniors may carry backlogs from earlier odd semesters they actually studied.
        older = list(range(2 if lateral else 1, year))
        if older and rng.random() < 0.16:
            pool = sorted({c for y in older for c in cur.papers(branch, y, rng)} - set(current))
            k = min(len(pool), rng.choices([1, 2, 3], [60, 28, 12])[0])
            for code in rng.sample(pool, k=k):
                registrations.append(dict(roll_no=roll, subject_code=code, reg_type="BACKLOG",
                                          attempt=rng.choices([2, 3, 4], [70, 22, 8])[0]))

    for branch, (bcode, _, intake, _) in BRANCHES.items():
        for year in range(1, 5):
            batch = CURRENT_EXAM_YEAR - year + 1
            size = min(MAX_SEQ, cohort_size(rng, intake, scale, year))
            for seq in range(1, size + 1):
                add(f"{batch % 100:02d}{COLLEGE_CODE}1A{bcode}{roll_suffix(seq)}", branch, year, seq, False)
            if year >= 2:  # lateral entrants join the batch in year 2, with their own roll series
                lateral = max(1, round(intake * scale * LATERAL_SHARE * rng.uniform(0.85, 1.0)))
                for i in range(1, lateral + 1):
                    add(f"{(batch + 1) % 100:02d}{COLLEGE_CODE}5A{bcode}{roll_suffix(i)}",
                        branch, year, size + i, True)
    return students, registrations


# ---------------------------------------------------------------- rooms
BLOCKS = [("MB", "Main Block"), ("CS", "CSE Block"), ("AI", "AI & DS Block"), ("IT", "IT Block"),
          ("EC", "ECE Block"), ("EE", "EEE Block"), ("CE", "Civil Block"), ("ME", "Mechanical Block"),
          ("BS", "Basic Sciences Block"), ("NB", "New Block"), ("LB", "Library Block"),
          ("XB", "Extension Block"), ("PB", "PG Block"), ("RB", "Research Block")]


def seats_needed(students: list[dict]) -> int:
    """Two year-groups usually write in the same session, so seat the two largest plus 15%."""
    per_year = defaultdict(int)
    for s in students:
        per_year[s["year"]] += 1
    return math.ceil(sum(sorted(per_year.values(), reverse=True)[:2]) * 1.15)


def build_rooms(rng: random.Random, target: int) -> list[dict]:
    rooms, total = [], 0
    for code, block_name in BLOCKS:
        for floor in range(4):
            for num in range(1, 6):
                if total >= target:
                    return rooms
                if floor == 0 and num == 1:
                    rtype, rows, cols = "SEMINAR_HALL", 10, 6
                elif code == "ME" and floor == 1:
                    rtype, rows, cols = "DRAWING_HALL", 8, 5
                else:
                    rtype, rows, cols = "CLASSROOM", rng.choice([6, 7, 8]), 6
                usable = rng.random() > 0.04  # a few rooms under maintenance
                rooms.append(dict(room_id=f"{code}-{floor}{num:02d}", block=block_name, floor=floor,
                                  rows=rows, cols=cols, capacity=rows * cols, room_type=rtype,
                                  is_ground_floor="yes" if floor == 0 else "no",
                                  exam_usable="yes" if usable else "no"))
                if usable:
                    total += rows * cols
    raise RuntimeError("ran out of blocks; extend BLOCKS")


# ---------------------------------------------------------------- faculty
def build_faculty(rng: random.Random, n_students: int, subjects: list[dict], exam_dates: list[date]):
    n_faculty = math.ceil(n_students / 16)
    total_intake = sum(b[2] for b in BRANCHES.values())
    share = {"BSH": 0.15}
    for b, (_, _, intake, _) in BRANCHES.items():
        share[b] = 0.85 * intake / total_intake
    counts = {d: max(3, round(n_faculty * s)) for d, s in share.items()}

    faculty, by_dept, n = [], defaultdict(list), 0
    for dept, count in counts.items():
        for _ in range(count):
            n += 1
            designation = rng.choices(["Professor", "Associate Professor", "Assistant Professor"],
                                       [12, 23, 65])[0]
            title = "Dr. " if designation != "Assistant Professor" or rng.random() < 0.2 else ""
            fid = f"SRKR{n:04d}"
            faculty.append(dict(
                faculty_id=fid, name=title + person_name(rng, rng.random() < 0.4),
                department=dept, designation=designation,
                max_duties={"Professor": 4, "Associate Professor": 7, "Assistant Professor": 10}[designation],
            ))
            by_dept[dept].append(fid)

    # Walk each department's faculty and subjects together so every teacher has
    # at least one subject and every subject at least one teacher. Courses written
    # by several branches run in many sections, so they get listed twice.
    teaches = set()
    for dept, pool in by_dept.items():
        dept_subjects = [s["subject_code"] for s in subjects if s["department"] == dept]
        dept_subjects += [s["subject_code"] for s in subjects
                          if s["department"] == dept and len(s["offered_to"].split(";")) > 2]
        if not dept_subjects:
            continue
        rng.shuffle(pool)
        for i in range(max(len(pool), len(dept_subjects))):
            teaches.add((pool[i % len(pool)], dept_subjects[i % len(dept_subjects)]))
    teaches = [dict(faculty_id=f, subject_code=c) for f, c in sorted(teaches)]

    unavailable = []
    for f in faculty:
        if rng.random() < 0.08:
            for d in sorted(rng.sample(exam_dates, k=rng.randint(1, 3))):
                unavailable.append(dict(faculty_id=f["faculty_id"], date=d.isoformat(),
                                        session=rng.choice(["FN", "AN", "BOTH"]),
                                        reason=rng.choice(["Conference", "Medical leave",
                                                           "External examiner duty", "Personal leave"])))
    return faculty, teaches, unavailable


# ---------------------------------------------------------------- exam calendar
def exam_days(start: date, count: int, holidays: set[date]) -> list[date]:
    days, d = [], start
    while len(days) < count:
        if d.weekday() != 6 and d not in holidays:  # no Sundays
            days.append(d)
        d += timedelta(days=1)
    return days


def build_exam_config() -> tuple[dict, list[date]]:
    holidays = [date(2026, 11, 24)]  # example declared holiday
    start = date(2026, 11, 16)
    dates = exam_days(start, 18, set(holidays))
    return dict(
        college=COLLEGE,
        regulation=REGULATION,
        exam_cycle="NOV-2026 Semester End Examinations (Regular & Supplementary)",
        start_date=start.isoformat(),
        last_allowed_date=dates[-1].isoformat(),
        holidays=[h.isoformat() for h in holidays],
        exclude_weekdays=["Sunday"],
        sessions=[dict(code="FN", start="10:00", end="13:00"),
                  dict(code="AN", start="14:00", end="17:00")],
        max_exams_per_student_per_day=1,
        students_per_invigilator=30,
        reserve_invigilators_per_session=2,
    ), dates


# ---------------------------------------------------------------- attendance history
WEEKDAY_EFFECT = {0: -0.010, 1: 0.0, 2: 0.0, 3: 0.0, 4: -0.005, 5: -0.030}


def true_attendance_prob(reg_type, session, weekday, year, gap_days, first_exam, subject_effect):
    """The hidden rule the turnout model should rediscover. Documented in data/README.md."""
    p = 0.965 if reg_type == "REGULAR" else 0.70
    p += -0.015 if session == "AN" else 0.0
    p += WEEKDAY_EFFECT[weekday]
    p += {1: 0.010, 2: 0.0, 3: 0.0, 4: -0.015}[year]
    p += -0.010 if gap_days == 1 else (0.005 if gap_days >= 3 else 0.0)
    p += -0.005 if first_exam else 0.0
    p += subject_effect if reg_type == "REGULAR" else 3 * subject_effect
    return min(0.995, max(0.30, p))


def build_history(rng: random.Random, scale: float, cur: Curriculum) -> list[dict]:
    """Four past odd-semester cycles (Nov 2022-2025), one row per course per section/backlog group.

    Uses the current R23 core courses for every past cycle so codes stay joinable.
    Electives are left out.
    """
    subject_effect = defaultdict(lambda: rng.gauss(0, 0.012))
    rows = []
    for cycle_year in range(2022, 2026):
        start = date(cycle_year, 11, 14)
        start += timedelta(days=(7 - start.weekday()) % 7)  # first Monday on/after 14 Nov
        days = exam_days(start, 20, set())
        session_for_year = {y: rng.choice(["FN", "AN"]) for y in range(1, 5)}
        for branch, (_, _, intake, _) in BRANCHES.items():
            for year in range(1, 5):
                size = min(MAX_SEQ, cohort_size(rng, intake, scale, year))
                sections = [min(SECTION_SIZE, size - i) for i in range(0, size, SECTION_SIZE)]
                codes = list(cur.core[(branch, year)])
                rng.shuffle(codes)
                idx, prev = rng.randint(0, 2), None
                for i, code in enumerate(codes):
                    d = days[min(idx, len(days) - 1)]
                    gap = 0 if prev is None else (d - prev).days
                    session = session_for_year[year]
                    groups = [("REGULAR", chr(ord("A") + k), n) for k, n in enumerate(sections)]
                    if year < 4:
                        groups.append(("BACKLOG", "", max(1, round(rng.gauss(10, 4) * scale * intake / 120))))
                    for reg_type, section, registered in groups:
                        g = gap if reg_type == "REGULAR" else rng.randint(1, 6)
                        first = i == 0 if reg_type == "REGULAR" else False
                        p = true_attendance_prob(reg_type, session, d.weekday(), year, g, first,
                                                 subject_effect[code])
                        present = sum(rng.random() < p for _ in range(registered))
                        rows.append(dict(
                            cycle=f"NOV-{cycle_year}", exam_date=d.isoformat(),
                            weekday=d.strftime("%A"), session=session, subject_code=code,
                            branch=branch, year=year, section=section, reg_type=reg_type,
                            gap_days=g, is_first_exam="yes" if first else "no",
                            registered=registered, present=present,
                            attendance_rate=round(present / registered, 4),
                        ))
                    prev = d
                    idx += rng.choice([1, 1, 2, 2, 3])
    rows.sort(key=lambda r: (r["exam_date"], r["session"], r["subject_code"], r["branch"], r["section"]))
    return rows


# ---------------------------------------------------------------- invalid samples
def build_invalid_samples(out: Path, students, registrations, rooms) -> None:
    """Small files with known mistakes, so the CSV importer's validation can be tested.

    Row numbers count the header as row 1, as a spreadsheet would show them.
    """
    bad_dir = out / "invalid_samples"
    expected = {}

    s = [dict(r) for r in students[:12]]
    s[3]["roll_no"] = s[2]["roll_no"]; s[5]["branch"] = ""; s[7]["year"] = 5
    s[9]["needs_ground_floor"] = "maybe"
    write_csv(bad_dir / "students_bad.csv", list(students[0]), s)
    expected["students_bad.csv"] = [
        {"row": 5, "column": "roll_no", "error": "duplicate roll_no"},
        {"row": 7, "column": "branch", "error": "required"},
        {"row": 9, "column": "year", "error": "must be 1-4"},
        {"row": 11, "column": "needs_ground_floor", "error": "must be yes/no"},
    ]

    r = [dict(x) for x in registrations[:12]]
    r[2]["roll_no"] = "99B91A0599"; r[4]["subject_code"] = "B23ZZ9999"; r[6] = dict(r[5])
    r[8]["reg_type"] = "REPEAT"
    write_csv(bad_dir / "registrations_bad.csv", list(registrations[0]), r)
    expected["registrations_bad.csv"] = [
        {"row": 4, "column": "roll_no", "error": "unknown student"},
        {"row": 6, "column": "subject_code", "error": "unknown subject"},
        {"row": 8, "column": "subject_code", "error": "duplicate registration"},
        {"row": 10, "column": "reg_type", "error": "must be REGULAR/BACKLOG"},
    ]

    m = [dict(x) for x in rooms[:8]]
    m[1]["capacity"] = m[1]["capacity"] + 10; m[3]["rows"] = -2; m[3]["capacity"] = -12
    m[5]["room_id"] = m[4]["room_id"]
    write_csv(bad_dir / "rooms_bad.csv", list(rooms[0]), m)
    expected["rooms_bad.csv"] = [
        {"row": 3, "column": "capacity", "error": "capacity must equal rows x cols"},
        {"row": 5, "column": "rows", "error": "must be positive"},
        {"row": 7, "column": "room_id", "error": "duplicate room_id"},
    ]
    (bad_dir / "expected_errors.json").write_text(json.dumps(expected, indent=2), encoding="utf-8")


# ---------------------------------------------------------------- sanity checks
def check(students, subjects, registrations, rooms, faculty, teaches) -> None:
    rolls = {s["roll_no"] for s in students}
    codes = {s["subject_code"] for s in subjects}
    assert len(rolls) == len(students), "duplicate roll numbers"
    assert all(r["roll_no"] in rolls and r["subject_code"] in codes for r in registrations)
    pairs = [(r["roll_no"], r["subject_code"]) for r in registrations]
    assert len(pairs) == len(set(pairs)), "duplicate registrations"
    usable = [r for r in rooms if r["exam_usable"] == "yes"]
    assert sum(r["capacity"] for r in usable) >= seats_needed(students) / 1.15, "not enough seats"
    ground = sum(r["capacity"] for r in usable if r["is_ground_floor"] == "yes")
    assert ground >= sum(s["needs_ground_floor"] == "yes" for s in students), "not enough ground-floor seats"
    taught = {t["subject_code"] for t in teaches}
    assert codes <= taught, f"subjects with no teacher: {codes - taught}"
    assert {f["faculty_id"] for f in faculty} == {t["faculty_id"] for t in teaches}, "idle or unknown faculty"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scale", choices=SCALES, default="full")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", type=Path, default=None, help="default: data/<scale>")
    ap.add_argument("--no-excel", action="store_true", help="skip the .xlsx workbook")
    args = ap.parse_args()

    rng = random.Random(args.seed)
    scale = SCALES[args.scale]
    out = args.out or ROOT / "data" / args.scale

    cur = Curriculum(CURRICULUM_FILE, rng)
    students, registrations = build_students(rng, scale, cur)
    # Only list subjects someone actually writes this cycle.
    used = {r["subject_code"] for r in registrations}
    subjects = [s for s in cur.subject_rows() if s["subject_code"] in used]
    rooms = build_rooms(rng, seats_needed(students))
    config, dates = build_exam_config()
    faculty, teaches, unavailable = build_faculty(rng, len(students), subjects, dates)
    history = build_history(rng, scale, cur)
    check(students, subjects, registrations, rooms, faculty, teaches)
    branches = [dict(branch=b, branch_name=name, roll_code=code,
                     roll_code_status="confirmed (SRKR result lists)" if ok else "ASSUMED - please confirm",
                     intake_2026=intake) for b, (code, ok, intake, name) in BRANCHES.items()]

    tables = {
        "students": students, "subjects": subjects, "registrations": registrations, "rooms": rooms,
        "faculty": faculty, "faculty_subjects": teaches, "faculty_unavailability": unavailable,
        "attendance_history": history, "branches": branches,
    }
    empty_headers = {"faculty_unavailability": ["faculty_id", "date", "session", "reason"]}
    for name, rows in tables.items():
        write_csv(out / f"{name}.csv", list(rows[0]) if rows else empty_headers[name], rows)
    (out / "exam_config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    build_invalid_samples(out, students, registrations, rooms)
    if not args.no_excel:
        xlsx = export_workbook(out / f"ExamGrid_SRKR_{args.scale}.xlsx", tables, config, args.scale, args.seed)

    backlog = [r for r in registrations if r["reg_type"] == "BACKLOG"]
    lateral = sum(s["admission_type"] == "LATERAL" for s in students)
    usable = [r for r in rooms if r["exam_usable"] == "yes"]
    shown = out.relative_to(ROOT) if out.is_relative_to(ROOT) else out
    print(f"Wrote {args.scale} SRKR dataset (seed {args.seed}) to {shown}")
    print(f"  students              {len(students):>6}  ({lateral} lateral entry, "
          f"{sum(s['needs_ground_floor'] == 'yes' for s in students)} need ground floor)")
    print(f"  subjects              {len(subjects):>6}  (R23 written-exam courses incl. electives)")
    print(f"  registrations         {len(registrations):>6}  ({len(backlog)} backlog, "
          f"{len({r['roll_no'] for r in backlog})} students with backlogs)")
    print(f"  rooms                 {len(rooms):>6}  ({len(usable)} usable, {sum(r['capacity'] for r in usable)} seats)")
    print(f"  faculty               {len(faculty):>6}  ({len(teaches)} subject assignments, {len(unavailable)} leave entries)")
    print(f"  attendance_history    {len(history):>6}  rows over 4 past cycles")
    if not args.no_excel:
        print(f"  excel                 {xlsx.relative_to(ROOT) if xlsx.is_relative_to(ROOT) else xlsx}")


if __name__ == "__main__":
    main()
