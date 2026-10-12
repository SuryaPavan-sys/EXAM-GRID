package com.examgrid.solver.duty;

import ai.timefold.solver.core.api.domain.entity.PlanningEntity;
import ai.timefold.solver.core.api.domain.lookup.PlanningId;
import ai.timefold.solver.core.api.domain.variable.PlanningVariable;

import java.util.Set;

/** One invigilator slot in one room for one session. Timefold picks the {@link Faculty}. */
@PlanningEntity
public class Duty {

    @PlanningId
    private String id;
    private String date;
    private String session;
    private String roomId;
    private Set<String> roomSubjects;
    private int seated;
    private double expected;

    @PlanningVariable
    private Faculty faculty;

    public Duty() {
    }

    public Duty(String id, String date, String session, String roomId, Set<String> roomSubjects,
                int seated, double expected) {
        this.id = id;
        this.date = date;
        this.session = session;
        this.roomId = roomId;
        this.roomSubjects = roomSubjects;
        this.seated = seated;
        this.expected = expected;
    }

    public String getId() {
        return id;
    }

    public String getDate() {
        return date;
    }

    public String getSession() {
        return session;
    }

    public String getSessionKey() {
        return date + " " + session;
    }

    public String getRoomId() {
        return roomId;
    }

    public Set<String> getRoomSubjects() {
        return roomSubjects;
    }

    public int getSeated() {
        return seated;
    }

    public double getExpected() {
        return expected;
    }

    public Faculty getFaculty() {
        return faculty;
    }

    public void setFaculty(Faculty faculty) {
        this.faculty = faculty;
    }
}
