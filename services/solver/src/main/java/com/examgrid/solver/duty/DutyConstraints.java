package com.examgrid.solver.duty;

import ai.timefold.solver.core.api.score.buildin.hardsoft.HardSoftScore;
import ai.timefold.solver.core.api.score.stream.Constraint;
import ai.timefold.solver.core.api.score.stream.ConstraintCollectors;
import ai.timefold.solver.core.api.score.stream.ConstraintFactory;
import ai.timefold.solver.core.api.score.stream.ConstraintProvider;
import ai.timefold.solver.core.api.score.stream.Joiners;

/**
 * Hard: nobody invigilates their own subject, nobody is in two rooms at once, nobody works
 * while on leave, nobody exceeds their designation's duty cap.
 * Soft: spread duties fairly (relative to each person's cap) and avoid two duties in one day.
 */
public class DutyConstraints implements ConstraintProvider {

    @Override
    public Constraint[] defineConstraints(ConstraintFactory f) {
        return new Constraint[]{
                ownSubject(f),
                doubleBooked(f),
                onLeave(f),
                overMaxDuties(f),
                fairLoad(f),
                twoDutiesSameDay(f),
        };
    }

    Constraint ownSubject(ConstraintFactory f) {
        return f.forEach(Duty.class)
                .filter(d -> d.getFaculty().teachesAny(d.getRoomSubjects()))
                .penalize(HardSoftScore.ONE_HARD)
                .asConstraint("Invigilating own subject");
    }

    Constraint doubleBooked(ConstraintFactory f) {
        return f.forEachUniquePair(Duty.class,
                        Joiners.equal(Duty::getFaculty),
                        Joiners.equal(Duty::getSessionKey))
                .penalize(HardSoftScore.ONE_HARD)
                .asConstraint("Two rooms in one session");
    }

    Constraint onLeave(ConstraintFactory f) {
        return f.forEach(Duty.class)
                .filter(d -> d.getFaculty().onLeave(d.getSessionKey()))
                .penalize(HardSoftScore.ONE_HARD)
                .asConstraint("Duty while on leave");
    }

    Constraint overMaxDuties(ConstraintFactory f) {
        return f.forEach(Duty.class)
                .groupBy(Duty::getFaculty, ConstraintCollectors.count())
                .filter((fac, n) -> n > fac.maxDuties())
                .penalize(HardSoftScore.ONE_HARD, (fac, n) -> n - fac.maxDuties())
                .asConstraint("More duties than allowed");
    }

    /** Sum of squared load (duties / cap): grows fastest for the busiest people, so it evens loads out. */
    Constraint fairLoad(ConstraintFactory f) {
        return f.forEach(Duty.class)
                .groupBy(Duty::getFaculty, ConstraintCollectors.count())
                .penalize(HardSoftScore.ONE_SOFT, (fac, n) -> (int) Math.round(100.0 * n * n / fac.maxDuties()))
                .asConstraint("Fair duty load");
    }

    Constraint twoDutiesSameDay(ConstraintFactory f) {
        return f.forEachUniquePair(Duty.class,
                        Joiners.equal(Duty::getFaculty),
                        Joiners.equal(Duty::getDate))
                .penalize(HardSoftScore.ofSoft(30))
                .asConstraint("Two duties in one day");
    }
}
