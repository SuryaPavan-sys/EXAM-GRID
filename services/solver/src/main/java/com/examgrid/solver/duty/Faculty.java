package com.examgrid.solver.duty;

import java.util.Set;

/**
 * A faculty member who can invigilate.
 *
 * @param teaches subjects they teach (they must not invigilate those exams)
 * @param leave   "2026-11-18 FN" style keys for sessions they are away
 */
public record Faculty(String id, String name, String department, String designation, int maxDuties,
                      Set<String> teaches, Set<String> leave) {

    public boolean teachesAny(Set<String> subjects) {
        for (String s : subjects) {
            if (teaches.contains(s)) {
                return true;
            }
        }
        return false;
    }

    public boolean onLeave(String sessionKey) {
        return leave.contains(sessionKey);
    }

    @Override
    public String toString() {
        return id;
    }
}
