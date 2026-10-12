import { useEffect, useState } from 'react';
import { api, fmtDate, pdfUrl } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { ErrorBox, Loading, PageHeader, Stat } from '../../components/Layout.jsx';
import RoomGrid from '../../components/RoomGrid.jsx';

export default function MyDuties() {
  const { user } = useAuth();
  const [d, setD] = useState(null);
  const [grid, setGrid] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(`/faculty/${user.id}/duties`).then(setD).catch((e) => setError(e.message)); }, [user.id]);
  const open = (x) => api(`/rooms/${x.exam_date}/${x.session}/${x.room_id}`).then(setGrid).catch((e) => setError(e.message));
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;
  return (
    <>
      <PageHeader title="My invigilation duties" subtitle={`${d.faculty.name} · ${d.faculty.department} · ${d.faculty.designation}`} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Duties" value={d.duties.length} note={`cap ${d.faculty.max_duties} for ${d.faculty.designation}`} />
        <Stat label="Subjects you teach" value={d.faculty.teaches.length} note="never assigned to those exams" />
        <Stat label="Next duty" value={d.duties[0] ? fmtDate(d.duties[0].exam_date) : '-'} note={d.duties[0] ? `${d.duties[0].session} · ${d.duties[0].room_id}` : ''} />
      </div>
      <div className="card mt-4 p-0 overflow-x-auto">
        <table className="table">
          <thead><tr><th>Date</th><th>Session</th><th>Room</th><th>Students</th><th>Papers in room</th><th /></tr></thead>
          <tbody>{d.duties.map((x, i) => (
            <tr key={i}>
              <td className="whitespace-nowrap font-medium">{fmtDate(x.exam_date)}</td>
              <td>{x.session} <span className="muted">{x.time}</span></td>
              <td><span className="font-semibold">{x.room_id}</span> <span className="text-xs muted">{x.block}, floor {x.floor}</span></td>
              <td className="tabular-nums">{x.students_seated} <span className="text-xs muted">(~{x.students_expected} expected)</span></td>
              <td className="text-xs">{x.subjects.join(', ')}</td>
              <td className="whitespace-nowrap"><button className="btn-ghost" onClick={() => open(x)}>Seating</button>{' '}
                <a className="btn-ghost" href={pdfUrl(`/rooms/${x.exam_date}/${x.session}/${x.room_id}/chart.pdf`)} target="_blank" rel="noreferrer">PDF</a></td>
            </tr>))}</tbody>
        </table>
      </div>
      {grid && <div className="card mt-4"><h2 className="mb-3 font-semibold">{grid.room.room_id} · {fmtDate(grid.date)} {grid.session}</h2>
        <RoomGrid grid={grid} editable={false} onMove={() => {}} /></div>}
    </>
  );
}
