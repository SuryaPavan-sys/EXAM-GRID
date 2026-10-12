import { useEffect, useState } from 'react';
import { api, fmt, fmtDate, pdfUrl } from '../../api.js';
import { setScreenContext } from '../../assistantContext.js';
import { ErrorBox, Loading, PageHeader } from '../../components/Layout.jsx';
import RoomGrid from '../../components/RoomGrid.jsx';

export default function Seating() {
  const [sessions, setSessions] = useState(null);
  const [current, setCurrent] = useState(null);
  const [rooms, setRooms] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [grid, setGrid] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/sessions').then((s) => { setSessions(s); setCurrent(s[0]); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!current) return;
    setRooms(null); setGrid(null);
    api(`/sessions/${current.date}/${current.session}/rooms`).then((r) => { setRooms(r); setRoomId(r[0]?.room_id); });
  }, [current]);
  useEffect(() => {
    if (!current || !roomId) return;
    api(`/rooms/${current.date}/${current.session}/${roomId}`).then(setGrid);
  }, [current, roomId]);
  // Let the assistant know which room/session is on screen ("why is this room half empty?").
  useEffect(() => {
    if (current) setScreenContext({ page: 'Seating plan', date: current.date, session: current.session, room_id: roomId });
  }, [current, roomId]);

  const move = async (from, to) => {
    try {
      const res = await api(`/rooms/${current.date}/${current.session}/${roomId}/move`, { method: 'POST', body: { from, to } });
      setGrid(res.grid);
      setMessage({ ok: true, text: res.swapped ? 'Seats swapped and saved.' : 'Student moved and saved.' });
    } catch (e) {
      setMessage({ ok: false, text: `Not saved: ${e.data?.violations?.[0]?.message || e.message}` });
    }
  };

  if (error) return <ErrorBox error={error} />;
  if (!sessions) return <Loading />;
  return (
    <>
      <PageHeader title="Seating plan" subtitle="Timefold solver output. Same-paper students are never side by side or front-to-back." />
      <div className="mb-4 flex gap-2 overflow-x-auto pb-2">
        {sessions.map((s) => (
          <button key={`${s.date}${s.session}`} onClick={() => setCurrent(s)}
            className={`shrink-0 rounded-lg border px-3 py-2 text-left text-xs ${current === s ? 'border-navy-700 bg-navy-700 text-white' : ''}`}
            style={current === s ? {} : { borderColor: 'var(--border)', background: 'var(--card)' }}>
            <div className="font-semibold">{fmtDate(s.date)} · {s.session}</div>
            <div className={current === s ? 'opacity-80' : 'muted'}>{fmt(s.students)} students · {s.rooms} rooms</div>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="card max-h-[75vh] overflow-y-auto p-2">
          {!rooms ? <Loading /> : rooms.map((r) => (
            <button key={r.room_id} onClick={() => { setRoomId(r.room_id); setMessage(null); }}
              className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm ${roomId === r.room_id ? 'bg-navy-50 dark:bg-navy-900' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{r.room_id}</span>
                {r.violations ? <span className="bad-pill">{r.violations} issues</span> : <span className="text-xs tabular-nums muted">{r.seated}/{r.capacity}</span>}
              </div>
              <div className="text-xs muted">{r.block} · floor {r.floor} · {Object.keys(r.subjects).length} papers</div>
              <div className="mt-1 h-1.5 rounded-full" style={{ background: 'var(--grid)' }}>
                <div className="h-1.5 rounded-full" style={{ width: `${(100 * r.seated) / r.capacity}%`, background: 'var(--series-1)' }} />
              </div>
            </button>
          ))}
        </div>

        <div className="card">
          {!grid ? <Loading /> : (
            <>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">{grid.room.room_id} <span className="text-sm font-normal muted">{grid.room.block} · floor {grid.room.floor}</span></h2>
                  <div className="text-sm muted">{fmtDate(grid.date)} · {grid.session} {grid.time} · {grid.seats.length} of {grid.room.capacity} seats</div>
                  <div className="mt-1 text-sm">Invigilators: <span className="font-medium">{grid.invigilators.map((d) => d.faculty_name).join(', ') || '-'}</span></div>
                </div>
                <div className="flex items-center gap-2">
                  {grid.violations.length === 0 ? <span className="ok-pill">✓ No rule broken</span> : <span className="bad-pill">{grid.violations.length} issues</span>}
                  <a className="btn-ghost" href={pdfUrl(`/rooms/${grid.date}/${grid.session}/${grid.room.room_id}/chart.pdf`)} target="_blank" rel="noreferrer">Room chart PDF</a>
                </div>
              </div>
              <RoomGrid grid={grid} editable onMove={move} />
              {message && <div className={`mt-3 rounded-lg p-2 text-sm ${message.ok ? 'bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>{message.text}</div>}
            </>
          )}
        </div>
      </div>
    </>
  );
}
