package com.examgrid.solver.duty;

import ai.timefold.solver.core.api.solver.Solver;
import ai.timefold.solver.core.api.solver.SolverFactory;
import ai.timefold.solver.core.config.solver.SolverConfig;
import ai.timefold.solver.core.config.solver.termination.TerminationConfig;

import java.time.Duration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Assigns invigilators to every duty of the cycle. */
public class DutyService {

    public record Result(String score, boolean feasible, List<Duty> duties, Map<String, Object> checks) {
    }

    private final Duration spentLimit;
    private final Duration unimprovedLimit;

    public DutyService(Duration spentLimit, Duration unimprovedLimit) {
        this.spentLimit = spentLimit;
        this.unimprovedLimit = unimprovedLimit;
    }

    public Result assign(List<Faculty> faculty, List<Duty> duties) {
        SolverConfig config = new SolverConfig()
                .withSolutionClass(DutyRoster.class)
                .withEntityClasses(Duty.class)
                .withConstraintProviderClass(DutyConstraints.class)
                .withTerminationConfig(new TerminationConfig()
                        .withSpentLimit(spentLimit)
                        .withUnimprovedSpentLimit(unimprovedLimit));
        Solver<DutyRoster> solver = SolverFactory.<DutyRoster>create(config).buildSolver();
        DutyRoster solved = solver.solve(new DutyRoster(faculty, duties));
        return new Result(solved.getScore().toString(), solved.getScore().isFeasible(), solved.getDuties(),
                check(solved.getDuties(), faculty));
    }

    /** Independent checks recomputed from the final roster. */
    public static Map<String, Object> check(List<Duty> duties, List<Faculty> faculty) {
        int own = 0, leave = 0, unassigned = 0, sameDay = 0, overCap = 0, doubleBooked = 0;
        Map<Faculty, Integer> load = new HashMap<>();
        Map<String, Integer> perSession = new HashMap<>();
        Map<String, Integer> perDay = new HashMap<>();
        for (Duty d : duties) {
            Faculty f = d.getFaculty();
            if (f == null) {
                unassigned++;
                continue;
            }
            if (f.teachesAny(d.getRoomSubjects())) own++;
            if (f.onLeave(d.getSessionKey())) leave++;
            load.merge(f, 1, Integer::sum);
            if (perSession.merge(f.id() + "@" + d.getSessionKey(), 1, Integer::sum) > 1) doubleBooked++;
            if (perDay.merge(f.id() + "@" + d.getDate(), 1, Integer::sum) > 1) sameDay++;
        }
        for (Map.Entry<Faculty, Integer> e : load.entrySet()) {
            if (e.getValue() > e.getKey().maxDuties()) overCap++;
        }
        int[] loads = faculty.stream().mapToInt(f -> load.getOrDefault(f, 0)).toArray();
        double mean = java.util.Arrays.stream(loads).average().orElse(0);
        double sd = Math.sqrt(java.util.Arrays.stream(loads).mapToDouble(x -> (x - mean) * (x - mean)).average().orElse(0));
        Map<String, Integer> byDesignation = new LinkedHashMap<>();
        Map<String, Integer> capByDesignation = new LinkedHashMap<>();
        for (Faculty f : faculty) {
            byDesignation.merge(f.designation(), load.getOrDefault(f, 0), Integer::sum);
            capByDesignation.merge(f.designation(), 1, Integer::sum);
        }
        Map<String, Double> avgByDesignation = new LinkedHashMap<>();
        byDesignation.forEach((k, v) -> avgByDesignation.put(k, Math.round(10.0 * v / capByDesignation.get(k)) / 10.0));

        Map<String, Object> c = new LinkedHashMap<>();
        c.put("duties", duties.size());
        c.put("unassigned", unassigned);
        c.put("own_subject_violations", own);
        c.put("double_booked", doubleBooked);
        c.put("on_leave_violations", leave);
        c.put("faculty_over_cap", overCap);
        c.put("faculty_with_two_duties_same_day", sameDay);
        c.put("faculty_used", load.size());
        c.put("duties_min", java.util.Arrays.stream(loads).min().orElse(0));
        c.put("duties_max", java.util.Arrays.stream(loads).max().orElse(0));
        c.put("duties_mean", Math.round(mean * 100) / 100.0);
        c.put("duties_std_dev", Math.round(sd * 100) / 100.0);
        c.put("avg_duties_by_designation", avgByDesignation);
        c.put("ok", unassigned == 0 && own == 0 && leave == 0 && overCap == 0 && doubleBooked == 0);
        return c;
    }
}
