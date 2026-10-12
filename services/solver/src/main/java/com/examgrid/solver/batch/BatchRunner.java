package com.examgrid.solver.batch;

import com.examgrid.solver.duty.Duty;
import com.examgrid.solver.duty.DutyService;
import com.examgrid.solver.duty.Faculty;
import com.examgrid.solver.io.Csv;
import com.examgrid.solver.seating.Room;
import com.examgrid.solver.seating.SeatingService;
import com.examgrid.solver.seating.SeatingService.Seat;
import com.examgrid.solver.seating.SeatingService.StudentPaper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * Plans seating and invigilation for every session of an exam cycle.
 * <pre>
 *   batch DATA_DIR OUT_DIR [seconds-per-session]
 * </pre>
 * Reads the dataset CSVs plus OUT_DIR/timetable.csv (and OUT_DIR/turnout_papers.csv if present),
 * writes OUT_DIR/seating.csv, duties.csv and solver_report.json.
 */
public final class BatchRunner {

    private static final int STUDENTS_PER_INVIGILATOR = 30;

    private BatchRunner() {
    }

    public static int run(String[] args) throws Exception {
        if (args.length < 3) {
            System.err.println("usage: batch DATA_DIR OUT_DIR [seconds-per-session]");
            return 1;
        }
        Path data = Path.of(args[1]);
        Path out = Path.of(args[2]);
        int seconds = args.length > 3 ? Integer.parseInt(args[3]) : 8;
        long t0 = System.currentTimeMillis();

        // ---------------------------------------------------------- inputs
        List<Room> rooms = new ArrayList<>();
        for (Map<String, String> r : Csv.read(data.resolve("rooms.csv"))) {
            if ("yes".equals(r.get("exam_usable"))) {
                rooms.add(new Room(r.get("room_id"), r.get("block"), Integer.parseInt(r.get("floor")),
                        Integer.parseInt(r.get("rows")), Integer.parseInt(r.get("cols"))));
            }
        }
        Map<String, Map<String, String>> students = new HashMap<>();
        for (Map<String, String> s : Csv.read(data.resolve("students.csv"))) {
            students.put(s.get("roll_no"), s);
        }
        Map<String, String> sessionOf = new HashMap<>();
        for (Map<String, String> t : Csv.read(out.resolve("timetable.csv"))) {
            sessionOf.put(t.get("subject_code"), t.get("exam_date") + " " + t.get("session"));
        }
        Map<String, Double> attendProb = new HashMap<>();
        Path turnout = out.resolve("turnout_papers.csv");
        if (Files.exists(turnout)) {
            for (Map<String, String> p : Csv.read(turnout)) {
                attendProb.put(p.get("roll_no") + "|" + p.get("subject_code"), Double.parseDouble(p.get("attend_prob")));
            }
        }
        Map<String, List<StudentPaper>> bySession = new TreeMap<>();
        for (Map<String, String> r : Csv.read(data.resolve("registrations.csv"))) {
            String key = sessionOf.get(r.get("subject_code"));
            if (key == null) {
                continue;
            }
            Map<String, String> s = students.getOrDefault(r.get("roll_no"), Map.of());
            bySession.computeIfAbsent(key, k -> new ArrayList<>()).add(new StudentPaper(r.get("roll_no"),
                    r.get("subject_code"), s.getOrDefault("branch", ""), "yes".equals(s.get("needs_ground_floor"))));
        }

        // ---------------------------------------------------------- seating, sessions in parallel
        System.out.printf("Seating %d sessions over %d rooms (%d s limit each)...%n", bySession.size(), rooms.size(), seconds);
        SeatingService seating = new SeatingService(Duration.ofSeconds(seconds), Duration.ofSeconds(Math.max(2, seconds / 3)));
        int threads = Math.max(2, Runtime.getRuntime().availableProcessors() / 2);
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        Map<String, Future<SeatingService.Result>> futures = new LinkedHashMap<>();
        for (Map.Entry<String, List<StudentPaper>> e : bySession.entrySet()) {
            futures.put(e.getKey(), pool.submit(() -> seating.seat(e.getValue(), rooms)));
        }
        Map<String, SeatingService.Result> seated = new LinkedHashMap<>();
        for (Map.Entry<String, Future<SeatingService.Result>> e : futures.entrySet()) {
            SeatingService.Result r = e.getValue().get();
            seated.put(e.getKey(), r);
            Map<String, Object> c = r.checks();
            System.out.printf("  %s  %5d students  %3d rooms  fill %4.0f%%  neighbours %d  ground %d  %s  %s%n",
                    e.getKey(), (int) c.get("students"), (int) c.get("rooms_opened"),
                    100 * ((Number) c.get("fill_rate")).doubleValue(), (int) c.get("same_subject_neighbours"),
                    ((Number) c.get("ground_floor_violations")).intValue(), r.score(),
                    Boolean.TRUE.equals(c.get("ok")) ? "OK" : "PROBLEM");
        }
        pool.shutdown();

        List<List<Object>> seatRows = new ArrayList<>();
        for (Map.Entry<String, SeatingService.Result> e : seated.entrySet()) {
            String[] ds = e.getKey().split(" ");
            for (Seat s : e.getValue().seats()) {
                seatRows.add(List.of(ds[0], ds[1], s.roomId(), s.building(), s.floor(), s.seatNo(), s.row(), s.col(),
                        s.roll(), s.subject(), s.branch()));
            }
        }
        Csv.write(out.resolve("seating.csv"), List.of("exam_date", "session", "room_id", "building", "floor", "seat_no",
                "row", "col", "roll_no", "subject_code", "branch"), seatRows);

        // ---------------------------------------------------------- invigilation duties
        List<Faculty> faculty = loadFaculty(data);
        List<Duty> duties = new ArrayList<>();
        for (Map.Entry<String, SeatingService.Result> e : seated.entrySet()) {
            String[] ds = e.getKey().split(" ");
            Map<String, List<Seat>> byRoom = new TreeMap<>();
            for (Seat s : e.getValue().seats()) {
                byRoom.computeIfAbsent(s.roomId(), k -> new ArrayList<>()).add(s);
            }
            for (Map.Entry<String, List<Seat>> room : byRoom.entrySet()) {
                Set<String> subjects = new HashSet<>();
                double expected = 0;
                for (Seat s : room.getValue()) {
                    subjects.add(s.subject());
                    expected += attendProb.getOrDefault(s.roll() + "|" + s.subject(), 1.0);
                }
                int needed = Math.max(1, (int) Math.ceil(expected / STUDENTS_PER_INVIGILATOR));
                for (int i = 0; i < needed; i++) {
                    duties.add(new Duty(ds[0] + ds[1] + room.getKey() + "#" + i, ds[0], ds[1], room.getKey(),
                            subjects, room.getValue().size(), Math.round(expected * 10) / 10.0));
                }
            }
        }
        System.out.printf("Assigning %d invigilation duties to %d faculty...%n", duties.size(), faculty.size());
        DutyService.Result roster = new DutyService(Duration.ofSeconds(90), Duration.ofSeconds(20)).assign(faculty, duties);
        List<List<Object>> dutyRows = new ArrayList<>();
        for (Duty d : roster.duties()) {
            Faculty f = d.getFaculty();
            dutyRows.add(List.of(d.getDate(), d.getSession(), d.getRoomId(), f == null ? "" : f.id(),
                    f == null ? "" : f.name(), f == null ? "" : f.department(), d.getSeated(), d.getExpected()));
        }
        dutyRows.sort((a, b) -> (a.get(0) + " " + a.get(1) + " " + a.get(2)).compareTo(b.get(0) + " " + b.get(1) + " " + b.get(2)));
        Csv.write(out.resolve("duties.csv"), List.of("exam_date", "session", "room_id", "faculty_id", "faculty_name",
                "department", "students_seated", "students_expected"), dutyRows);
        System.out.println("  duty roster " + roster.score() + "  " + roster.checks());

        // ---------------------------------------------------------- report
        Map<String, Object> totals = new LinkedHashMap<>();
        totals.put("sessions", seated.size());
        totals.put("students_seated", seated.values().stream().mapToInt(r -> (int) r.checks().get("seated")).sum());
        totals.put("unseated", seated.values().stream().mapToInt(r -> (int) r.checks().get("unseated")).sum());
        totals.put("same_subject_neighbours", seated.values().stream().mapToInt(r -> (int) r.checks().get("same_subject_neighbours")).sum());
        totals.put("ground_floor_violations", seated.values().stream().mapToLong(r -> ((Number) r.checks().get("ground_floor_violations")).longValue()).sum());
        totals.put("room_sessions", seated.values().stream().mapToInt(r -> (int) r.checks().get("rooms_opened")).sum());
        totals.put("all_sessions_ok", seated.values().stream().allMatch(r -> Boolean.TRUE.equals(r.checks().get("ok"))));
        Map<String, Object> perSession = new LinkedHashMap<>();
        seated.forEach((k, r) -> perSession.put(k, Map.of("score", r.score(), "checks", r.checks())));
        Map<String, Object> report = new LinkedHashMap<>();
        report.put("seating", totals);
        report.put("seating_sessions", perSession);
        report.put("duties", Map.of("score", roster.score(), "checks", roster.checks()));
        report.put("seconds", (System.currentTimeMillis() - t0) / 1000.0);
        new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT).writeValue(out.resolve("solver_report.json").toFile(), report);

        System.out.println("Seating totals: " + totals);
        System.out.printf("Done in %.1f s. Wrote seating.csv, duties.csv, solver_report.json to %s%n",
                (System.currentTimeMillis() - t0) / 1000.0, out);
        boolean ok = Boolean.TRUE.equals(totals.get("all_sessions_ok")) && Boolean.TRUE.equals(roster.checks().get("ok"));
        return ok ? 0 : 2;
    }

    private static List<Faculty> loadFaculty(Path data) throws Exception {
        Map<String, Set<String>> teaches = new HashMap<>();
        for (Map<String, String> t : Csv.read(data.resolve("faculty_subjects.csv"))) {
            teaches.computeIfAbsent(t.get("faculty_id"), k -> new HashSet<>()).add(t.get("subject_code"));
        }
        Map<String, Set<String>> leave = new HashMap<>();
        for (Map<String, String> l : Csv.read(data.resolve("faculty_unavailability.csv"))) {
            Set<String> set = leave.computeIfAbsent(l.get("faculty_id"), k -> new HashSet<>());
            String s = l.get("session");
            if (s.equals("BOTH") || s.equals("FN")) set.add(l.get("date") + " FN");
            if (s.equals("BOTH") || s.equals("AN")) set.add(l.get("date") + " AN");
        }
        List<Faculty> faculty = new ArrayList<>();
        for (Map<String, String> f : Csv.read(data.resolve("faculty.csv"))) {
            String id = f.get("faculty_id");
            faculty.add(new Faculty(id, f.get("name"), f.get("department"), f.get("designation"),
                    Integer.parseInt(f.get("max_duties")), teaches.getOrDefault(id, Set.of()), leave.getOrDefault(id, Set.of())));
        }
        return faculty;
    }
}
