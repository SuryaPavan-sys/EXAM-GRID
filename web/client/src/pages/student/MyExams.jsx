import { useEffect, useState } from 'react';
import { api, fmtDate, pdfUrl } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { ErrorBox, Loading, PageHeader, Stat } from '../../components/Layout.jsx';
import ExamTable from '../../components/ExamTable.jsx';

export default function MyExams() {
  const { user } = useAuth();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(`/students/${user.id}/exams`).then(setD).catch((e) => setError(e.message)); }, [user.id]);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;
  const next = d.exams.find((e) => e.exam_date >= new Date().toISOString().slice(0, 10)) || d.exams[0];
  return (
    <>
      <PageHeader title={`Hello, ${d.student.name.split(' ').slice(1).join(' ') || d.student.name}`}
        subtitle={`${d.student.roll_no} · ${d.student.branch} · Year ${d.student.year}`}
        actions={<a className="btn-primary" href={pdfUrl(`/students/${user.id}/hallticket.pdf`)} target="_blank" rel="noreferrer">Download hall ticket</a>} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Exams" value={d.exams.length} note={`${d.exams.filter((e) => e.reg_type === 'BACKLOG').length} supply`} />
        {next && <Stat label="First exam" value={fmtDate(next.exam_date)} note={`${next.subject_name} · ${next.session} ${next.time}`} />}
        {next && <Stat label="Your seat" value={`${next.room_id} · ${next.seat_no}`} note={`${next.building}, floor ${next.floor}, row ${next.row} col ${next.col}`} />}
      </div>
      <div className="card mt-4 p-0"><ExamTable exams={d.exams} /></div>
      <p className="mt-3 text-xs muted">Your hall ticket has a QR code that the invigilator can scan to verify it.</p>
    </>
  );
}
