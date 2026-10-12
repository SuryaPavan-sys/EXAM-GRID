import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Logo } from '../components/Layout.jsx';
import ExamTable from '../components/ExamTable.jsx';

/** Where the hall-ticket QR code points: confirms the ticket is genuine. */
export default function Verify() {
  const { roll } = useParams();
  const [params] = useSearchParams();
  const [data, setData] = useState(null);
  useEffect(() => { api(`/verify/${roll}?sig=${params.get('sig') || ''}`).then(setData).catch(() => setData({ valid: false })); }, [roll, params]);
  return (
    <div className="mx-auto max-w-3xl p-6">
      <Logo />
      <div className="card mt-6">
        {!data ? 'Checking…' : data.valid ? (
          <>
            <div className="ok-pill mb-3 text-sm">✓ Genuine hall ticket</div>
            <h1 className="text-xl font-bold">{data.name}</h1>
            <p className="mb-4 muted">{data.roll_no} · {data.branch}</p>
            <ExamTable exams={data.exams} />
          </>
        ) : <div className="bad-pill text-sm">✕ This hall ticket could not be verified</div>}
      </div>
    </div>
  );
}
