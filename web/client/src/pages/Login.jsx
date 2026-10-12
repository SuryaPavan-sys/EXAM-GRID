import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Logo } from '../components/Layout.jsx';
import ExamTable from '../components/ExamTable.jsx';

const ROLES = [['admin', 'Exam cell'], ['faculty', 'Faculty'], ['student', 'Student']];
const PLACEHOLDER = { admin: 'admin', faculty: 'Faculty ID, e.g. SRKR0001', student: 'Roll number, e.g. 24B91A0510' };

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState('admin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(null);
  const [roll, setRoll] = useState('');
  const [lookup, setLookup] = useState(null);

  useEffect(() => { api('/auth/demo-accounts').then(setDemo).catch(() => {}); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const u = await login(role, username, password);
      navigate(`/${u.role}`);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const fillDemo = () => { setUsername(demo[role].username); setPassword(demo[role].password); };

  const find = async (e) => {
    e.preventDefault();
    try { setLookup(await api(`/lookup/${encodeURIComponent(roll)}`)); } catch (err) { setLookup({ error: err.message }); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy-50 to-white px-4 py-10 dark:from-[#0f1420] dark:to-[#121417]">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo />
          <h1 className="mt-6 text-3xl font-bold md:text-4xl">Exams planned in seconds, not weeks.</h1>
          <p className="mt-2 max-w-2xl muted">Clash-free timetables, smart seating and fair invigilation for SRKR Engineering
            College - built on graph colouring, machine learning and constraint optimisation.</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <form onSubmit={submit} className="card">
            <h2 className="mb-4 text-lg font-semibold">Log in</h2>
            <div className="mb-4 grid grid-cols-3 gap-1 rounded-lg p-1" style={{ background: 'var(--surface)' }}>
              {ROLES.map(([r, label]) => (
                <button type="button" key={r} onClick={() => { setRole(r); setError(''); setUsername(''); setPassword(''); }}
                  className={`rounded-md py-1.5 text-sm font-medium ${role === r ? 'bg-navy-700 text-white shadow' : ''}`}>{label}</button>
              ))}
            </div>
            <label className="label" htmlFor="u">Username</label>
            <input id="u" className="input mb-3" value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder={PLACEHOLDER[role]} autoComplete="username" />
            <label className="label" htmlFor="p">Password</label>
            <input id="p" type="password" className="input mb-4" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password" />
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
            <button className="btn-primary w-full justify-center" disabled={busy}>{busy ? 'Signing in…' : 'Log in'}</button>
            {demo && (
              <div className="mt-4 rounded-lg border border-dashed p-3 text-xs" style={{ borderColor: 'var(--border)' }}>
                <div className="mb-1 font-semibold">Demo account ({ROLES.find((r) => r[0] === role)[1]})</div>
                <div className="muted">User <code>{demo[role].username}</code> · password <code>{demo[role].password}</code>
                  {demo[role].hint ? ` · ${demo[role].hint}` : ''}</div>
                <button type="button" className="mt-2 font-medium text-navy-500 underline" onClick={fillDemo}>Fill in demo account</button>
              </div>
            )}
          </form>

          <form onSubmit={find} className="card">
            <h2 className="mb-1 text-lg font-semibold">Find my seat</h2>
            <p className="mb-4 text-sm muted">No login needed. Enter your roll number to see where you sit for every exam.</p>
            <div className="flex gap-2">
              <input className="input" value={roll} onChange={(e) => setRoll(e.target.value)} placeholder="e.g. 24B91A0510" />
              <button className="btn-primary">Search</button>
            </div>
            {lookup?.error && <p className="mt-3 text-sm text-red-600">{lookup.error}</p>}
            {lookup?.exams && <div className="mt-4"><div className="mb-2 text-sm font-semibold">{lookup.roll_no}</div>
              <ExamTable exams={lookup.exams} showType={false} /></div>}
          </form>
        </div>

        <div className="mt-8 grid gap-4 text-sm sm:grid-cols-3">
          {[['Timetable', 'DSatur graph colouring: no student ever has two exams in one session.'],
            ['Turnout', 'Ridge regression on past attendance predicts who will really come.'],
            ['Seating & duties', 'Timefold solver: no same-paper neighbours, fair invigilation.']].map(([t, d]) => (
            <div key={t} className="card"><div className="font-semibold">{t}</div><div className="mt-1 muted">{d}</div></div>
          ))}
        </div>
      </div>
    </div>
  );
}
