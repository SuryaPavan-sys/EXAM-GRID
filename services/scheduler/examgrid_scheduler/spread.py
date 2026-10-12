"""Second pass: place DSatur's session groups on (date, session) slots.

Any placement is clash-free within a session, so here we choose the one that is
kindest to students. For every pair of groups we know how many students write
in both, and how many of those are *regular* in both. The cost of a placement:

    regular student, same day        100000 (hard rule: forbidden)
    backlog student, same day            50 (allowed, but avoided)
    exams on consecutive days             3
    exams two days apart                  1

Local search - swap two groups, or move a group to a free slot - with a few
seeded restarts. Each move is scored incrementally (only the moved groups'
pairs are recomputed), so the full SRKR data settles in a few seconds.
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date
from itertools import combinations

REGULAR_SAME_DAY = 100_000
BACKLOG_SAME_DAY = 50
GAP_COST = {1: 3, 2: 1}


@dataclass
class Overlap:
    all: list[list[int]]       # students writing in both groups
    regular: list[list[int]]   # students writing both groups as REGULAR papers


def overlaps(colour_of: dict[str, int], papers_of: dict[str, set[str]],
             regular_papers_of: dict[str, set[str]], n: int) -> Overlap:
    def count(by_student):
        w = [[0] * n for _ in range(n)]
        for papers in by_student.values():
            groups = sorted({colour_of[p] for p in papers if p in colour_of})
            for a, b in combinations(groups, 2):
                w[a][b] += 1
                w[b][a] += 1
        return w
    return Overlap(all=count(papers_of), regular=count(regular_papers_of))


def pair_cost(a: int, b: int, slot_a: tuple[int, int], slot_b: tuple[int, int],
              dates: list[date], ov: Overlap, backlog_same_day: int) -> int:
    shared = ov.all[a][b]
    if not shared:
        return 0
    gap = abs((dates[slot_a[0]] - dates[slot_b[0]]).days)
    if gap == 0:
        regular = ov.regular[a][b]
        return regular * REGULAR_SAME_DAY + (shared - regular) * backlog_same_day
    return shared * GAP_COST.get(gap, 0)


class Placement:
    def __init__(self, slots: list[tuple[int, int]], dates, ov: Overlap, backlog_same_day: int):
        self.slots, self.dates, self.ov, self.bsd = slots, dates, ov, backlog_same_day

    def contrib(self, a: int, slot_a, skip: int = -1) -> int:
        total = 0
        for b, slot_b in enumerate(self.slots):
            if b != a and b != skip:
                total += pair_cost(a, b, slot_a, slot_b, self.dates, self.ov, self.bsd)
        return total

    def total(self) -> int:
        return sum(pair_cost(a, b, self.slots[a], self.slots[b], self.dates, self.ov, self.bsd)
                   for a, b in combinations(range(len(self.slots)), 2))


def assign_slots(n_groups: int, dates: list[date], n_sessions: int, ov: Overlap,
                 backlog_same_day: int = BACKLOG_SAME_DAY, seed: int = 0,
                 restarts: int = 6) -> tuple[list[tuple[int, int]], int]:
    """Return ((date index, session index) per group, cost). Needs n_groups <= slots."""
    all_slots = [(d, s) for d in range(len(dates)) for s in range(n_sessions)]
    if n_groups == 0:
        return [], 0
    rng = random.Random(seed)
    # Start: spread groups evenly over the days, one session each.
    step = len(dates) / n_groups
    start = []
    for i in range(n_groups):
        d = min(len(dates) - 1, int(i * step))
        s = 0
        while (d, s) in start:
            s += 1
            if s == n_sessions:
                d, s = (d + 1) % len(dates), 0
        start.append((d, s))

    best, best_cost = None, None
    for attempt in range(restarts):
        slots = start[:]
        if attempt:
            rng.shuffle(slots)
        p = Placement(slots, dates, ov, backlog_same_day)
        cost = p.total()
        improved = True
        while improved:
            improved = False
            used = set(slots)
            free = [s for s in all_slots if s not in used]
            moves = [("swap", a, b) for a, b in combinations(range(n_groups), 2)]
            moves += [("move", a, f) for a in range(n_groups) for f in range(len(free))]
            rng.shuffle(moves)
            for kind, a, b in moves:
                if kind == "swap":
                    sa, sb = slots[a], slots[b]
                    before = p.contrib(a, sa, skip=b) + p.contrib(b, sb, skip=a)
                    after = p.contrib(a, sb, skip=b) + p.contrib(b, sa, skip=a)
                    if after < before:
                        slots[a], slots[b] = sb, sa
                        cost += after - before
                        improved = True
                        break
                else:
                    target = free[b]
                    delta = p.contrib(a, target) - p.contrib(a, slots[a])
                    if delta < 0:
                        slots[a] = target
                        cost += delta
                        improved = True
                        break
        if best_cost is None or cost < best_cost:
            best, best_cost = slots[:], cost
    return best, best_cost
