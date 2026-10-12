package com.examgrid.solver.seating;

import ai.timefold.solver.core.api.domain.entity.PlanningEntity;
import ai.timefold.solver.core.api.domain.lookup.PlanningId;
import ai.timefold.solver.core.api.domain.variable.PlanningVariable;

import java.util.List;

/**
 * A few students writing the same paper (same subject, usually same branch), seated together.
 * Timefold decides which {@link RoomHalf} each block goes to. Students who need the ground
 * floor get a block of their own, so they can be placed independently.
 */
@PlanningEntity
public class SeatBlock {

    @PlanningId
    private String id;
    private String subject;
    private String branch;
    private List<String> rolls;
    private boolean needsGroundFloor;

    @PlanningVariable
    private RoomHalf half;

    public SeatBlock() {
    }

    public SeatBlock(String id, String subject, String branch, List<String> rolls, boolean needsGroundFloor) {
        this.id = id;
        this.subject = subject;
        this.branch = branch;
        this.rolls = rolls;
        this.needsGroundFloor = needsGroundFloor;
    }

    public String getId() {
        return id;
    }

    public String getSubject() {
        return subject;
    }

    public String getBranch() {
        return branch;
    }

    public List<String> getRolls() {
        return rolls;
    }

    public int getSize() {
        return rolls.size();
    }

    public boolean isNeedsGroundFloor() {
        return needsGroundFloor;
    }

    public RoomHalf getHalf() {
        return half;
    }

    public void setHalf(RoomHalf half) {
        this.half = half;
    }

    public String getRoomId() {
        return half == null ? null : half.getRoom().id();
    }

    public String getBuilding() {
        return half == null ? null : half.getRoom().block();
    }

    @Override
    public String toString() {
        return id + "->" + half;
    }
}
