package com.examgrid.solver;

import com.examgrid.solver.duty.Duty;
import com.examgrid.solver.duty.DutyService;
import com.examgrid.solver.duty.Faculty;
import com.examgrid.solver.seating.Room;
import com.examgrid.solver.seating.SeatingService;
import com.examgrid.solver.seating.SeatingService.StudentPaper;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
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
