package com.examgrid.solver.duty;

import ai.timefold.solver.core.api.domain.solution.PlanningEntityCollectionProperty;
import ai.timefold.solver.core.api.domain.solution.PlanningScore;
import ai.timefold.solver.core.api.domain.solution.PlanningSolution;
import ai.timefold.solver.core.api.domain.solution.ProblemFactCollectionProperty;
import ai.timefold.solver.core.api.domain.valuerange.ValueRangeProvider;
import ai.timefold.solver.core.api.score.buildin.hardsoft.HardSoftScore;

import java.util.List;

/** The invigilation problem for a whole exam cycle. */
@PlanningSolution
public class DutyRoster {

    @ProblemFactCollectionProperty
    @ValueRangeProvider
    private List<Faculty> faculty;

    @PlanningEntityCollectionProperty
    private List<Duty> duties;

    @PlanningScore
    private HardSoftScore score;

    public DutyRoster() {
    }

    public DutyRoster(List<Faculty> faculty, List<Duty> duties) {
        this.faculty = faculty;
        this.duties = duties;
    }

    public List<Faculty> getFaculty() {
        return faculty;
    }

    public List<Duty> getDuties() {
        return duties;
    }

    public HardSoftScore getScore() {
        return score;
    }

    public void setScore(HardSoftScore score) {
        this.score = score;
    }
}
