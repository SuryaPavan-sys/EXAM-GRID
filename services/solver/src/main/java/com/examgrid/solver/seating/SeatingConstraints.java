package com.examgrid.solver.seating;

import ai.timefold.solver.core.api.score.buildin.hardsoft.HardSoftScore;
import ai.timefold.solver.core.api.score.stream.Constraint;
import ai.timefold.solver.core.api.score.stream.ConstraintCollectors;
import ai.timefold.solver.core.api.score.stream.ConstraintFactory;
import ai.timefold.solver.core.api.score.stream.ConstraintProvider;
import ai.timefold.solver.core.api.score.stream.Joiners;

/**
 * Hard rules (must hold):
 * <ul>
 *   <li>a room half never holds more students than it has seats;</li>
 *   <li>a subject never uses both halves of one room - that is what keeps same-paper
 *       students from sitting next to each other;</li>
 *   <li>students who need the ground floor are seated on it.</li>
 * </ul>
 * Soft goals (as good as possible): open few rooms, keep each subject in few rooms and few
 * buildings (easier question-paper distribution), and keep each branch's students together.
 */
public class SeatingConstraints implements ConstraintProvider {

    @Override
    public Constraint[] defineConstraints(ConstraintFactory f) {
        return new Constraint[]{
                halfCapacity(f),
                subjectUsesBothHalvesOfRoom(f),
                groundFloorNeeded(f),
                roomsOpened(f),
                subjectSpreadOverRooms(f),
                subjectSpreadOverBuildings(f),
                branchSpreadOverRooms(f),
        };
    }

    Constraint halfCapacity(ConstraintFactory f) {
        return f.forEach(SeatBlock.class)
                .groupBy(SeatBlock::getHalf, ConstraintCollectors.sum(SeatBlock::getSize))
                .filter((half, seated) -> seated > half.getCapacity())
                .penalize(HardSoftScore.ONE_HARD, (half, seated) -> seated - half.getCapacity())
                .asConstraint("Room half over capacity");
    }

    Constraint subjectUsesBothHalvesOfRoom(ConstraintFactory f) {
        return f.forEachUniquePair(SeatBlock.class,
                        Joiners.equal(SeatBlock::getSubject),
                        Joiners.equal(SeatBlock::getRoomId))
                .filter((a, b) -> a.getHalf() != b.getHalf())
                .penalize(HardSoftScore.ONE_HARD, (a, b) -> Math.min(a.getSize(), b.getSize()))
                .asConstraint("Same subject on both colours of a room");
    }

    Constraint groundFloorNeeded(ConstraintFactory f) {
        return f.forEach(SeatBlock.class)
                .filter(b -> b.isNeedsGroundFloor() && !b.getHalf().getRoom().groundFloor())
                .penalize(HardSoftScore.ONE_HARD, SeatBlock::getSize)
                .asConstraint("Ground-floor student seated upstairs");
    }

    Constraint roomsOpened(ConstraintFactory f) {
        return f.forEach(SeatBlock.class)
                .groupBy(SeatBlock::getRoomId)
                .penalize(HardSoftScore.ofSoft(100))
                .asConstraint("Rooms opened");
    }

    Constraint subjectSpreadOverRooms(ConstraintFactory f) {
        return f.forEach(SeatBlock.class)
                .groupBy(SeatBlock::getSubject, ConstraintCollectors.countDistinct(SeatBlock::getRoomId))
                .filter((subject, rooms) -> rooms > 1)
                .penalize(HardSoftScore.ofSoft(10), (subject, rooms) -> rooms - 1)
                .asConstraint("Subject split over rooms");
    }

    Constraint subjectSpreadOverBuildings(ConstraintFactory f) {
        return f.forEach(SeatBlock.class)
                .groupBy(SeatBlock::getSubject, ConstraintCollectors.countDistinct(SeatBlock::getBuilding))
                .filter((subject, buildings) -> buildings > 1)
                .penalize(HardSoftScore.ofSoft(20), (subject, buildings) -> buildings - 1)
                .asConstraint("Subject split over buildings");
    }

    Constraint branchSpreadOverRooms(ConstraintFactory f) {
        return f.forEach(SeatBlock.class)
                .groupBy(SeatBlock::getBranch, ConstraintCollectors.countDistinct(SeatBlock::getRoomId))
                .filter((branch, rooms) -> rooms > 1)
                .penalize(HardSoftScore.ofSoft(1), (branch, rooms) -> rooms - 1)
                .asConstraint("Branch split over rooms");
    }
}
