"""HTTP API for the scheduling service. The Node backend calls this.

    uvicorn examgrid_scheduler.api:app --reload --port 8001
    -> docs at http://localhost:8001/docs
"""
from __future__ import annotations

from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .data import build_input, load_dataset
from .timetable import TimetableError, generate_timetable

DATA_ROOT = Path(__file__).resolve().parents[3] / "data"

app = FastAPI(title="ExamGrid Scheduler", version="0.1.0",
              description="Clash-free exam timetables (DSatur graph colouring + local search).")


class Subject(BaseModel):
    subject_code: str
    subject_name: str = ""
    department: str = ""
    year: int | str = ""
    category: str = ""


class Registration(BaseModel):
    roll_no: str
    subject_code: str
    reg_type: Literal["REGULAR", "BACKLOG"] = "REGULAR"


class Room(BaseModel):
    room_id: str
    capacity: int = Field(gt=0)
    exam_usable: Literal["yes", "no"] = "yes"


class Session(BaseModel):
    code: str
    start: str = ""
    end: str = ""


class ExamConfig(BaseModel):
    start_date: str
    last_allowed_date: str
    holidays: list[str] = []
    exclude_weekdays: list[str] = ["Sunday"]
    sessions: list[Session] = [Session(code="FN", start="10:00", end="13:00"),
                               Session(code="AN", start="14:00", end="17:00")]
    allow_backlog_same_day: bool = True


class TimetableRequest(BaseModel):
    subjects: list[Subject]
    registrations: list[Registration]
    rooms: list[Room]
    config: ExamConfig
    seed: int = 0


class TimetableResponse(BaseModel):
    timetable: list[dict]
    report: dict


def _run(inp, seed: int) -> TimetableResponse:
    try:
        result = generate_timetable(inp, seed=seed)
    except TimetableError as e:
        raise HTTPException(status_code=422, detail={"error": str(e), **e.details})
    return TimetableResponse(timetable=result.rows, report=result.report)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "examgrid-scheduler"}


@app.post("/timetable", response_model=TimetableResponse)
def timetable(req: TimetableRequest) -> TimetableResponse:
    """Build a timetable from data sent in the request (what the Node API uses)."""
    inp = build_input(
        subjects=[s.model_dump() for s in req.subjects],
        registrations=[r.model_dump() for r in req.registrations],
        rooms=[r.model_dump() for r in req.rooms],
        config=req.config.model_dump(),
    )
    return _run(inp, req.seed)


@app.post("/timetable/demo/{scale}", response_model=TimetableResponse)
def timetable_demo(scale: Literal["small", "medium", "full"], seed: int = 0) -> TimetableResponse:
    """Build a timetable from one of the bundled SRKR datasets (handy for demos)."""
    folder = DATA_ROOT / scale
    if not folder.exists():
        raise HTTPException(status_code=404, detail=f"dataset {scale} not found; run scripts/generate_datasets.py")
    return _run(load_dataset(folder), seed)
