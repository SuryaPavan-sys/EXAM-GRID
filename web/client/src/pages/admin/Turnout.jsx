import { useEffect, useState } from 'react';
import { api, fmt } from '../../api.js';
import { Bars } from '../../components/charts.jsx';
import { ErrorBox, Loading, PageHeader, Stat } from '../../components/Layout.jsx';

export default function Turnout() {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/summary').then(setD).catch((e) => setError(e.message)); }, []);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;
  const t = d.turnout, s = t.summary || {};
  const effects = Object.entries(t.learned_effects || {}).filter(([k]) => k !== 'backlog vs regular')
    .map(([name, v]) => ({ name, hidden: v.hidden_rule, learned: v.learned }));
  const backlog = t.learned_effects?.['backlog vs regular'];
  return (
    <>
      <PageHeader title="Turnout prediction" subtitle={`Model: ${t.model}. Trained on past cycles, tested on unseen ${t.test_cycle}.`} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Papers registered" value={fmt(s.papers_registered)} />
        <Stat label="Expected to attend" value={fmt(s.expected_present)} note={`${(100 * s.expected_present / s.papers_registered).toFixed(1)}%`} />
        <Stat label="Seats booked" value={fmt(s.seats_booked)} note={`${s.seats_saved_pct}% fewer · margin ${s.safety_margin_pct}% + 3σ`} />
        <Stat label="Invigilator duties" value={`${fmt(s.invigilator_duties_if_all_attend)} → ${fmt(s.invigilator_duties_booked)}`} note={`${s.invigilator_duties_saved_pct}% fewer`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="font-semibold">Backtest on {t.test_cycle} (never seen in training)</h2>
          <p className="mb-3 text-xs muted">Lower is better. "Session error" = how far the total for a whole session was off.</p>
          <table className="table">
            <thead><tr><th>Model</th><th className="text-right">Error / group</th><th className="text-right">Session error</th><th className="text-right">Worst under</th></tr></thead>
            <tbody>{Object.entries(t.backtest || {}).map(([name, m]) => (
              <tr key={name} className={name === t.model ? 'font-semibold' : ''}>
                <td>{name}{name === t.model && <span className="ml-2 ok-pill">chosen</span>}</td>
                <td className="text-right tabular-nums">{m.mae_rate_points} pts</td>
                <td className="text-right tabular-nums">{m.session_mape_pct}%</td>
                <td className="text-right tabular-nums">{m.session_worst_under_pct}%</td>
              </tr>))}</tbody>
          </table>
        </div>
        <div className="card">
          <h2 className="font-semibold">Did the model learn the real pattern?</h2>
          <p className="mb-3 text-xs muted">Effect on attendance (percentage points). The data was generated from a hidden rule; the model rediscovers it.
            Backlog vs regular: hidden {backlog?.hidden_rule}, learned {backlog?.learned}.</p>
          <Bars data={effects} x="name" layout="vertical" series={[['hidden', 'Hidden rule'], ['learned', 'Learned by model']]}
            height={340} unit=" pts" />
        </div>
      </div>
      <div className="card mt-4 text-sm muted">
        Why the saving is modest: about 97% of papers belong to regular students who attend ~95% of the time, and the seat
        booking keeps a safety margin so nobody is ever left without a seat. Savings grow with more supply students or higher absenteeism.
      </div>
    </>
  );
}
