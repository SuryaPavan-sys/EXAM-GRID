import { useEffect, useMemo, useState } from 'react';
import { api, fmt, fmtDate } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ErrorBox, Loading, PageHeader } from '../components/Layout.jsx';

export default function Timetable() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [branch, setBranch] = useState(user.role === 'student' ? user.branch : '');
  const [year, setYear] = useState(user.role === 'student' ? String(user.year) : '');
  const [q, setQ] = useState('');

  useEffect(() => {
    const p = new URLSearchParams({ ...(branch && { branch }), ...(year && { year }) });
    api(`/timetable?${p}`).then(setData).catch((e) => setError(e.message));
  }, [branch, year]);

  const rows = useMemo(() => (data?.rows || []).filter((r) =>
    !q || `${r.subject_code} ${r.subject_name}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const byDate = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => { if (!m.has(r.exam_date)) m.set(r.exam_date, []); m.get(r.exam_date).push(r); });
    return [...m.entries()];
  }, [rows]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <PageHeader title="Exam timetable" subtitle={`${data.config.exam_cycle} · FN ${data.config.sessions?.[0]?.start}–${data.config.sessions?.[0]?.end}, AN ${data.config.sessions?.[1]?.start}–${data.config.sessions?.[1]?.end}`} />
      <div className="card mb-4 flex flex-wrap gap-3">
        <div><label className="label">Branch</label>
          <select className="input" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">All branches</option>{data.branches.map((b) => <option key={b}>{b}</option>)}
          </select></div>
        <div><label className="label">Year</label>
          <select className="input" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">All years</option>{[1, 2, 3, 4].map((y) => <option key={y} value={y}>Year {y}</option>)}
          </select></div>
        <div className="min-w-[200px] flex-1"><label className="label">Search subject</label>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Code or name" /></div>
        <div className="self-end text-sm muted">{rows.length} papers</div>
      </div>
      <div className="space-y-4">
        {byDate.map(([date, items]) => (
          <div key={date} className="card p-0">
            <div className="border-b px-5 py-3 font-semibold" style={{ borderColor: 'var(--border)' }}>{fmtDate(date)}
              <span className="ml-2 text-xs font-normal muted">{date}</span></div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Session</th><th>Code</th><th>Subject</th><th>Dept</th><th>Year</th><th>Type</th><th className="text-right">Students</th></tr></thead>
                <tbody>{items.map((r) => (
                  <tr key={r.subject_code}>
                    <td className="whitespace-nowrap"><span className="info-pill">{r.session}</span> <span className="text-xs muted">{r.time}</span></td>
                    <td className="font-mono text-xs">{r.subject_code}</td>
                    <td>{r.subject_name}</td>
                    <td>{r.department}</td>
                    <td>{r.year}</td>
                    <td>{r.category}</td>
                    <td className="text-right tabular-nums">{fmt(r.students)}{r.backlog ? <span className="ml-1 text-xs muted">({r.backlog} supply)</span> : ''}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
