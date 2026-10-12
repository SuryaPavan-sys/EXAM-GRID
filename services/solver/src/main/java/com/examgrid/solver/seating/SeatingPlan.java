package com.examgrid.solver.seating;

import ai.timefold.solver.core.api.domain.solution.PlanningEntityCollectionProperty;
import ai.timefold.solver.core.api.domain.solution.PlanningScore;
import ai.timefold.solver.core.api.domain.solution.PlanningSolution;
import ai.timefold.solver.core.api.domain.solution.ProblemFactCollectionProperty;
import ai.timefold.solver.core.api.domain.valuerange.ValueRangeProvider;
import ai.timefold.solver.core.api.score.buildin.hardsoft.HardSoftScore;

import java.util.List;

/** The seating problem for one exam session. */
@PlanningSolution
public class SeatingPlan {

    @ProblemFactCollectionProperty
    @ValueRangeProvider
    private List<RoomHalf> halves;

    @PlanningEntityCollectionProperty
    private List<SeatBlock> blocks;

    @PlanningScore
    private HardSoftScore score;

    public SeatingPlan() {
    }

    public SeatingPlan(List<RoomHalf> halves, List<SeatBlock> blocks) {
        this.halves = halves;
        this.blocks = blocks;
    }

    public List<RoomHalf> getHalves() {
        return halves;
    }

    public List<SeatBlock> getBlocks() {
        return blocks;
    }

    public HardSoftScore getScore() {
        return score;
    }

    public void setScore(HardSoftScore score) {
        this.score = score;
    }
}
