"""Turnout prediction: how many registered students will actually sit each exam.

Trained on attendance_history (past cycles, one row per subject per section or
backlog group). Every model predicts an *attendance rate* from:

    reg_type (REGULAR/BACKLOG), session (FN/AN), weekday, year, branch,
    days since the student's previous exam (capped at 6), first exam of cycle

Evaluation is honest: train on older cycles, test on the newest one the model
has never seen - which is exactly how it would be used before a real exam.

For a new timetable the model scores every student-paper, then each session's
seat booking is

    booked = expected + 3 x binomial s.d. + model margin x expected

where the margin is the worst session-level under-prediction seen in the
backtest. That keeps the chance of a session running out of seats tiny.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

CATEGORICAL = ["reg_type", "session", "weekday", "year", "branch", "gap"]


def features(df: pd.DataFrame) -> pd.DataFrame:
    """Turn raw columns into the categorical features every model uses.

    `year` is the year the paper belongs to (for a backlog paper, the subject's
    year, as in attendance_history). `gap` is days since the student's previous
    exam this cycle: "first" for the first exam, 1, 2, or "3+".
    """
    gap = df["gap_days"].astype(int).clip(lower=0)
    return pd.DataFrame({
        "reg_type": df["reg_type"].astype(str),
        "session": df["session"].astype(str),
        "weekday": df["weekday"].astype(str),
        "year": df["year"].astype(int).astype(str),
        "branch": df["branch"].astype(str),
        "gap": np.where(gap == 0, "first", np.where(gap >= 3, "3+", gap.astype(str))),
    })


# ---------------------------------------------------------------- models
class AssumeAllPresent:
    """What exam cells do today: book a seat for every registered student."""
    name = "assume everyone attends"

    def fit(self, X, y, w):
        return self

    def predict(self, X):
        return np.ones(len(X))


class MeanByType:
    """Average attendance of regular vs backlog students, nothing else."""
    name = "average by regular/backlog"

    def fit(self, X, y, w):
        df = pd.DataFrame({"t": X["reg_type"].values, "y": y, "w": w})
        self.rate = (df.y * df.w).groupby(df.t).sum() / df.w.groupby(df.t).sum()
        return self

    def predict(self, X):
        return X["reg_type"].map(self.rate).fillna(self.rate.mean()).to_numpy()


class SkPipeline:
    def __init__(self, name, regressor, onehot=True):
        self.name = name
        enc = OneHotEncoder(handle_unknown="ignore", drop=None)
        steps = [("enc", ColumnTransformer([("cat", enc, CATEGORICAL)]))] if onehot else []
        self.pipe = Pipeline(steps + [("reg", regressor)])

    def fit(self, X, y, w):
        self.pipe.fit(X, y, reg__sample_weight=w)
        return self

    def predict(self, X):
        return np.clip(self.pipe.predict(X), 0.0, 1.0)


class GradientBoosting:
    """Boosted trees; features passed as pandas categoricals, which the model handles natively."""
    name = "gradient boosting"

    def _cat(self, X):
        return pd.DataFrame({c: pd.Categorical(X[c], categories=self.cats[c]) for c in CATEGORICAL})

    def fit(self, X, y, w):
        self.cats = {c: sorted(X[c].unique()) for c in CATEGORICAL}
        self.model = HistGradientBoostingRegressor(max_iter=200, learning_rate=0.05,
                                                   categorical_features="from_dtype", random_state=0)
        self.model.fit(self._cat(X), y, sample_weight=w)
        return self

    def predict(self, X):
        return np.clip(self.model.predict(self._cat(X)), 0.0, 1.0)


def candidate_models():
    return [AssumeAllPresent(), MeanByType(),
            SkPipeline("linear regression (ridge)", Ridge(alpha=1.0)),
            GradientBoosting()]


# ---------------------------------------------------------------- evaluation
def _metrics(df: pd.DataFrame, pred_rate: np.ndarray) -> dict:
    reg = df["registered"].to_numpy()
    actual = df["present"].to_numpy()
    pred = pred_rate * reg
    sess = pd.DataFrame({"k": df["exam_date"] + " " + df["session"], "a": actual, "p": pred})
    s = sess.groupby("k").sum()
    return dict(
        mae_students_per_group=round(float(np.mean(np.abs(pred - actual))), 2),
        mae_rate_points=round(float(np.average(np.abs(pred_rate - actual / reg), weights=reg)) * 100, 2),
        session_mape_pct=round(float(np.mean(np.abs(s.p - s.a) / s.a)) * 100, 2),
        session_worst_under_pct=round(float(max(0.0, ((s.a - s.p) / s.p).max())) * 100, 2),
        seats_booked_vs_actual_pct=round(float(pred.sum() / actual.sum() - 1) * 100, 2),
    )


def learned_effects(history: pd.DataFrame) -> dict:
    """Plain linear regression with one baseline per feature, so each coefficient
    reads as "attendance points vs. the baseline" - comparable to the hidden rule."""
    X = features(history)
    y = (history["present"] / history["registered"]).to_numpy()
    w = history["registered"].to_numpy()
    base = {"reg_type": "REGULAR", "session": "FN", "weekday": "Tuesday", "year": "2", "gap": "2"}
    cols = list(base)  # branch has no true effect, so it is left out of this explanatory fit
    enc = OneHotEncoder(drop=[base[c] for c in cols], sparse_output=False)
    model = LinearRegression().fit(enc.fit_transform(X[cols]), y, sample_weight=w)
    coef = dict(zip(enc.get_feature_names_out(cols), model.coef_ * 100))
    pick = lambda k: round(float(coef.get(k, 0.0)), 2)
    truth = {"backlog vs regular": -26.5, "AN vs FN": -1.5, "Monday": -1.0, "Friday": -0.5,
             "Saturday": -3.0, "year 1": 1.0, "year 4": -1.5, "1 day since last exam": -1.0,
             "3+ days since last exam": 0.5, "first exam of cycle": -0.5}
    learned = {"backlog vs regular": pick("reg_type_BACKLOG"), "AN vs FN": pick("session_AN"),
               "Monday": pick("weekday_Monday"), "Friday": pick("weekday_Friday"),
               "Saturday": pick("weekday_Saturday"), "year 1": pick("year_1"), "year 4": pick("year_4"),
               "1 day since last exam": pick("gap_1"), "3+ days since last exam": pick("gap_3+"),
               "first exam of cycle": pick("gap_first")}
    return {k: {"hidden_rule": truth[k], "learned": learned[k]} for k in truth}


@dataclass
class TrainedTurnout:
    model: object
    model_name: str
    margin: float          # extra share of expected seats, from the backtest
    backtest: dict         # model name -> metrics on the held-out cycle
    test_cycle: str
    effects: dict

    def predict_rate(self, df: pd.DataFrame) -> np.ndarray:
        return self.model.predict(features(df))


def train(history: pd.DataFrame) -> TrainedTurnout:
    cycles = sorted(history["cycle"].unique(), key=lambda c: c.split("-")[1])
    test_cycle = cycles[-1]
    train_df = history[history["cycle"] != test_cycle]
    test_df = history[history["cycle"] == test_cycle]

    def fit(m, df):
        return m.fit(features(df), (df["present"] / df["registered"]).to_numpy(), df["registered"].to_numpy())

    backtest, scores = {}, {}
    for m in candidate_models():
        fit(m, train_df)
        backtest[m.name] = _metrics(test_df, m.predict(features(test_df)))
        scores[m.name] = backtest[m.name]["mae_rate_points"]
    learned = [n for n in scores if n not in (AssumeAllPresent.name, MeanByType.name)]
    best_name = min(learned, key=scores.get)
    margin = backtest[best_name]["session_worst_under_pct"] / 100

    final = next(m for m in candidate_models() if m.name == best_name)
    fit(final, history)  # refit on every cycle for real use
    return TrainedTurnout(model=final, model_name=best_name, margin=margin, backtest=backtest,
                          test_cycle=test_cycle, effects=learned_effects(history))


# ---------------------------------------------------------------- applying to a timetable
def student_papers(timetable: list[dict], registrations: list[dict], students: list[dict]) -> pd.DataFrame:
    """One row per student-paper with the model's features, from a finished timetable."""
    slot = {r["subject_code"]: (date.fromisoformat(r["exam_date"]), r["session"]) for r in timetable}
    subject_year = {r["subject_code"]: r.get("year") for r in timetable}
    info = {s["roll_no"]: s for s in students}
    by_student = defaultdict(list)
    for r in registrations:
        if r["subject_code"] in slot:
            by_student[r["roll_no"]].append(r)
    rows = []
    for roll, regs in by_student.items():
        s = info.get(roll, {})
        regs.sort(key=lambda r: slot[r["subject_code"]])
        prev = None
        for i, r in enumerate(regs):
            d, session = slot[r["subject_code"]]
            gap = 0 if prev is None else (d - prev).days
            reg_type = r.get("reg_type", "REGULAR")
            # backlog papers are described by the subject's year, matching the history
            year = subject_year.get(r["subject_code"]) if reg_type == "BACKLOG" else s.get("year")
            rows.append(dict(roll_no=roll, subject_code=r["subject_code"], exam_date=d.isoformat(),
                             session=session, weekday=d.strftime("%A"), reg_type=reg_type,
                             year=year or s.get("year", 1), branch=s.get("branch", ""), gap_days=gap))
            prev = d
    return pd.DataFrame(rows)


def plan_rooms(seats_needed: int, rooms: list[dict]) -> tuple[int, int]:
    """Rooms (largest first) and invigilators (1 per 30 seated, at least 1 per room) for a session."""
    usable = sorted((int(r["capacity"]) for r in rooms if str(r.get("exam_usable", "yes")) == "yes"), reverse=True)
    n_rooms = invig = 0
    left = seats_needed
    for cap in usable:
        if left <= 0:
            break
        seated = min(cap, left)
        n_rooms += 1
        invig += max(1, math.ceil(seated / 30))
        left -= seated
    return n_rooms, invig


def forecast(trained: TrainedTurnout, timetable: list[dict], registrations: list[dict],
             students: list[dict], rooms: list[dict]) -> dict:
    sp = student_papers(timetable, registrations, students)
    sp["p"] = trained.predict_rate(sp)
    sp["var"] = sp["p"] * (1 - sp["p"])

    subj = sp.groupby(["exam_date", "session", "subject_code"]).agg(
        registered=("roll_no", "size"), expected=("p", "sum")).reset_index()
    subj["expected"] = subj["expected"].round(1)

    sessions = []
    for (d, s), g in sp.groupby(["exam_date", "session"]):
        registered = len(g)
        expected = float(g["p"].sum())
        booked = min(registered, math.ceil(expected * (1 + trained.margin) + 3 * math.sqrt(float(g["var"].sum()))))
        rooms_all, invig_all = plan_rooms(registered, rooms)
        rooms_booked, invig_booked = plan_rooms(booked, rooms)
        sessions.append(dict(exam_date=d, session=s, registered=registered, expected=round(expected, 1),
                             seats_booked=booked, rooms_if_all_attend=rooms_all, rooms_booked=rooms_booked,
                             invigilators_if_all_attend=invig_all, invigilators_booked=invig_booked))
    tot = lambda k: sum(x[k] for x in sessions)
    pct = lambda a, b: round(100 * (1 - tot(b) / tot(a)), 1) if tot(a) else 0.0
    summary = dict(
        model=trained.model_name, safety_margin_pct=round(trained.margin * 100, 2),
        papers_registered=tot("registered"), expected_present=round(tot("expected")),
        seats_booked=tot("seats_booked"), seats_saved_pct=pct("registered", "seats_booked"),
        room_sessions_if_all_attend=tot("rooms_if_all_attend"), room_sessions_booked=tot("rooms_booked"),
        room_sessions_saved_pct=pct("rooms_if_all_attend", "rooms_booked"),
        invigilator_duties_if_all_attend=tot("invigilators_if_all_attend"),
        invigilator_duties_booked=tot("invigilators_booked"),
        invigilator_duties_saved_pct=pct("invigilators_if_all_attend", "invigilators_booked"),
    )
    papers = sp[["roll_no", "subject_code", "exam_date", "session", "p"]].rename(columns={"p": "attend_prob"})
    papers["attend_prob"] = papers["attend_prob"].round(4)
    return dict(summary=summary, sessions=sessions, subjects=subj.to_dict(orient="records"),
                papers=papers.to_dict(orient="records"))
