package com.examgrid.solver.web;

import com.examgrid.solver.seating.Room;
import com.examgrid.solver.seating.SeatingService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.List;
import java.util.Map;

/** REST API used by the Node backend to (re)seat a single session. */
@RestController
public class SolverController {

    public record RoomDto(String room_id, String block, int floor, int rows, int cols) {
    }

    public record StudentDto(String roll_no, String subject_code, String branch, boolean needs_ground_floor) {
    }

    public record SeatingRequest(List<RoomDto> rooms, List<StudentDto> students, Integer seconds) {
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok", "service", "examgrid-solver");
    }

    @PostMapping("/seating")
    public SeatingService.Result seating(@RequestBody SeatingRequest req) {
        int seconds = req.seconds() == null ? 8 : Math.min(60, req.seconds());
        List<Room> rooms = req.rooms().stream()
                .map(r -> new Room(r.room_id(), r.block(), r.floor(), r.rows(), r.cols())).toList();
        List<SeatingService.StudentPaper> students = req.students().stream()
                .map(s -> new SeatingService.StudentPaper(s.roll_no(), s.subject_code(), s.branch(), s.needs_ground_floor()))
                .toList();
        return new SeatingService(Duration.ofSeconds(seconds), Duration.ofSeconds(Math.max(2, seconds / 3)))
                .seat(students, rooms);
    }
}
