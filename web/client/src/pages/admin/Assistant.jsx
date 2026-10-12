import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { ErrorBox, Loading, PageHeader } from '../../components/Layout.jsx';

const EXAMPLES = [
  'Room CS-204 is under maintenance this week',
  'SRKR0012 is on leave on 2 Dec afternoon',
  'Declare 28 Nov a holiday',
  'Move B23CS3102 to 25 Nov FN',
  'Which sessions use room MB-001?',
];

/** Tiny safe renderer for **bold**, "- " lists and line breaks (no HTML injection). */
function Text({ text }) {
  const bold = (line) => line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part);
  const blocks = [];
  let list = [];
  const flush = () => { if (list.length) blocks.push(<ul key={blocks.length} className="my-1 list-disc pl-5">{list}</ul>); list = []; };
  text.split('\n').forEach((line, i) => {
    if (/^\s*[-*] /.test(line)) list.push(<li key={i}>{bold(line.replace(/^\s*[-*] /, ''))}</li>);
    else { flush(); if (line.trim()) blocks.push(<p key={`p${i}`} className="my-1">{bold(line)}</p>); }
  });
  flush();
  return <div className="text-sm leading-relaxed">{blocks}</div>;
}

const STATUS = {
  pending: ['info-pill', 'Waiting for your approval'], applying: ['pill bg-amber-100 text-amber-800', 'Applying and re-planning…'],
  applied: ['ok-pill', 'Applied'], rejected: ['pill bg-gray-200 text-gray-700', 'Rejected'],
  undone: ['pill bg-gray-200 text-gray-700', 'Undone'], failed: ['bad-pill', 'Failed - rolled back'],
};

function Proposal({ item, onApply, onReject, busy }) {
  const [cls, label] = STATUS[item.status] || STATUS.pending;
  return (
    <div className="rounded-xl border-2 p-4" style={{ borderColor: 'var(--series-1)', background: 'var(--card)' }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">Proposed change {item.proposal_id}</div>
        <span className={cls}>{label}</span>
      </div>
      <div className="mb-2 text-sm muted">{item.summary}</div>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm">{item.changes.map((c, i) => <li key={i}>{c}</li>)}</ol>
      {item.status === 'pending' && (
        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy} onClick={() => onApply(item.proposal_id)}>Apply &amp; re-plan</button>
          <button className="btn-ghost" disabled={busy} onClick={() => onReject(item.proposal_id)}>Reject</button>
        </div>
      )}
      {item.error && <div className="mt-2 text-sm text-red-600">{item.error}</div>}
    </div>
  );
}

function Result({ item }) {
  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-semibold">Re-planned after {item.proposal_id}</div>
        {item.ok ? <span className="ok-pill">✓ Every hard rule still holds</span> : <span className="bad-pill">Check the results</span>}
      </div>
      <table className="table">
        <thead><tr><th>What</th><th className="text-right">Before</th><th className="text-right">After</th></tr></thead>
        <tbody>{item.rows.map((r) => (
          <tr key={r.label} className={r.changed ? 'font-semibold' : ''}>
            <td>{r.label}</td><td className="text-right tabular-nums muted">{r.before}</td>
            <td className="text-right tabular-nums">{r.after}{r.changed && <span className="ml-1 text-xs" style={{ color: 'var(--series-1)' }}>●</span>}</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}

export default function Assistant() {
  const [conv, setConv] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const end = useRef(null);
  const poll = useRef(null);

  useEffect(() => { api('/assistant').then(setConv).catch((e) => setError(e.message)); return () => clearInterval(poll.current); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [conv?.items.length, working]);

  const call = async (path, body, label) => {
    setBusy(true); setError(''); setWorking(label);
    // While a re-plan runs, show the pipeline steps as they finish.
    clearInterval(poll.current);
    poll.current = setInterval(async () => {
      const p = await api('/pipeline').catch(() => null);
      if (p?.running) setWorking(`${label} ${p.steps.map((s) => `${s.status === 'done' ? '✓' : s.status === 'running' ? '…' : '·'} ${s.name.split(' (')[0]}`).join('   ')}`);
    }, 1500);
    try { setConv(await api(path, { method: 'POST', body })); } catch (e) { setError(e.message); }
    clearInterval(poll.current);
    setBusy(false); setWorking('');
  };
  const send = (e) => {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    const t = text; setText('');
    setConv((c) => ({ ...c, items: [...c.items, { id: 'pending', kind: 'user', text: t }] }));
    call('/assistant/message', { text: t }, 'Thinking…');
  };

  if (!conv) return error ? <ErrorBox error={error} /> : <Loading />;
  return (
    <>
      <PageHeader title="Plan Assistant"
        subtitle="Tell the assistant about a problem or a change in plain words. It proposes checked changes; nothing changes until you press Apply."
        actions={<>
          <span className={conv.llm ? 'ok-pill self-center' : 'info-pill self-center'}>{conv.llm ? `Claude (${conv.model})` : 'Built-in parser'}</span>
          <button className="btn-ghost" disabled={busy || !conv.can_undo} onClick={() => call('/assistant/undo', {}, 'Undoing and re-planning…')}>Undo last change</button>
          <button className="btn-ghost" disabled={busy} onClick={() => call('/assistant/reset', {}, '')}>New chat</button>
        </>} />

      {!conv.llm && (
        <div className="card mb-4 text-sm">
          <b>Free-form chat with Claude is off.</b> The built-in parser handles clear requests like the examples below.
          To chat in any wording, add your Claude API key to <code>web/server/.env</code> (copy <code>.env.example</code>) and restart.
        </div>
      )}

      <div className="card flex min-h-[60vh] flex-col p-0">
        <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: '62vh' }}>
          {conv.items.length === 0 && (
            <div className="py-8 text-center">
              <div className="mb-3 text-sm muted">Try one of these:</div>
              <div className="flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((ex) => <button key={ex} className="btn-ghost text-xs" onClick={() => setText(ex)}>{ex}</button>)}
              </div>
            </div>
          )}
          {conv.items.map((it) => {
            if (it.kind === 'user') return (
              <div key={it.id} className="flex justify-end"><div className="max-w-[80%] rounded-2xl rounded-br-sm bg-navy-700 px-4 py-2 text-sm text-white">{it.text}</div></div>);
            if (it.kind === 'assistant') return (
              <div key={it.id} className="flex"><div className="max-w-[85%] rounded-2xl rounded-bl-sm border px-4 py-2" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}><Text text={it.text} /></div></div>);
            if (it.kind === 'activity') return <div key={it.id} className="pl-2 text-xs muted">🔎 {it.text}</div>;
            if (it.kind === 'error') return <div key={it.id} className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{it.text}</div>;
            if (it.kind === 'proposal') return <Proposal key={it.id} item={it} busy={busy}
              onApply={(id) => call(`/assistant/proposals/${id}/apply`, {}, 'Applying and re-planning (about a minute)…')}
              onReject={(id) => call(`/assistant/proposals/${id}/reject`, {}, '')} />;
            if (it.kind === 'result') return <Result key={it.id} item={it} />;
            return null;
          })}
          {working && <div className="text-sm muted">{working}</div>}
          {error && <div className="text-sm text-red-600">{error}</div>}
          <div ref={end} />
        </div>
        <form onSubmit={send} className="flex gap-2 border-t p-3" style={{ borderColor: 'var(--border)' }}>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
            placeholder="e.g. Room CS-204 has no power, and SRKR0012 cannot come on 2 Dec FN" />
          <button className="btn-primary" disabled={busy || !text.trim()}>Send</button>
        </form>
      </div>
    </>
  );
}
