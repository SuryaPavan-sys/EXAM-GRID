import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { onScreenContext, setScreenContext } from '../assistantContext.js';
import AssistantChat, { providerLabel, useAssistant } from './AssistantChat.jsx';

const PAGE_NAMES = { '/admin': 'Dashboard', '/admin/timetable': 'Timetable', '/admin/seating': 'Seating plan',
  '/admin/duties': 'Invigilation', '/admin/turnout': 'Turnout model', '/admin/data': 'Data & pipeline' };

/** Floating "Ask ExamGrid" chat on every admin page (hidden on the full assistant page). */
export default function AssistantDock() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState({});
  const chat = useAssistant();

  // Default context = the page name; pages like Seating add the room/session on top.
  useEffect(() => { setScreenContext({ page: PAGE_NAMES[pathname] || pathname }); }, [pathname]);
  useEffect(() => onScreenContext(setCtx), []);
  useEffect(() => { if (open) chat.refresh(); }, [open]); // pick up messages sent from the full page

  if (pathname === '/admin/assistant') return null;
  return (
    <>
      {open && (
        <div role="dialog" aria-label="Plan Assistant"
          className="fixed bottom-20 right-4 z-40 flex w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border shadow-2xl"
          style={{ background: 'var(--card)', borderColor: 'var(--border)', height: 'min(620px, calc(100vh - 7rem))' }}>
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <div>
              <div className="text-sm font-semibold">Plan Assistant</div>
              <div className="text-[11px] muted">
                {chat.conv ? providerLabel(chat.conv) : '…'}{ctx.room_id ? ` · sees ${ctx.room_id}${ctx.date ? ` ${ctx.date} ${ctx.session}` : ''}` : ctx.page ? ` · on ${ctx.page}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Link to="/admin/assistant" className="btn-ghost px-2 py-1 text-xs" onClick={() => setOpen(false)}>Full view</Link>
              <button className="btn-ghost px-2 py-1 text-xs" aria-label="Close" onClick={() => setOpen(false)}>✕</button>
            </div>
          </div>
          {chat.conv && !chat.conv.llm && (
            <div className="border-b px-4 py-2 text-xs muted" style={{ borderColor: 'var(--border)' }}>
              LLM not connected - only clear commands work. <Link className="underline" to="/admin/assistant" onClick={() => setOpen(false)}>Connect free Gemini</Link>
            </div>
          )}
          <AssistantChat chat={chat} compact height="100%" />
        </div>
      )}
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-navy-700 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-navy-600">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
        {open ? 'Close' : 'Ask ExamGrid'}
      </button>
    </>
  );
}
