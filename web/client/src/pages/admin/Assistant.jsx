import { PageHeader } from '../../components/Layout.jsx';
import AssistantChat, { providerLabel, useAssistant } from '../../components/AssistantChat.jsx';

export default function Assistant() {
  const chat = useAssistant();
  const { conv, busy } = chat;
  return (
    <>
      <PageHeader title="Plan Assistant"
        subtitle="Ask any doubt about the plan, or tell it what to change. It proposes checked changes; nothing changes until you press Apply."
        actions={conv && <>
          <span className={conv.llm ? 'ok-pill self-center' : 'info-pill self-center'}>{providerLabel(conv)}</span>
          <button className="btn-ghost" disabled={busy || !conv.can_undo} onClick={chat.undo}>Undo last change</button>
          <button className="btn-ghost" disabled={busy} onClick={chat.reset}>New chat</button>
        </>} />
      {conv && !conv.llm && <SetupNote />}
      <div className="card flex min-h-[60vh] flex-col p-0"><AssistantChat chat={chat} /></div>
    </>
  );
}

export function SetupNote() {
  return (
    <div className="card mb-4 text-sm">
      <b>The LLM is not connected yet</b>, so only clear commands work (no questions). To connect the <b>free</b> Gemini model:
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Open <code>aistudio.google.com/apikey</code>, sign in with Google and click <b>Create API key</b>.</li>
        <li>In <code>web/server</code>, copy <code>.env.example</code> to <code>.env</code> and paste the key after <code>GEMINI_API_KEY=</code>.</li>
        <li>Restart the website (<code>start.cmd</code>).</li>
      </ol>
      <p className="mt-2 muted">Free-tier note: Google may use free-tier prompts to improve its products - fine for this demo data, not for real student records.</p>
    </div>
  );
}
