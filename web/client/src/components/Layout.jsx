import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

const NAV = {
  admin: [['/admin', 'Dashboard'], ['/admin/timetable', 'Timetable'], ['/admin/seating', 'Seating'],
    ['/admin/duties', 'Invigilation'], ['/admin/turnout', 'Turnout model'], ['/admin/data', 'Data & pipeline']],
  faculty: [['/faculty', 'My duties'], ['/faculty/timetable', 'Timetable']],
  student: [['/student', 'My exams'], ['/student/timetable', 'Timetable']],
};

export function Logo({ small }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width={small ? 28 : 36} height={small ? 28 : 36} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#1f3864" />
        <rect x="7" y="7" width="7" height="7" rx="1.5" fill="#fff" /><rect x="18" y="18" width="7" height="7" rx="1.5" fill="#fff" />
        <rect x="18" y="7" width="7" height="7" rx="1.5" fill="#86b6ef" /><rect x="7" y="18" width="7" height="7" rx="1.5" fill="#86b6ef" />
      </svg>
      <div className="leading-tight">
        <div className={`font-bold ${small ? 'text-base' : 'text-xl'}`}>ExamGrid</div>
        <div className="text-[11px] muted">SRKR Engineering College</div>
      </div>
    </div>
  );
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r"
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between p-4 md:block">
          <Logo small />
          <button className="btn-ghost md:hidden" onClick={() => { logout(); navigate('/login'); }}>Log out</button>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:px-3">
          {NAV[user.role].map(([to, label]) => (
            <NavLink key={to} to={to} end
              className={({ isActive }) => `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${isActive
                ? 'bg-navy-700 text-white' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden p-4 md:absolute md:bottom-0 md:block md:w-60">
          <div className="text-sm font-semibold">{user.name}</div>
          <div className="mb-3 text-xs muted capitalize">{user.role} · {user.id}</div>
          <button className="btn-ghost w-full justify-center" onClick={() => { logout(); navigate('/login'); }}>Log out</button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, note, tone }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : 'var(--text)';
  return (
    <div className="card">
      <div className="text-xs font-medium uppercase tracking-wide muted">{label}</div>
      <div className="mt-1 text-3xl font-bold tabular-nums" style={{ color }}>{value}</div>
      {note && <div className="mt-1 text-xs muted">{note}</div>}
    </div>
  );
}

export function Check({ ok, label }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={ok ? 'ok-pill' : 'bad-pill'}>{ok ? '✓ Pass' : '✕ Fail'}</span>
      <span>{label}</span>
    </div>
  );
}

export const Loading = () => <div className="p-10 text-center muted">Loading…</div>;
export const ErrorBox = ({ error }) => error ? <div className="card border-red-300 text-sm text-red-700">{error}</div> : null;
