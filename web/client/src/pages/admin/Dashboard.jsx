import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmt } from '../../api.js';
import { Bars } from '../../components/charts.jsx';
import { Check, ErrorBox, Loading, PageHeader, Stat } from '../../components/Layout.jsx';

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/summary').then(setD).catch((e) => setError(e.message)); }, []);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;

  const tt = d.timetable || {}, seat = d.seating || {}, duty = d.duties || {}, tr = d.turnout?.summary || {};
  return (
    <>
      <PageHeader title="Exam cell dashboard" subtitle={`${d.config.exam_cycle} · ${d.config.college}`}
        actions={<Link className="btn-primary" to="/admin/seating">Open seating plan</Link>} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Students" value={fmt(d.counts.students)} note={`${fmt(d.counts.registrations)} papers · ${fmt(d.counts.backlog)} supply`} />
        <Stat label="Exam days" value={tt.exam_days_used} note={`${tt.sessions_used} sessions · ${tt.first_exam} → ${tt.last_exam}`} />
        <Stat label="Timetable clashes" value={tt.clashes_same_session ?? '-'} tone="good"
          note={`${tt.regular_students_two_exams_same_day} regular students with 2 exams a day`} />
        <Stat label="Same-paper neighbours" value={seat.same_subject_neighbours ?? '-'} tone="good"
          note={`${fmt(seat.students_seated)} seated in ${fmt(seat.room_sessions)} room-sessions`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h2 className="font-semibold">Students per session vs seats</h2>
          <p className="mb-3 text-xs muted">Registered students and seats booked with the turnout model. Dashed line: all exam-usable seats.</p>
          <Bars data={d.charts.sessions} x="key" series={[['registered', 'Registered'], ['booked', 'Seats booked']]}
            reference={{ value: d.charts.sessions[0]?.seats, label: `${fmt(d.charts.sessions[0]?.seats)} seats` }} height={300} />
        </div>
        <div className="card">
          <h2 className="mb-3 font-semibold">Every rule, checked</h2>
          <div className="space-y-2.5">
            <Check ok={tt.clashes_same_session === 0} label="No student has two papers in one session" />
            <Check ok={tt.regular_students_two_exams_same_day === 0} label="Regular students: at most one exam a day" />
            <Check ok={Object.keys(tt.sessions_over_capacity || {}).length === 0} label="No session over seat capacity" />
            <Check ok={seat.unseated === 0} label={`All ${fmt(seat.students_seated)} papers have a seat`} />
            <Check ok={seat.same_subject_neighbours === 0} label="No same-paper neighbours (L/R/front/back)" />
            <Check ok={seat.ground_floor_violations === 0} label="Ground-floor needs met" />
            <Check ok={duty.own_subject_violations === 0} label="Nobody invigilates their own subject" />
            <Check ok={duty.double_booked === 0 && duty.on_leave_violations === 0} label="No double booking, leave respected" />
            <Check ok={duty.faculty_over_cap === 0} label="Duty caps by designation respected" />
          </div>
          <div className="mt-4 rounded-lg p-3 text-xs muted" style={{ background: 'var(--surface)' }}>
            {tt.backlog_students_two_exams_same_day} supply students write FN + AN on one day (allowed policy).
            {d.seat_edits ? ` ${d.seat_edits} manual seat edits.` : ''}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h2 className="font-semibold">Students by branch and year</h2>
          <p className="mb-3 text-xs muted">R23 batches, NOV-2026 odd semester.</p>
          <Bars data={d.charts.branches} x="branch" stack
            series={[['y1', 'Year 1'], ['y2', 'Year 2'], ['y3', 'Year 3'], ['y4', 'Year 4']]} height={280} />
        </div>
        <div className="card">
          <h2 className="font-semibold">Invigilation load</h2>
          <p className="mb-3 text-xs muted">Faculty by number of duties ({fmt(duty.duties)} duties, {duty.faculty_used} faculty).</p>
          <Bars data={d.charts.duty_histogram} x="duties" series={[['faculty', 'Faculty']]} height={200} />
          <div className="mt-3 space-y-1 text-sm">
            {Object.entries(duty.avg_duties_by_designation || {}).map(([k, v]) => (
              <div key={k} className="flex justify-between"><span className="muted">{k}</span><span className="font-semibold tabular-nums">{v} avg</span></div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Expected to attend" value={fmt(tr.expected_present)} note={`of ${fmt(tr.papers_registered)} papers · ${tr.model}`} />
        <Stat label="Seats saved" value={`${tr.seats_saved_pct ?? 0}%`} note={`${fmt(tr.seats_booked)} booked with a ${tr.safety_margin_pct}% + 3σ safety margin`} />
        <Stat label="Timetable built in" value={`${tt.algorithm?.seconds_total ?? '-'} s`}
          note={`${tt.algorithm?.conflict_graph?.subjects} subjects · ${fmt(tt.algorithm?.conflict_graph?.conflict_edges)} conflict edges`} />
      </div>
    </>
  );
}
