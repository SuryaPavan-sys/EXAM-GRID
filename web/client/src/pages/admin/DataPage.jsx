import { useEffect, useRef, useState } from 'react';
import { api, fmt } from '../../api.js';
import { PageHeader } from '../../components/Layout.jsx';

const STATUS = { idle: 'muted', waiting: 'muted', running: 'text-amber-600', done: 'text-green-700', failed: 'text-red-600' };

export default function DataPage() {
  const [summary, setSummary] = useState(null);
  const [type, setType] = useState('registrations');
  const [result, setResult] = useState(null);
  const [fileName, setFileName] = useState('');
  const [pipe, setPipe] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    api('/summary').then(setSummary);
    api('/pipeline').then(setPipe);
    return () => clearInterval(timer.current);
  }, []);

  const validate = async (csv, name) => {
    setFileName(name);
    setResult(await api('/import/validate', { method: 'POST', body: { type, csv } }));
  };
  const onFile = async (e) => {
    const f = e.target.files[0];
    if (f) validate(await f.text(), f.name);
    e.target.value = '';
  };
  const trySample = async () => {
    const { csv, name } = await api(`/import/sample/${type}`);
    validate(csv, name);
  };

  const poll = () => {
    clearInterval(timer.current);
    timer.current = setInterval(async () => {
      const s = await api('/pipeline');
      setPipe(s);
      if (!s.running) { clearInterval(timer.current); api('/summary').then(setSummary); }
    }, 1500);
  };
  const run = async () => { setPipe(await api('/pipeline/run', { method: 'POST' })); poll(); };

  const c = summary?.counts;
  return (
    <>
      <PageHeader title="Data & pipeline" subtitle="Validate uploads, then re-plan the whole exam cycle in one click." />
      {c && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[['Students', c.students], ['Subjects', c.subjects], ['Registrations', c.registrations], ['Supply papers', c.backlog],
            ['Rooms', c.rooms], ['Faculty', c.faculty]].map(([k, v]) => (
            <div key={k} className="card py-3"><div className="text-xs muted">{k}</div><div className="text-xl font-bold tabular-nums">{fmt(v)}</div></div>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="font-semibold">1 · Validate a CSV upload</h2>
          <p className="mb-3 text-sm muted">Every row is checked before it is accepted: duplicates, unknown students or subjects, wrong values.</p>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input max-w-[180px]" value={type} onChange={(e) => { setType(e.target.value); setResult(null); }}>
              <option value="students">students.csv</option><option value="registrations">registrations.csv</option><option value="rooms">rooms.csv</option>
            </select>
            <label className="btn-primary cursor-pointer">Choose file<input type="file" accept=".csv" className="hidden" onChange={onFile} /></label>
            <button className="btn-ghost" onClick={trySample}>Try a file with mistakes</button>
          </div>
          {result && (
            <div className="mt-4">
              <div className="mb-2 text-sm"><span className="font-semibold">{fileName}</span> · {result.rows} rows ·{' '}
                {result.ok ? <span className="ok-pill">✓ valid</span> : <span className="bad-pill">{result.errors.length} problems</span>}</div>
              {!result.ok && (
                <table className="table">
                  <thead><tr><th>Row</th><th>Column</th><th>Problem</th></tr></thead>
                  <tbody>{result.errors.slice(0, 50).map((e, i) => <tr key={i}><td>{e.row}</td><td className="font-mono text-xs">{e.column}</td><td>{e.error}</td></tr>)}</tbody>
                </table>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="font-semibold">2 · Re-plan the exam cycle</h2>
          <p className="mb-3 text-sm muted">Runs the three engines in order and reloads the website with the new plan (about a minute).</p>
          <button className="btn-primary" onClick={run} disabled={pipe?.running}>{pipe?.running ? 'Running…' : 'Run full pipeline'}</button>
          <ol className="mt-4 space-y-3">
            {(pipe?.steps || []).map((s, i) => (
              <li key={s.name} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
                <div className="flex justify-between text-sm"><span className="font-medium">{i + 1}. {s.name}</span>
                  <span className={`font-semibold capitalize ${STATUS[s.status]}`}>{s.status}{s.seconds ? ` · ${s.seconds}s` : ''}</span></div>
                {s.log && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded p-2 text-[11px]" style={{ background: 'var(--surface)' }}>{s.log.trim().split('\n').slice(-12).join('\n')}</pre>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </>
  );
}
