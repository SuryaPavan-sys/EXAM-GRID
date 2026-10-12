package com.examgrid.solver;

import com.examgrid.solver.duty.Duty;
import com.examgrid.solver.duty.DutyService;
import com.examgrid.solver.duty.Faculty;
import com.examgrid.solver.seating.BranchPair;
import com.examgrid.solver.seating.Room;
import com.examgrid.solver.seating.RoomHalf;
import com.examgrid.solver.seating.SeatBlock;
import com.examgrid.solver.seating.SeatingConstraints;
import com.examgrid.solver.seating.SeatingPlan;
import com.examgrid.solver.seating.SeatingService;
import com.examgrid.solver.seating.SeatingService.StudentPaper;
import ai.timefold.solver.core.api.score.buildin.hardsoft.HardSoftScore;
import ai.timefold.solver.core.api.solver.SolutionManager;
import ai.timefold.solver.core.api.solver.SolverFactory;
import ai.timefold.solver.core.config.solver.SolverConfig;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SeatingServiceTest {

    private final SeatingService seating = new SeatingService(Duration.ofSeconds(3), Duration.ofSeconds(1));

    @Test
    void sameSubjectStudentsAreNeverNeighbours() {
        List<StudentPaper> students = new ArrayList<>();
        for (int i = 0; i < 30; i++) students.add(new StudentPaper("A" + i, "MATHS", "CSE", false));
        for (int i = 0; i < 30; i++) students.add(new StudentPaper("B" + i, "PHYSICS", "ECE", false));
        List<Room> rooms = List.of(new Room("R1", "Main", 1, 6, 10), new Room("R2", "Main", 1, 6, 10));

        SeatingService.Result r = seating.seat(students, rooms);

        assertTrue(r.feasible(), r.score());
        assertEquals(0, r.checks().get("same_subject_neighbours"));
        assertEquals(60, r.checks().get("seated"));
        assertEquals(1, r.checks().get("rooms_opened"), "two subjects of 30 fill one 60-seat room exactly");
    }

    @Test
    void groundFloorStudentsStayDownstairs() {
        List<StudentPaper> students = new ArrayList<>();
        for (int i = 0; i < 20; i++) students.add(new StudentPaper("S" + i, "CHEM", "MECH", i < 3));
        List<Room> rooms = List.of(new Room("UP", "Main", 2, 6, 6), new Room("DOWN", "Main", 0, 6, 6));

        SeatingService.Result r = seating.seat(students, rooms);

        assertEquals(0L, r.checks().get("ground_floor_violations"));
        assertTrue(r.seats().stream().filter(s -> s.roll().matches("S[012]")).allMatch(s -> s.floor() == 0));
    }

    @Test
    void pairedBranchesShareRooms() {
        // Four papers of 30 fill two 60-seat rooms exactly; without a pair any two papers may share.
        List<StudentPaper> students = new ArrayList<>();
        String[][] papers = {{"MATHS", "CSE"}, {"PHYSICS", "ECE"}, {"CHEM", "MECH"}, {"BIO", "CIVIL"}};
        for (String[] p : papers) {
            for (int i = 0; i < 30; i++) students.add(new StudentPaper(p[1] + i, p[0], p[1], false));
        }
        List<Room> rooms = List.of(new Room("R1", "Main", 1, 6, 10), new Room("R2", "Main", 1, 6, 10));

        SeatingService.Result r = seating.seat(students, rooms, BranchPair.fromLists(List.of(List.of("ECE", "CSE"))));

        assertEquals(Boolean.TRUE, r.checks().get("ok"), r.checks().toString());
        assertEquals(0, r.checks().get("same_subject_neighbours"));
        Map<String, Set<String>> branchesByRoom = new HashMap<>();
        r.seats().forEach(s -> branchesByRoom.computeIfAbsent(s.roomId(), k -> new HashSet<>()).add(s.branch()));
        assertTrue(branchesByRoom.values().stream().anyMatch(b -> b.containsAll(Set.of("CSE", "ECE"))), branchesByRoom.toString());
        assertEquals(Map.of("CSE+ECE", Map.of("shared_rooms", 1, "one_branch_only_rooms", 0)),
                SeatingService.pairStats(r.seats(), BranchPair.fromLists(List.of(List.of("CSE", "ECE")))));
    }

    @Test
    void branchPairIsSoftAndOnlyScoresRoomsMissingThePartner() {
        Room r1 = new Room("R1", "Main", 1, 6, 10), r2 = new Room("R2", "Main", 1, 6, 10);
        RoomHalf r1w = new RoomHalf(r1, 0), r1b = new RoomHalf(r1, 1), r2w = new RoomHalf(r2, 0), r2b = new RoomHalf(r2, 1);
        SeatBlock cse = new SeatBlock("B0", "MATHS", "CSE", List.of("C1"), false);
        SeatBlock ece = new SeatBlock("B1", "PHYSICS", "ECE", List.of("E1"), false);
        SeatBlock mech = new SeatBlock("B2", "CHEM", "MECH", List.of("M1"), false);
        SeatBlock civil = new SeatBlock("B3", "BIO", "CIVIL", List.of("V1"), false);
        List<BranchPair> pair = BranchPair.fromLists(List.of(List.of("CSE", "ECE")));

        // CSE with ECE, MECH with CIVIL: nothing to penalise.
        cse.setHalf(r1w); ece.setHalf(r1b); mech.setHalf(r2w); civil.setHalf(r2b);
        HardSoftScore together = score(new SeatingPlan(List.of(r1w, r1b, r2w, r2b), List.of(cse, ece, mech, civil), pair));
        // CSE with MECH, ECE with CIVIL: two rooms each hold one branch of the pair.
        ece.setHalf(r2w); mech.setHalf(r1b);
        HardSoftScore apart = score(new SeatingPlan(List.of(r1w, r1b, r2w, r2b), List.of(cse, ece, mech, civil), pair));

        assertEquals(0, together.hardScore());
        assertEquals(0, apart.hardScore(), "pairing never touches the hard rules");
        assertEquals(60, together.softScore() - apart.softScore());
    }

    private static HardSoftScore score(SeatingPlan plan) {
        SolverFactory<SeatingPlan> factory = SolverFactory.create(new SolverConfig()
                .withSolutionClass(SeatingPlan.class)
                .withEntityClasses(SeatBlock.class)
                .withConstraintProviderClass(SeatingConstraints.class));
        return SolutionManager.<SeatingPlan, HardSoftScore>create(factory).update(plan);
    }

    @Test
    void invigilatorsAvoidOwnSubjectAndLeave() {
        Faculty teacher = new Faculty("F1", "Teacher", "CSE", "Assistant Professor", 10, Set.of("MATHS"), Set.of());
        Faculty onLeave = new Faculty("F2", "Away", "ECE", "Assistant Professor", 10, Set.of(), Set.of("2026-11-16 FN"));
        Faculty free = new Faculty("F3", "Free", "EEE", "Assistant Professor", 10, Set.of(), Set.of());
        Duty duty = new Duty("D1", "2026-11-16", "FN", "R1", Set.of("MATHS"), 30, 28.5);

        DutyService.Result r = new DutyService(Duration.ofSeconds(2), Duration.ofSeconds(1))
                .assign(List.of(teacher, onLeave, free), List.of(duty));

        assertEquals("F3", r.duties().get(0).getFaculty().id());
        assertEquals(Boolean.TRUE, r.checks().get("ok"));
    }
}
