import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { getScreenContext } from '../assistantContext.js';

export const EXAMPLES = [
  'Why is room MB-001 only half full on 16 Nov AN?',
  'Room CS-204 is under maintenance this week',
  'SRKR0012 is on leave on 2 Dec afternoon',
  'Move B23CS3102 to 25 Nov FN',
  'Which exams are on 28 Nov?',
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
    <div className="rounded-xl border-2 p-3" style={{ borderColor: 'var(--series-1)', background: 'var(--card)' }}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">Proposed change {item.proposal_id}</div>
        <span className={cls}>{label}</span>
      </div>
      <div className="mb-2 text-xs muted">{item.summary}</div>
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

function Result({ item, compact }) {
  const rows = compact ? item.rows.filter((r) => r.changed) : item.rows;
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">Re-planned after {item.proposal_id}</div>
        {item.ok ? <span className="ok-pill">✓ Every hard rule still holds</span> : <span className="bad-pill">Check the results</span>}
      </div>
      <table className="table">
        <thead><tr><th>What</th><th className="text-right">Before</th><th className="text-right">After</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.label} className={r.changed ? 'font-semibold' : ''}>
            <td>{r.label}</td><td className="text-right tabular-nums muted">{r.before}</td>
            <td className="text-right tabular-nums">{r.after}</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}

/** Shared state + actions for the chat, used by the full page and the floating dock. */
export function useAssistant() {
  const [conv, setConv] = useState(null);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const poll = useRef(null);

  const refresh = () => api('/assistant').then(setConv).catch((e) => setError(e.message));
  useEffect(() => { refresh(); return () => clearInterval(poll.current); }, []);

  const call = async (path, body, label) => {
    setBusy(true); setError(''); setWorking(label);
    clearInterval(poll.current);
    // While a re-plan runs, show the pipeline steps as they finish.
    poll.current = setInterval(async () => {
      const p = await api('/pipeline').catch(() => null);
      if (p?.running) setWorking(`${label} ${p.steps.map((s) => `${s.status === 'done' ? '✓' : s.status === 'running' ? '…' : '·'} ${s.name.split(' (')[0]}`).join('   ')}`);
    }, 1500);
    try { setConv(await api(path, { method: 'POST', body })); } catch (e) { setError(e.message); }
    clearInterval(poll.current);
    setBusy(false); setWorking('');
  };

  const send = (text) => {
    if (!text.trim() || busy) return;
    setConv((c) => ({ ...c, items: [...c.items, { id: `pending-${Date.now()}`, kind: 'user', text }] }));
    call('/assistant/message', { text, context: getScreenContext() }, 'Thinking…');
  };
  return {
    conv, busy, working, error, refresh, send,
    apply: (id) => call(`/assistant/proposals/${id}/apply`, {}, 'Applying and re-planning (about a minute)…'),
    reject: (id) => call(`/assistant/proposals/${id}/reject`, {}, ''),
    undo: () => call('/assistant/undo', {}, 'Undoing and re-planning…'),
    reset: () => call('/assistant/reset', {}, ''),
  };
}

export const providerLabel = (conv) => ({
  claude: `Claude${/backup/.test(conv.model) ? ' + Gemini backup' : ''}`,
  gemini: `Gemini${/backup/.test(conv.model) ? ' + Claude backup' : ''}`,
  parser: 'Built-in parser',
}[conv.provider] || conv.model);

/** The message list + input box. `compact` is the floating-dock layout. */
export default function AssistantChat({ chat, compact = false, height = '62vh' }) {
  const { conv, busy, working, error, send, apply, reject } = chat;
  const [text, setText] = useState('');
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [conv?.items.length, working]);
  if (!conv) return <div className="p-6 text-center text-sm muted">Loading…</div>;

  const submit = (e) => { e.preventDefault(); send(text); setText(''); };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: height }}>
        {conv.items.length === 0 && (
          <div className="py-6 text-center">
            <div className="mb-3 text-sm muted">Ask a doubt or give a command. For example:</div>
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLES.slice(0, compact ? 3 : 5).map((ex) => <button key={ex} className="btn-ghost text-xs" onClick={() => setText(ex)}>{ex}</button>)}
            </div>
          </div>
        )}
        {conv.items.map((it) => {
          if (it.kind === 'user') return (
            <div key={it.id} className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-sm bg-navy-700 px-4 py-2 text-sm text-white">{it.text}</div></div>);
          if (it.kind === 'assistant') return (
            <div key={it.id} className="flex"><div className="max-w-[90%] rounded-2xl rounded-bl-sm border px-4 py-2" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}><Text text={it.text} /></div></div>);
          if (it.kind === 'activity') return <div key={it.id} className="pl-2 text-xs muted">🔎 {it.text}</div>;
          if (it.kind === 'error') return <div key={it.id} className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{it.text}</div>;
          if (it.kind === 'proposal') return <Proposal key={it.id} item={it} busy={busy} onApply={apply} onReject={reject} />;
          if (it.kind === 'result') return <Result key={it.id} item={it} compact={compact} />;
          return null;
        })}
        {working && <div className="text-sm muted">{working}</div>}
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div ref={end} />
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t p-3" style={{ borderColor: 'var(--border)' }}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} aria-label="Message the Plan Assistant"
          placeholder={compact ? 'Ask or tell the assistant…' : 'e.g. Room CS-204 has no power, and SRKR0012 cannot come on 2 Dec FN'} />
        <button className="btn-primary" disabled={busy || !text.trim()}>Send</button>
      </form>
    </div>
  );
}
