"""The conflict graph: one node per subject, an edge wherever a student writes both.

Two subjects joined by an edge must not be held on the same day, since a student
may write at most one exam per day. Edge weight = number of shared students.
"""
from __future__ import annotations

from itertools import combinations

import networkx as nx

from .data import ExamInput


def build_conflict_graph(inp: ExamInput) -> nx.Graph:
    """Edge attrs: weight = shared students, regular = shared students writing both as REGULAR."""
    g = nx.Graph()
    for code, rolls in inp.students_of.items():
        g.add_node(code, students=len(rolls))
    for papers in inp.papers_of.values():
        for a, b in combinations(sorted(papers), 2):
            if g.has_edge(a, b):
                g[a][b]["weight"] += 1
            else:
                g.add_edge(a, b, weight=1, regular=0)
    for papers in inp.regular_papers_of.values():
        for a, b in combinations(sorted(papers), 2):
            g[a][b]["regular"] += 1
    return g


def graph_stats(g: nx.Graph) -> dict:
    degrees = [d for _, d in g.degree()]
    return dict(
        subjects=g.number_of_nodes(),
        conflict_edges=g.number_of_edges(),
        max_degree=max(degrees, default=0),
        avg_degree=round(sum(degrees) / len(degrees), 2) if degrees else 0,
        density=round(nx.density(g), 4),
        # Any clique must use distinct days, so its size is a lower bound on days needed.
        largest_clique_found=max((len(c) for c in nx.find_cliques(g)), default=0),
    )
