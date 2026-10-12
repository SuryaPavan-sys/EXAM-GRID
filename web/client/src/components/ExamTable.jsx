import { fmtDate } from '../api.js';

/** A student's exams with their seats. */
export default function ExamTable({ exams, showType = true }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr><th>Date</th><th>Session</th><th>Subject</th>{showType && <th>Type</th>}<th>Room</th><th>Seat</th></tr>
        </thead>
        <tbody>
          {exams.map((e) => (
            <tr key={e.subject_code}>
              <td className="whitespace-nowrap font-medium">{fmtDate(e.exam_date)}</td>
              <td className="whitespace-nowrap">{e.session} <span className="muted">{e.time}</span></td>
              <td><div className="font-medium">{e.subject_name}</div><div className="text-xs muted">{e.subject_code}</div></td>
              {showType && <td>{e.reg_type === 'BACKLOG' ? <span className="pill bg-amber-100 text-amber-800">Supply</span>
                : <span className="info-pill">Regular</span>}</td>}
              <td className="whitespace-nowrap"><div className="font-semibold">{e.room_id || '-'}</div>
                <div className="text-xs muted">{e.building}{e.floor !== null && e.floor !== undefined ? ` · floor ${e.floor}` : ''}</div></td>
              <td className="whitespace-nowrap">{e.seat_no ? <><span className="text-lg font-bold">{e.seat_no}</span>
                <span className="ml-1 text-xs muted">row {e.row}, col {e.col}</span></> : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
