import { useEffect, useMemo, useState } from 'react';
import { api, fmt, fmtDate } from '../../api.js';
import { Check, ErrorBox, Loading, PageHeader, Stat } from '../../components/Layout.jsx';

export default function Duties() {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [date, setDate] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { api('/duties').then(setD).catch((e) => setError(e.message)); }, []);

  const dates = useMemo(() => [...new Set((d?.rows || []).map((r) => r.exam_date))].sort(), [d]);
  const rows = useMemo(() => (d?.rows || []).filter((r) => (!date || r.exam_date === date)
    && (!q || `${r.faculty_id} ${r.faculty_name} ${r.room_id} ${r.department}`.toLowerCase().includes(q.toLowerCase()))), [d, date, q]);
  const busiest = useMemo(() => [...(d?.faculty || [])].sort((a, b) => b.duties / b.max_duties - a.duties / a.max_duties).slice(0, 8), [d]);

  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;
  const c = d.checks || {};
  return (
    <>
      <PageHeader title="Invigilation duties" subtitle="Timefold roster: invigilators per room from expected attendance (1 per 30 students)." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Duties" value={fmt(c.duties)} note={`${c.faculty_used} of ${d.faculty.length} faculty used`} />
        <Stat label="Duties per person" value={`${c.duties_min}–${c.duties_max}`} note={`mean ${c.duties_mean} · σ ${c.duties_std_dev}`} />
        <Stat label="Own-subject duties" value={c.own_subject_violations} tone="good" note="must be 0" />
        <Stat label="Two duties in a day" value={c.faculty_with_two_duties_same_day} tone="good" note="soft goal" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="card p-0">
          <div className="flex flex-wrap gap-3 p-4">
            <select className="input max-w-[200px]" value={date} onChange={(e) => setDate(e.target.value)}>
              <option value="">All dates</option>{dates.map((x) => <option key={x} value={x}>{fmtDate(x)}</option>)}
            </select>
            <input className="input max-w-xs" placeholder="Search faculty, room, department" value={q} onChange={(e) => setQ(e.target.value)} />
            <span className="self-center text-sm muted">{fmt(rows.length)} duties</span>
          </div>
          <div className="max-h-[65vh] overflow-auto">
            <table className="table">
              <thead><tr><th>Date</th><th>Session</th><th>Room</th><th>Faculty</th><th>Dept</th><th className="text-right">Seated / expected</th></tr></thead>
              <tbody>{rows.slice(0, 400).map((r, i) => (
                <tr key={i}><td className="whitespace-nowrap">{fmtDate(r.exam_date)}</td><td>{r.session}</td><td className="font-semibold">{r.room_id}</td>
                  <td>{r.faculty_name} <span className="text-xs muted">{r.faculty_id}</span></td><td>{r.department}</td>
                  <td className="text-right tabular-nums">{r.students_seated} / {r.students_expected}</td></tr>))}</tbody>
            </table>
            {rows.length > 400 && <div className="p-3 text-center text-xs muted">Showing 400 of {fmt(rows.length)} - filter to see more.</div>}
          </div>
        </div>
        <div className="space-y-4">
          <div className="card space-y-2.5">
            <h2 className="font-semibold">Hard rules</h2>
            <Check ok={c.unassigned === 0} label="Every duty has an invigilator" />
            <Check ok={c.own_subject_violations === 0} label="Never their own subject" />
            <Check ok={c.double_booked === 0} label="Never two rooms at once" />
            <Check ok={c.on_leave_violations === 0} label="Leave days respected" />
            <Check ok={c.faculty_over_cap === 0} label="Designation duty caps" />
          </div>
          <div className="card">
            <h2 className="mb-2 font-semibold">Highest load vs cap</h2>
            {busiest.map((f) => (
              <div key={f.faculty_id} className="mb-2 text-sm">
                <div className="flex justify-between"><span>{f.name}</span><span className="tabular-nums muted">{f.duties}/{f.max_duties}</span></div>
                <div className="h-1.5 rounded-full" style={{ background: 'var(--grid)' }}>
                  <div className="h-1.5 rounded-full" style={{ width: `${(100 * f.duties) / f.max_duties}%`, background: 'var(--series-1)' }} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
