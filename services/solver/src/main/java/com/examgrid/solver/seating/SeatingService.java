package com.examgrid.solver.seating;

import ai.timefold.solver.core.api.score.buildin.hardsoft.HardSoftScore;
import ai.timefold.solver.core.api.solver.Solver;
import ai.timefold.solver.core.api.solver.SolverFactory;
import ai.timefold.solver.core.config.solver.SolverConfig;
import ai.timefold.solver.core.config.solver.termination.TerminationConfig;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** Seats every student of one exam session. */
public class SeatingService {

    /** Students per block. Small enough to pack rooms tightly, big enough to keep the search fast. */
    static final int BLOCK_SIZE = 6;

    public record StudentPaper(String roll, String subject, String branch, boolean needsGroundFloor) {
    }

    public record Seat(String roll, String subject, String branch, String roomId, String building, int floor,
                       int row, int col, int seatNo) {
    }

    public record Result(String score, boolean feasible, List<Seat> seats, Map<String, Object> checks) {
    }

    private final Duration spentLimit;
    private final Duration unimprovedLimit;

    public SeatingService(Duration spentLimit, Duration unimprovedLimit) {
        this.spentLimit = spentLimit;
        this.unimprovedLimit = unimprovedLimit;
    }

    public Result seat(List<StudentPaper> students, List<Room> rooms) {
        SeatingPlan problem = buildProblem(students, rooms);
        SolverConfig config = new SolverConfig()
                .withSolutionClass(SeatingPlan.class)
                .withEntityClasses(SeatBlock.class)
                .withConstraintProviderClass(SeatingConstraints.class)
                .withTerminationConfig(new TerminationConfig()
                        .withSpentLimit(spentLimit)
                        .withUnimprovedSpentLimit(unimprovedLimit));
        Solver<SeatingPlan> solver = SolverFactory.<SeatingPlan>create(config).buildSolver();
        SeatingPlan solved = solver.solve(problem);
        List<Seat> seats = arrange(solved);
        Map<String, Object> checks = check(seats, students, rooms);
        HardSoftScore score = solved.getScore();
        return new Result(score.toString(), score.isFeasible(), seats, checks);
    }

    static SeatingPlan buildProblem(List<StudentPaper> students, List<Room> rooms) {
        List<RoomHalf> halves = new ArrayList<>();
        for (Room r : rooms) {
            halves.add(new RoomHalf(r, 0));
            halves.add(new RoomHalf(r, 1));
        }
        // Group by subject + branch (+ ground-floor need), then cut into blocks.
        Map<String, List<StudentPaper>> groups = new TreeMap<>();
        for (StudentPaper s : students) {
            String key = s.subject() + "|" + s.branch() + "|" + (s.needsGroundFloor() ? "G" : "-");
            groups.computeIfAbsent(key, k -> new ArrayList<>()).add(s);
        }
        List<SeatBlock> blocks = new ArrayList<>();
        for (List<StudentPaper> g : groups.values()) {
            g.sort(Comparator.comparing(StudentPaper::roll));
            int size = g.get(0).needsGroundFloor() ? 1 : BLOCK_SIZE;
            for (int i = 0; i < g.size(); i += size) {
                List<StudentPaper> part = g.subList(i, Math.min(g.size(), i + size));
                StudentPaper first = part.get(0);
                blocks.add(new SeatBlock("B" + blocks.size(), first.subject(), first.branch(),
                        part.stream().map(StudentPaper::roll).toList(), first.needsGroundFloor()));
            }
        }
        return new SeatingPlan(halves, blocks);
    }

    /** Turn block -> room-half decisions into concrete seats, filling each colour row by row. */
    static List<Seat> arrange(SeatingPlan plan) {
        Map<RoomHalf, List<SeatBlock>> byHalf = new LinkedHashMap<>();
        for (SeatBlock b : plan.getBlocks()) {
            if (b.getHalf() != null) {
                byHalf.computeIfAbsent(b.getHalf(), h -> new ArrayList<>()).add(b);
            }
        }
        List<Seat> seats = new ArrayList<>();
        for (Map.Entry<RoomHalf, List<SeatBlock>> e : byHalf.entrySet()) {
            Room room = e.getKey().getRoom();
            int parity = e.getKey().getParity();
            List<int[]> cells = new ArrayList<>();
            for (int r = 0; r < room.rows(); r++) {
                for (int c = 0; c < room.cols(); c++) {
                    if ((r + c) % 2 == parity) {
                        cells.add(new int[]{r, c});
                    }
                }
            }
            List<SeatBlock> blocks = e.getValue();
            blocks.sort(Comparator.comparing(SeatBlock::getSubject).thenComparing(SeatBlock::getBranch)
                    .thenComparing(b -> b.getRolls().get(0)));
            int next = 0;
            for (SeatBlock b : blocks) {
                for (String roll : b.getRolls()) {
                    if (next >= cells.size()) {
                        break; // over capacity: left unseated, reported by check()
                    }
                    int[] cell = cells.get(next++);
                    seats.add(new Seat(roll, b.getSubject(), b.getBranch(), room.id(), room.block(), room.floor(),
                            cell[0] + 1, cell[1] + 1, cell[0] * room.cols() + cell[1] + 1));
                }
            }
        }
        seats.sort(Comparator.comparing(Seat::roomId).thenComparingInt(Seat::seatNo));
        return seats;
    }

    /** Independent checks, recomputed from the final seats - not from the solver's score. */
    public static Map<String, Object> check(List<Seat> seats, List<StudentPaper> students, List<Room> rooms) {
        Map<String, Room> roomById = new HashMap<>();
        rooms.forEach(r -> roomById.put(r.id(), r));
        Map<String, String[][]> grid = new HashMap<>();
        Map<String, Integer> seatedPerRoom = new TreeMap<>();
        int doubleBooked = 0;
        for (Seat s : seats) {
            Room r = roomById.get(s.roomId());
            String[][] g = grid.computeIfAbsent(r.id(), k -> new String[r.rows()][r.cols()]);
            if (g[s.row() - 1][s.col() - 1] != null) {
                doubleBooked++;
            }
            g[s.row() - 1][s.col() - 1] = s.subject();
            seatedPerRoom.merge(r.id(), 1, Integer::sum);
        }
        int sameSubjectNeighbours = 0;
        for (String[][] g : grid.values()) {
            for (int r = 0; r < g.length; r++) {
                for (int c = 0; c < g[r].length; c++) {
                    if (g[r][c] == null) {
                        continue;
                    }
                    if (c + 1 < g[r].length && g[r][c].equals(g[r][c + 1])) {
                        sameSubjectNeighbours++;   // left/right
                    }
                    if (r + 1 < g.length && g[r][c].equals(g[r + 1][c])) {
                        sameSubjectNeighbours++;   // front/back
                    }
                }
            }
        }
        Map<String, Boolean> needsGround = new HashMap<>();
        students.forEach(s -> needsGround.put(s.roll() + "|" + s.subject(), s.needsGroundFloor()));
        long groundViolations = seats.stream()
                .filter(s -> needsGround.getOrDefault(s.roll() + "|" + s.subject(), false) && s.floor() != 0).count();
        long groundStudents = students.stream().filter(StudentPaper::needsGroundFloor).count();
        int seatsInOpenedRooms = seatedPerRoom.keySet().stream().mapToInt(id -> roomById.get(id).capacity()).sum();

        Map<String, Object> checks = new LinkedHashMap<>();
        checks.put("students", students.size());
        checks.put("seated", seats.size());
        checks.put("unseated", students.size() - seats.size());
        checks.put("seats_double_booked", doubleBooked);
        checks.put("same_subject_neighbours", sameSubjectNeighbours);
        checks.put("ground_floor_students", groundStudents);
        checks.put("ground_floor_violations", groundViolations);
        checks.put("rooms_opened", seatedPerRoom.size());
        checks.put("fill_rate", seatsInOpenedRooms == 0 ? 0 : Math.round(1000.0 * seats.size() / seatsInOpenedRooms) / 1000.0);
        checks.put("ok", students.size() == seats.size() && doubleBooked == 0 && sameSubjectNeighbours == 0
                && groundViolations == 0);
        return checks;
    }
}
