#!/usr/bin/env python3
"""Download SRKR's official R23 B.Tech syllabus PDFs and extract the course
structures into data/reference/srkr_r23_curriculum.json.

Source: https://srkrec.ac.in/syllabus/ (public curriculum documents).
Only course codes, names, categories and credit/marks schemes are kept.

Usage:
    python scripts/fetch_srkr_curriculum.py                  # download + parse
    python scripts/fetch_srkr_curriculum.py --pdf-dir DIR    # parse PDFs already in DIR
Needs: pip install pypdf
"""
from __future__ import annotations

import argparse
import json
import re
import tempfile
import urllib.request
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "reference" / "srkr_r23_curriculum.json"
BASE = "https://www.srkrec.ac.in/files/SYLLABUS/"

# file stem -> path under BASE. Stems are BRANCH + year, plus the open-elective lists.
PDFS = {
    "AIDS1": "R23/B.Tech_R23%20I_Year_%20AIDS_%20Syllabus_%20FINAL.pdf",
    "AIDS2": "R23/B.Tech_R23%20II_Year_%20AIDS_%20Syllabus_%20FINAL.pdf",
    "AIDS3": "R23/R23_3rd_YEAR_AIDS_SYLLABUS.pdf",
    "AIDS4": "R23/B.Tech%20_R23%20_IV_%20Year_AIDS.pdf",
    "AIML1": "R23/B.Tech_R23_I%20_Year_%20AIML%20_Syllabus%20_FINAL.pdf",
    "AIML2": "R23/B.Tech_R23_II%20_Year_%20AIML%20_Syllabus%20_FINAL.pdf",
    "AIML3": "R23/R23_3rd_YEAR_AIML_SYLLABUS.pdf",
    "AIML4": "R23/B.Tech%20_R23%20_IV_%20Year_AIML.pdf",
    "CSIT1": "R23/B.Tech_R23_I%20_Year_%20CSIT_%20Syllabus_%20FINAL.pdf",
    "CSIT2": "R23/B.Tech_R23_II%20_Year_%20CSIT_%20Syllabus_%20FINAL.pdf",
    "CSIT3": "R23/R23_3rd_YEAR_CSIT_SYLLABUS.pdf",
    "CSIT4": "R23/B.Tech%20_R23%20_IV_%20Year_CSIT.pdf",
    "CIVIL1": "R23/B.Tech_R23%20_I%20_Year_%20CIVIL_%20Syllabus%20_FINAL.pdf",
    "CIVIL2": "R23/B.Tech_R23%20_II%20_Year_%20CIVIL_%20Syllabus%20_FINAL.pdf",
    "CIVIL3": "R23/R23_3rd_YEAR_CIVIL_SYLLABUS.pdf",
    "CIVIL4": "R23/B.Tech%20_R23%20_IV_%20Year_CIVIL.pdf",
    "CSBS1": "R23/B.Tech_R23_%20I_Year_CSBS_Syllabus_FINAL.pdf",
    "CSBS2": "R23/B.Tech_R23_%20II_Year_CSBS_Syllabus_FINAL.pdf",
    "CSBS3": "R23/R23_3rd_YEAR_CSBS_SYLLABUS.pdf",
    "CSBS4": "R23/B.Tech%20_R23%20_IV_%20Year_CSBS.pdf",
    "CSD1": "R23/B.Tech_R23_I_Year_CSG_Syllabus_FINAL.pdf",
    "CSD2": "R23/B.Tech_R23_II_Year_CSG_Syllabus_FINAL.pdf",
    "CSD3": "R23/R23_3rd_YEAR_CSD_SYLLABUS.pdf",
    "CSD4": "R23/B.Tech%20_R23%20_IV_%20Year_CSD.pdf",
    "CSE1": "R23/B.Tech_R23_I_Year_CSE_Syllabus_FINAL.pdf",
    "CSE2": "R23/B.Tech_R23_II_Year_CSE_Syllabus_FINAL.pdf",
    "CSE3": "R23/R23_3rd_YEAR_CSE_SYLLABUS.pdf",
    "CSE4": "R23/B.Tech%20_R23%20_IV_%20Year_CSE.pdf",
    "CIC1": "R23/B.Tech_R23_I_Year_CIC_Syllabus_FINAL.pdf",
    "CIC2": "R23/B.Tech_R23_II_Year_CIC_Syllabus_FINAL.pdf",
    "CIC3": "R23/R23_3rd_YEAR_CIC_SYLLABUS.pdf",
    "CIC4": "R23/B.Tech%20_R23%20_IV_%20Year_CIC.pdf",
    "ECE1": "R23/B.Tech_R23_I_Year_ECE_Syllabus_FINAL.pdf",
    "ECE2": "R23/B.Tech_R23_II_Year_ECE_Syllabus_FINAL.pdf",
    "ECE3": "R23/R23_3rd_YEAR_ECE_SYLLABUS.pdf",
    "ECE4": "R23/B.Tech%20_R23%20_IV_%20Year_ECE.pdf",
    "EEE1": "R23/B.Tech_R23_I_Year_EEE_Syllabus_FINAL.pdf",
    "EEE2": "R23/B.Tech_R23_II_Year_EEE_Syllabus_FINAL.pdf",
    "EEE3": "R23/R23_3rd_YEAR_EEE_SYLLABUS.pdf",
    "EEE4": "R23/B.Tech%20_R23%20_IV_%20Year_EEE.pdf",
    "IT1": "R23/B.Tech_R23_I_Year_IT_Syllabus_FINAL.pdf",
    "IT2": "R23/B.Tech_R23_II_Year_IT_Syllabus_FINAL.pdf",
    "IT3": "R23/R23_3rd_YEAR_IT_SYLLABUS.pdf",
    "IT4": "R23/B.Tech%20_R23%20_IV_%20Year_IT.pdf",
    "MECH1": "R23/B.Tech_R23_I_Year_MECH_Syllabus_FINAL.pdf",
    "MECH2": "R23/B.Tech_R23_II_Year_MECH_Syllabus_FINAL.pdf",
    "MECH3": "R23/R23_3rd_YEAR_MECH_SYLLABUS.pdf",
    "MECH4": "R23/B.Tech%20_R23%20_IV_%20Year_MECH.pdf",
    "OE1": "R23_OE/23_SERIES_OE_1_syllabus.pdf",
    "OE3": "R23_OE/OE-III%20SYLLABUS.pdf",
    "OE4": "R23_OE/OE-IV%20SYLLABUS.pdf",
}
OE_SLOTS = {"OE1": "OE-I", "OE3": "OE-III", "OE4": "OE-IV"}

ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5}
CATEGORY = r"(BS|HS|ES|PC|PE|OE|SEC|MC|PR|AC)"
ROW = re.compile(r"(B23[A-Z]{2}\d{4})\s+(.+?)\s+" + CATEGORY + r"\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)")
HEAD = re.compile(r"Regulation\s*:?\s*R23\s*(IV|III|II|I)\s*/\s*IV\s*-?\s*B\.?\s*Tech\.?\s*(II|I)\s*-?\s*Semester", re.I)
SLOT = re.compile(r"#\s*(PE|OE)\s*-\s*(IV|V|III|II|I)\b")


def norm(text: str) -> str:
    return re.sub("[‒–—�]", "-", text)


def clean(s: str) -> str:
    s = re.sub(r"(\w)- (\w)", r"\1\2", s)  # undo hyphenated line wraps: "Elec- tronics"
    return re.sub(r"\s+", " ", s).strip(" -")


def page_texts(path: Path) -> list[str]:
    return [norm(p.extract_text() or "") for p in PdfReader(path).pages]


def parse_branch_pdf(pages: list[str], options: dict) -> dict:
    """Return {year: {sem: {courses, elective_slots}}}; fill `options` with PE choices."""
    found = {}
    for text in pages:
        # Elective option lists: a bare "#PE-x" line followed by "B23.... Name" lines.
        current = None
        for line in (l.strip() for l in text.splitlines()):
            sm = SLOT.match(line)
            if sm:
                rest = line[sm.end():].strip().lower()
                current = f"PE-{sm.group(2)}" if sm.group(1) == "PE" and not rest.startswith("professional") else None
                continue
            if HEAD.search(line) or (line.startswith("Course") and "Category" in line):
                current = None
                continue
            cm = re.match(r"(B23[A-Z]{2}\d{4})\s+(.+)", line)
            if cm and current and not ROW.match(line):
                name = clean(cm.group(2))
                if "MOOC" not in name.upper():  # MOOCs have no college exam
                    options.setdefault(current, {})[cm.group(1)] = name

        h = HEAD.search(text)
        if not h:
            continue
        year, sem = ROMAN[h.group(1).upper()], ROMAN[h.group(2).upper()]
        body = text[h.end():]
        body = body[: body.find("TOTAL")] if "TOTAL" in body else body
        flat = clean(body.replace("\n", " "))
        courses = [dict(code=r[0], name=clean(r[1]), category=r[2], L=r[3], T=r[4], P=r[5],
                        credits=r[6], cie=r[7], see=r[8]) for r in (m.groups() for m in ROW.finditer(flat))]
        slots = sorted({f"{a}-{b}" for a, b in SLOT.findall(flat)})
        found.setdefault(str(year), {})[str(sem)] = dict(courses=courses, elective_slots=slots)
    return found


def parse_open_electives(pages: list[str]) -> list[dict]:
    seen = {}
    for text in pages:
        lines = [l.strip() for l in text.splitlines()]
        for i, line in enumerate(lines):
            m = re.match(r"(B23[A-Z]{2}OE\d{2})\s+OE\s+3", line)
            if not m or m.group(1) in seen:
                continue
            title, by, to = [], "", ""
            for nxt in lines[i + 1:i + 8]:
                if not nxt:
                    continue
                bm = re.match(r"\(?Offered by\s*([^)]+)\)?", nxt, re.I)
                tm = re.match(r"\((?:Offered|Common)\s+to\s*([^)]+)\)?", nxt, re.I)
                if bm:
                    by = clean(bm.group(1))
                    continue
                if tm:
                    to = clean(tm.group(1))
                    break
                if nxt.lower().startswith(("course objectives", "pre-requisite")):
                    break
                title.append(nxt)
            seen[m.group(1)] = dict(code=m.group(1), name=clean(" ".join(title)).title(),
                                    offered_by=by, offered_to=to)
    return list(seen.values())


def download(pdf_dir: Path) -> None:
    pdf_dir.mkdir(parents=True, exist_ok=True)
    for stem, rel in PDFS.items():
        target = pdf_dir / f"{stem}.pdf"
        if target.exists() and target.stat().st_size > 10_000:
            continue
        print("downloading", stem)
        with urllib.request.urlopen(BASE + rel, timeout=60) as resp:
            target.write_bytes(resp.read())


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pdf-dir", type=Path, help="folder with PDFs (downloaded there if missing)")
    args = ap.parse_args()
    pdf_dir = args.pdf_dir or Path(tempfile.gettempdir()) / "srkr_syllabus"
    download(pdf_dir)

    curriculum, pe_options, open_electives = {}, {}, {}
    for stem in PDFS:
        pages = page_texts(pdf_dir / f"{stem}.pdf")
        if stem in OE_SLOTS:
            open_electives[OE_SLOTS[stem]] = parse_open_electives(pages)
            continue
        branch = stem.rstrip("1234")
        opts = pe_options.setdefault(branch, {})
        for year, sems in parse_branch_pdf(pages, opts).items():
            curriculum.setdefault(branch, {}).setdefault(year, {}).update(sems)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(dict(
        source="https://srkrec.ac.in/syllabus/ (R23 B.Tech, with effect from 2023-24 admitted batch)",
        curriculum=curriculum,
        pe_options={b: {slot: [dict(code=c, name=n) for c, n in v.items()] for slot, v in sorted(o.items())}
                    for b, o in pe_options.items()},
        open_electives=open_electives,
    ), indent=1), encoding="utf-8")

    for b in sorted(curriculum):
        sems = {f"{y}-{s}": len(v["courses"]) for y, d in sorted(curriculum[b].items()) for s, v in sorted(d.items())}
        print(f"{b:6} courses per semester {sems}  PE slots {sorted(pe_options[b])}")
    print("open electives:", {k: len(v) for k, v in open_electives.items()})
    print("wrote", OUT.relative_to(ROOT))


if __name__ == "__main__":
    main()
