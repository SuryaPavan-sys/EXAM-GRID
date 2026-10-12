"""Third pass: move single subjects between sessions to give students more breathing room.

DSatur groups mix many branches, so after placement nearly every day carries
papers for nearly everyone. Here each subject may move on its own to any of
the window's sessions, as long as every hard rule still holds:

    * no shared student already in the target session      (no clash)
    * no shared *regular* student on the target day         (one exam a day)
    * the target session still has seats for this subject

A move is kept only if it lowers the same pair cost the placement step uses
(back-to-back days, two days apart, backlog FN+AN days). Each move is scored from
the moved subject's neighbours alone, so a full sweep over SRKR's 280 subjects
x 36 sessions takes a fraction of a second.
"""
from __future__ import annotations

import random
from collections import defaultdict
from datetime import date

import networkx as nx

from .spread import BACKLOG_SAME_DAY, GAP_COST


def refine(slot_of: dict[str, tuple[int, int]], g: nx.Graph, size: dict[str, int],
           dates: list[date], n_sessions: int, seats: int,
           backlog_same_day: int = BACKLOG_SAME_DAY, allow_backlog_same_day: bool = True,
           seed: int = 0, max_sweeps: int = 50) -> tuple[dict, int, int]:
    """Improve `slot_of` (subject -> (date index, session index)) in place.

    Returns (slot_of, cost before, cost after).
    """
    rng = random.Random(seed)
    load: dict[tuple[int, int], int] = defaultdict(int)
    for s, slot in slot_of.items():
        load[slot] += size[s]
    all_slots = [(d, k) for d in range(len(dates)) for k in range(n_sessions)]

    def reg(a, b):
        return g[a][b]["regular"]

    def pair(a, b, slot_a, slot_b):
        shared = g[a][b]["weight"]
        gap = abs((dates[slot_a[0]] - dates[slot_b[0]]).days)
        if gap == 0:
            return (shared - reg(a, b)) * backlog_same_day   # regular same day never happens here
        return shared * GAP_COST.get(gap, 0)

    def cost_of(s, slot):
        return sum(pair(s, t, slot, slot_of[t]) for t in g[s])

    def allowed(s, slot):
        if load[slot] + size[s] > seats:
            return False
        for t in g[s]:
            other = slot_of[t]
            if other == slot:
                return False
            if other[0] == slot[0] and (reg(s, t) or not allow_backlog_same_day):
                return False
        return True

    total = lambda: sum(pair(a, b, slot_of[a], slot_of[b]) for a, b in g.edges)
    before = total()
    subjects = sorted(slot_of)
    for _ in range(max_sweeps):
        moved = False
        rng.shuffle(subjects)
        for s in subjects:
            here = slot_of[s]
            current = cost_of(s, here)
            load[here] -= size[s]
            best, best_cost = here, current
            for slot in all_slots:
                if slot != here and allowed(s, slot):
                    c = cost_of(s, slot)
                    if c < best_cost:
                        best, best_cost = slot, c
            slot_of[s] = best
            load[best] += size[s]
            moved |= best != here
        if not moved:
            break
    return slot_of, before, total()
