package com.examgrid.solver.seating;

import java.util.List;

/**
 * Two branches the exam cell wants seated in the same rooms (e.g. CSE and ECE), set in
 * exam_config.json "branch_pairs". A soft preference: it only matters in sessions where both
 * branches write a paper, and it never overrides a hard rule.
 */
public record BranchPair(String a, String b) {

    public boolean includes(String branch) {
        return a.equals(branch) || b.equals(branch);
    }

    /** Reads [["CSE","ECE"], ...]; skips malformed entries and pairs a branch with itself. */
    public static List<BranchPair> fromLists(List<List<String>> pairs) {
        if (pairs == null) {
            return List.of();
        }
        return pairs.stream()
                .filter(p -> p != null && p.size() == 2 && p.get(0) != null && p.get(1) != null
                        && !p.get(0).equals(p.get(1)))
                .map(p -> p.get(0).compareTo(p.get(1)) < 0 ? new BranchPair(p.get(0), p.get(1))
                        : new BranchPair(p.get(1), p.get(0)))
                .distinct()
                .toList();
    }

    @Override
    public String toString() {
        return a + "+" + b;
    }
}
