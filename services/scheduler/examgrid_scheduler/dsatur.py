"""DSatur graph colouring with a seat-capacity limit.

Colour = one exam session (later placed on a date, FN or AN). Classic DSatur
(Brelaz, 1979):
  1. pick the uncoloured node whose neighbours already use the most distinct
     colours (highest *saturation*); break ties by degree, then by size;
  2. give it the lowest colour none of its neighbours uses.

Extra rule for exams: one session seats at most `seats` students, so a colour
is only reused if the subject still fits; otherwise the next colour is tried,
and a new one is opened if none fits.
"""
from __future__ import annotations

from dataclasses import dataclass

import networkx as nx


@dataclass
class Colouring:
    colour_of: dict[str, int]        # subject -> colour (session group)
    load: list[int]                  # students seated in each colour
    members: list[list[str]]         # subjects in each colour
    order: list[str]                 # order in which DSatur coloured the subjects
    too_big: list[str]               # subjects larger than one session's seats

    @property
    def n_colours(self) -> int:
        return len(self.load)


def dsatur(g: nx.Graph, seats: int) -> Colouring:
    size = {n: g.nodes[n].get("students", 0) for n in g}
    colour_of: dict[str, int] = {}
    load: list[int] = []
    members: list[list[str]] = []
    order: list[str] = []
    too_big = sorted(n for n in g if size[n] > seats)
    seen: dict[str, set[int]] = {n: set() for n in g}  # colours used by each node's neighbours

    uncoloured = set(g) - set(too_big)
    while uncoloured:
        # Highest saturation; ties -> more conflicts -> more students -> code (deterministic).
        node = max(uncoloured, key=lambda n: (len(seen[n]), g.degree(n), size[n], n))
        c = next((c for c in range(len(load))
                  if c not in seen[node] and load[c] + size[node] <= seats), None)
        if c is None:
            load.append(0)
            members.append([])
            c = len(load) - 1
        colour_of[node] = c
        load[c] += size[node]
        members[c].append(node)
        order.append(node)
        uncoloured.discard(node)
        for nb in g[node]:
            seen[nb].add(c)

    return Colouring(colour_of=colour_of, load=load, members=members, order=order, too_big=too_big)
