// Plan Assistant: the exam cell chats in plain language; the assistant looks things up and
// proposes checked changes. Nothing changes until the admin presses Apply, which edits the data,
// re-runs the whole pipeline and reports what changed.
//
// Which LLM answers (keys go in web/server/.env):
//   GEMINI_API_KEY    -> Google Gemini (free tier available)          [preferred when set]
//   ANTHROPIC_API_KEY -> Claude
//   neither           -> built-in parser for clear commands
// ASSISTANT_PROVIDER=gemini|claude|parser forces one when several are configured.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { ApiError as GeminiApiError, GoogleGenAI } from '@google/genai';
import { ACTION_TYPES, applyActions, checkSubjectMove, examDays, lastBackup, snapshot, undoLast, validateAction } from './planChanges.js';
import { pipelineState, runPipelineAndWait } from './pipeline.js';
import { store } from './store.js';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../var/assistant.json');
const CLAUDE_MODEL = 'claude-opus-5-5';
const geminiModel = () => process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const MAX_TOOL_ROUNDS = 8;

const geminiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const claudeKey = () => process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
export function provider() {
  const forced = (process.env.ASSISTANT_PROVIDER || '').toLowerCase();
  if (forced === 'gemini' && geminiKey()) return 'gemini';
  if (forced === 'claude' && claudeKey()) return 'claude';
  if (forced === 'parser') return 'parser';
  return geminiKey() ? 'gemini' : claudeKey() ? 'claude' : 'parser';
}
export const llmEnabled = () => provider() !== 'parser';
const modelName = () => ({ gemini: geminiModel(), claude: CLAUDE_MODEL, parser: 'built-in parser' }[provider()]);

let client = null;
const claude = () => (client ??= new Anthropic());
let geminiClient = null;
const gemini = () => (geminiClient ??= new GoogleGenAI({ apiKey: geminiKey() }));
/** Tests swap in a stub client so the tool loop can be checked without a network call. */
export const _setGeminiClientForTests = (c) => { geminiClient = c; };

// ------------------------------------------------------------------ conversation state
// history = Claude-format turns, contents = Gemini-format turns. Both are append-only.
let state = load();
function load() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { contents: [], ...s };
  } catch { return { history: [], contents: [], items: [], proposals: {} }; }
}

/** Tell whichever model answers next what happened outside the chat (applies, undos). */
function note(text) {
  state.history.push({ role: 'user', content: text });
  const last = state.contents[state.contents.length - 1];
  if (last?.role === 'user') last.parts.push({ text });
  else state.contents.push({ role: 'user', parts: [{ text }] });
}
function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}
const now = () => new Date().toISOString();
function addItem(item) {
  const full = { id: crypto.randomUUID().slice(0, 8), at: now(), ...item };
  state.items.push(full);
  return full;
}

export function getConversation() {
  return { items: state.items, llm: llmEnabled(), provider: provider(), model: modelName(),
    pipeline: pipelineState(), can_undo: Boolean(lastBackup()) };
}

export function resetConversation() {
  state = { history: [], contents: [], items: [], proposals: {} };
  save();
  return getConversation();
}

// ------------------------------------------------------------------ lookups shared by both modes
const sessionsOf = () => store.config.sessions || [];
const facultyRow = (f) => ({ faculty_id: f.faculty_id, name: f.name, department: f.department, designation: f.designation });

const lookups = {
  get_plan_overview() {
    const tt = store.timetableReport, seat = store.solverReport.seating || {}, duty = store.solverReport.duties?.checks || {};
    return {
      college: store.config.college, exam_cycle: store.config.exam_cycle,
      window: { start: store.config.start_date, last_allowed: store.config.last_allowed_date,
        holidays: store.config.holidays || [], exam_days_available: examDays().length },
      sessions: sessionsOf(), pinned_subjects: store.config.fixed_slots || {},
      students: store.students.size, papers: store.registrations.length, subjects: store.timetable.length,
      timetable: { days_used: tt.exam_days_used, sessions_used: tt.sessions_used, first: tt.first_exam, last: tt.last_exam,
        clashes: tt.clashes_same_session, regular_two_exams_same_day: tt.regular_students_two_exams_same_day,
        backlog_two_exams_same_day: tt.backlog_students_two_exams_same_day, pct_back_to_back: tt.pct_students_with_back_to_back,
        seats_per_session: tt.seats_per_session },
      seating: seat, invigilation: duty,
      rooms: { total: store.rooms.size, unusable: [...store.rooms.values()].filter((r) => r.exam_usable !== 'yes').map((r) => r.room_id) },
    };
  },
  get_session({ date, session }) {
    const rooms = store.roomsOfSession(date, session);
    const subjects = store.timetable.filter((t) => t.exam_date === date && t.session === session)
      .map((t) => ({ subject_code: t.subject_code, subject_name: t.subject_name, department: t.department, year: t.year, students: t.students }));
    if (!subjects.length) return { error: `no exams on ${date} ${session}` };
    return { date, session, subjects, rooms: rooms.map((r) => ({ room_id: r.room_id, seated: r.seated, capacity: r.capacity,
      papers: Object.keys(r.subjects).length, invigilators: r.invigilators })) };
  },
  get_room({ room_id }) {
    const room = store.rooms.get(String(room_id).toUpperCase());
    if (!room) return { error: `room ${room_id} not found` };
    const uses = [...store.seating.entries()].filter(([k]) => k.endsWith(`|${room.room_id}`))
      .map(([k, seats]) => { const [date, session] = k.split('|'); return { date, session, seated: seats.size }; })
      .sort((a, b) => (a.date + a.session).localeCompare(b.date + b.session));
    return { ...room, sessions_in_use: uses.length, uses };
  },
  find_faculty({ query }) {
    const q = String(query).toLowerCase();
    const hits = [...store.faculty.values()].filter((f) => `${f.faculty_id} ${f.name} ${f.department}`.toLowerCase().includes(q));
    return { matches: hits.slice(0, 15).map(facultyRow), total: hits.length };
  },
  get_faculty({ faculty_id }) {
    const f = store.faculty.get(String(faculty_id).toUpperCase());
    if (!f) return { error: `faculty ${faculty_id} not found` };
    return { ...facultyRow(f), max_duties: f.max_duties, teaches: [...(store.teaches.get(f.faculty_id) || [])],
      leave: store.leave.filter((l) => l.faculty_id === f.faculty_id), duties: store.facultyDuties(f.faculty_id)
        .map((d) => ({ date: d.exam_date, session: d.session, room_id: d.room_id, students: d.students_seated })) };
  },
  find_subject({ query }) {
    const q = String(query).toLowerCase();
    const hits = store.timetable.filter((t) => `${t.subject_code} ${t.subject_name}`.toLowerCase().includes(q));
    return { matches: hits.slice(0, 20).map((t) => ({ subject_code: t.subject_code, subject_name: t.subject_name,
      department: t.department, year: t.year, date: t.exam_date, session: t.session, students: t.students,
      offered_to: store.subjects.get(t.subject_code)?.offered_to })), total: hits.length };
  },
  get_subject({ subject_code }) {
    const t = store.slotOf.get(String(subject_code).toUpperCase());
    if (!t) return { error: `subject ${subject_code} not in the timetable` };
    const s = store.subjects.get(t.subject_code) || {};
    const rooms = [...store.seating.entries()].filter(([k, seats]) => k.startsWith(`${t.exam_date}|${t.session}|`)
      && [...seats.values()].some((x) => x.subject_code === t.subject_code)).map(([k]) => k.split('|')[2]);
    return { subject_code: t.subject_code, subject_name: t.subject_name, department: t.department, year: t.year,
      category: t.category, offered_to: s.offered_to, date: t.exam_date, weekday: t.weekday, session: t.session,
      students: t.students, regular: t.regular, backlog: t.backlog, rooms, pinned: Boolean(store.config.fixed_slots?.[t.subject_code]) };
  },
  check_subject_move({ subject_code, date, session }) {
    return checkSubjectMove(String(subject_code).toUpperCase(), date, session);
  },
};

// ------------------------------------------------------------------ proposals & applying
function propose(summary, actions) {
  const checked = actions.map((a) => ({ action: a, ...validateAction(a) }));
  const errors = checked.filter((c) => !c.ok);
  if (errors.length) return { proposal: null, errors: errors.map((e) => ({ action: e.action, error: e.error })) };
  const id = `P${Object.keys(state.proposals).length + 1}`;
  state.proposals[id] = { id, summary, actions, status: 'pending', created_at: now() };
  addItem({ kind: 'proposal', proposal_id: id, summary, changes: checked.map((c) => c.description), actions, status: 'pending' });
  return { proposal: id, changes: checked.map((c) => c.description) };
}

function setProposalStatus(id, status, extra = {}) {
  state.proposals[id].status = status;
  const item = state.items.find((i) => i.kind === 'proposal' && i.proposal_id === id);
  if (item) Object.assign(item, { status, ...extra });
}

const describe = (before, after) => {
  const rows = [
    ['Timetable clashes', before.clashes, after.clashes], ['Regular students with 2 exams in a day', before.regular_same_day, after.regular_same_day],
    ['Supply students FN+AN same day', before.backlog_same_day, after.backlog_same_day], ['Exam days used', before.exam_days, after.exam_days],
    ['Last exam', before.last_exam, after.last_exam], ['Students with back-to-back days (%)', before.back_to_back_pct, after.back_to_back_pct],
    ['Papers seated', before.seated, after.seated], ['Unseated', before.unseated, after.unseated],
    ['Same-paper neighbours', before.neighbours, after.neighbours], ['Room-sessions used', before.room_sessions, after.room_sessions],
    ['Invigilation duties', before.duties, after.duties], ['Own-subject duties', before.own_subject, after.own_subject],
    ['Duties on leave', before.on_leave, after.on_leave],
  ];
  for (const k of new Set([...Object.keys(before.facts), ...Object.keys(after.facts)])) rows.push([k, before.facts[k] ?? '-', after.facts[k] ?? '-']);
  return rows.map(([label, b, a]) => ({ label, before: b ?? '-', after: a ?? '-', changed: String(b) !== String(a) }));
};

export async function applyProposal(id, by) {
  const p = state.proposals[id];
  if (!p) throw Object.assign(new Error('proposal not found'), { status: 404 });
  if (p.status !== 'pending') throw Object.assign(new Error(`proposal is already ${p.status}`), { status: 409 });
  const recheck = p.actions.map(validateAction).find((c) => !c.ok);
  if (recheck) throw Object.assign(new Error(`no longer valid: ${recheck.error}`), { status: 409 });

  const before = snapshot(p.actions);
  setProposalStatus(id, 'applying');
  save();
  const backup = applyActions(p.actions);
  const run = await runPipelineAndWait();
  if (!run.ok) {
    undoLast();
    await runPipelineAndWait();
    const failed = run.steps.find((s) => s.status === 'failed');
    setProposalStatus(id, 'failed', { error: `${failed?.name} failed - change rolled back` });
    const text = `The re-plan failed at "${failed?.name}", so I rolled the change back.\n\n${(failed?.log || '').trim().split('\n').slice(-6).join('\n')}`;
    addItem({ kind: 'assistant', text });
    note(`[Exam cell] Applied ${id}, but the re-plan failed and was rolled back:\n${failed?.log?.slice(-1500) || ''}`);
    save();
    return getConversation();
  }
  const after = snapshot(p.actions);
  const rows = describe(before, after);
  setProposalStatus(id, 'applied', { applied_by: by, backup });
  addItem({ kind: 'result', proposal_id: id, rows, ok: after.clashes === 0 && after.neighbours === 0 && after.unseated === 0 && after.own_subject === 0 });
  // Tell the model what happened so later answers build on the new plan (history is append-only).
  note(`[Exam cell] ${by} applied ${id}. The whole plan was re-generated. Before -> after:\n`
    + rows.filter((r) => r.changed || /clash|neighbour|Unseated|own-subject|leave/i.test(r.label)).map((r) => `- ${r.label}: ${r.before} -> ${r.after}`).join('\n'));
  save();
  return getConversation();
}

export function rejectProposal(id) {
  const p = state.proposals[id];
  if (!p || p.status !== 'pending') throw Object.assign(new Error('no pending proposal with that id'), { status: 404 });
  setProposalStatus(id, 'rejected');
  note(`[Exam cell] Rejected ${id}; do not apply it.`);
  save();
  return getConversation();
}

export async function undo(by) {
  const last = undoLast();
  if (!last) throw Object.assign(new Error('nothing to undo'), { status: 400 });
  await runPipelineAndWait();
  const p = Object.values(state.proposals).find((x) => x.status === 'applied' && JSON.stringify(x.actions) === JSON.stringify(last.actions));
  if (p) setProposalStatus(p.id, 'undone');
  addItem({ kind: 'assistant', text: `Undone by ${by}. The data is back to how it was before${p ? ` ${p.id}` : ''}, and the plan was re-generated.` });
  note(`[Exam cell] ${by} undid the last applied change${p ? ` (${p.id})` : ''}; the plan was re-generated.`);
  save();
  return getConversation();
}

// ------------------------------------------------------------------ Claude mode
const nullable = (type, extra = {}) => ({ type: [type, 'null'], ...extra });
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const TOOLS = [
  { name: 'get_plan_overview', description: 'Key facts and rule checks for the whole current plan: exam window, holidays, pinned subjects, timetable/seating/invigilation results, unusable rooms.', input_schema: obj({}) },
  { name: 'get_session', description: 'Subjects and rooms (with invigilators) of one exam session.', input_schema: obj({ date: { type: 'string', description: 'YYYY-MM-DD' }, session: { type: 'string', enum: ['FN', 'AN'] } }) },
  { name: 'get_room', description: 'A room: block, floor, seats, whether it is exam-usable, and every session it is used in.', input_schema: obj({ room_id: { type: 'string', description: 'e.g. CS-204' } }) },
  { name: 'find_faculty', description: 'Search faculty by name, ID or department. Use before get_faculty when the admin gives a name.', input_schema: obj({ query: { type: 'string' } }) },
  { name: 'get_faculty', description: 'A faculty member: subjects they teach, leave, and all their invigilation duties.', input_schema: obj({ faculty_id: { type: 'string', description: 'e.g. SRKR0012' } }) },
  { name: 'find_subject', description: 'Search scheduled subjects by code or name, with their current slot.', input_schema: obj({ query: { type: 'string' } }) },
  { name: 'get_subject', description: 'A subject: current slot, students (regular/backlog), rooms, whether it is pinned.', input_schema: obj({ subject_code: { type: 'string' } }) },
  { name: 'check_subject_move', description: 'Before proposing move_subject: what the target slot would collide with in the current plan.', input_schema: obj({ subject_code: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, session: { type: 'string', enum: ['FN', 'AN'] } }) },
  {
    name: 'propose_changes',
    description: 'Propose changes to the exam data. They are validated and shown to the admin with an Apply button - they are NOT applied until the admin approves, after which the whole plan is regenerated. Unused fields must be null.',
    input_schema: obj({
      summary: { type: 'string', description: 'One sentence describing the change for the admin' },
      actions: {
        type: 'array', minItems: 1,
        items: obj({
          type: { type: 'string', enum: ACTION_TYPES, description: 'set_room_availability(room_id, usable) | add_faculty_leave(faculty_id, date, session FN/AN/BOTH) | add_holiday(date) | move_subject(subject_code, date, session FN/AN; pins it) | unpin_subject(subject_code) | set_last_exam_date(date)' },
          room_id: nullable('string'), usable: nullable('boolean'), faculty_id: nullable('string'),
          subject_code: nullable('string'), date: nullable('string', { description: 'YYYY-MM-DD' }),
          session: nullable('string', { enum: ['FN', 'AN', 'BOTH', null] }),
        }),
      },
    }),
  },
].map((t) => ({ ...t, strict: true }));

function systemPrompt() {
  const c = store.config;
  return `You are the Plan Assistant inside ExamGrid, the exam-planning system of ${c.college}.
You talk with the exam cell admin about the ${c.exam_cycle}: exam window ${c.start_date} to ${c.last_allowed_date}, no ${(c.exclude_weekdays || []).join('/')}, sessions ${(c.sessions || []).map((s) => `${s.code} ${s.start}-${s.end}`).join(', ')}.

ExamGrid builds the plan automatically: a DSatur graph-colouring timetable (no student has two papers in one session; regular students at most one exam a day; supply students may write FN+AN on one day as a last resort), a turnout model, Timefold seating (no same-paper neighbours, ground-floor needs) and Timefold invigilation (never own subject, never on leave, duty caps, fair load).

How to work:
- Look things up with the tools before stating facts about the plan; never guess codes, IDs, dates or numbers.
- When the admin reports a problem or asks for a change that the actions can express (room unavailable/available, faculty leave, holiday, move or unpin a subject, change the last exam date), call propose_changes. Resolve names to IDs first (find_faculty / find_subject); if a name or subject is ambiguous, ask which one. For a subject move, call check_subject_move first and mention what it will displace.
- Proposals are applied only when the admin presses Apply; never say a change is done until you are told it was applied. After an apply, the whole plan is re-generated and you will receive the before/after numbers.
- If a request cannot be expressed with the actions (for example swapping two individual students' seats, or changing a hard rule), say so plainly and point to the right screen (Seating editor, Data & pipeline) or what the developer would need to change.
- A message may end with a [Screen context: ...] note saying which page, room or session the admin is looking at; use it to resolve "this room", "this session" and similar.
- Dates the admin gives without a year are in ${c.start_date.slice(0, 4)}. Answer briefly and concretely, in plain language, using short lists where helpful.`;
}

async function chatWithClaude(text) {
  state.history.push({ role: 'user', content: text });
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let response;
    try {
      response = await claude().beta.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        cache_control: { type: 'ephemeral' },
        system: systemPrompt(),
        tools: TOOLS,
        messages: state.history,
      });
    } catch (e) {
      const status = e instanceof Anthropic.APIError ? ` (${e.status})` : '';
      const hint = e instanceof Anthropic.AuthenticationError ? ' Check the API key in web/server/.env.'
        : e instanceof Anthropic.RateLimitError ? ' Rate limited - try again in a minute.' : '';
      // Drop the unanswered user turn so the history stays valid for the next try.
      if (round === 0) state.history.pop();
      addItem({ kind: 'error', text: `Claude request failed${status}: ${e.message}.${hint}` });
      return;
    }
    state.history.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'refusal') {
      addItem({ kind: 'error', text: 'Claude declined to answer this request.' });
      return;
    }
    const said = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    const calls = response.content.filter((b) => b.type === 'tool_use');
    if (said) addItem({ kind: 'assistant', text: said });
    if (response.stop_reason !== 'tool_use' || !calls.length) {
      if (response.stop_reason === 'max_tokens') addItem({ kind: 'error', text: 'The reply was cut off (too long).' });
      return;
    }

    const results = [];
    for (const call of calls) {
      const result = runTool(call.name, call.input);
      results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result).slice(0, 20000),
        ...(result?.error || result?.errors ? { is_error: true } : {}) });
    }
    state.history.push({ role: 'user', content: results });
    save();
  }
  addItem({ kind: 'error', text: 'Stopped after too many lookups - please ask a narrower question.' });
}

/** Run one tool call from either model; lookups answer directly, propose_changes only proposes. */
function runTool(name, input = {}) {
  try {
    if (name === 'propose_changes') {
      const actions = (input.actions || []).map((a) => Object.fromEntries(Object.entries(a).filter(([, v]) => v !== null && v !== undefined)));
      const result = propose(input.summary || 'Change request', actions);
      addItem({ kind: 'activity', text: result.proposal ? `Proposed ${result.proposal}` : 'Proposal needed fixing' });
      return result;
    }
    if (lookups[name]) {
      addItem({ kind: 'activity', text: activityLabel(name, input) });
      return lookups[name](input);
    }
    return { error: `unknown tool ${name}` };
  } catch (e) {
    return { error: e.message };
  }
}

// ------------------------------------------------------------------ Gemini mode
const GEMINI_TOOLS = [{
  functionDeclarations: TOOLS.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema })),
}];

async function chatWithGemini(text) {
  state.contents.push({ role: 'user', parts: [{ text }] });
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let response;
    try {
      response = await gemini().models.generateContent({
        model: geminiModel(),
        contents: state.contents,
        config: { systemInstruction: systemPrompt(), tools: GEMINI_TOOLS },
      });
    } catch (e) {
      if (round === 0) state.contents.pop();  // keep the history valid for the next try
      const status = e instanceof GeminiApiError ? e.status : null;
      const hint = status === 429 ? ' The free-tier limit was reached - wait a minute (or for tomorrow\'s quota) and try again.'
        : status === 400 || status === 403 ? ' Check GEMINI_API_KEY and GEMINI_MODEL in web/server/.env.' : '';
      addItem({ kind: 'error', text: `Gemini request failed${status ? ` (${status})` : ''}: ${e.message}.${hint}` });
      return;
    }
    const content = response.candidates?.[0]?.content;
    if (!content?.parts?.length) {
      if (round === 0) state.contents.pop();
      const why = response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason || 'no answer';
      addItem({ kind: 'error', text: `Gemini did not answer (${why}). Try rephrasing.` });
      return;
    }
    // Append the model turn exactly as received - it carries the thought signatures
    // Gemini needs to continue a function-calling conversation.
    state.contents.push(content);
    const said = content.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('\n').trim();
    const calls = response.functionCalls || [];
    if (said) addItem({ kind: 'assistant', text: said });
    if (!calls.length) {
      if (response.candidates?.[0]?.finishReason === 'MAX_TOKENS') addItem({ kind: 'error', text: 'The reply was cut off (too long).' });
      return;
    }
    const parts = calls.map((call) => {
      const result = runTool(call.name, call.args);
      return { functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name,
        response: result?.error || result?.errors ? { error: result } : { output: result } } };
    });
    state.contents.push({ role: 'user', parts });
    save();
  }
  addItem({ kind: 'error', text: 'Stopped after too many lookups - please ask a narrower question.' });
}

const activityLabel = (name, input) => ({
  get_plan_overview: 'Checked the plan overview', get_session: `Looked at ${input.date} ${input.session}`,
  get_room: `Looked up room ${input.room_id}`, find_faculty: `Searched faculty "${input.query}"`,
  get_faculty: `Looked up ${input.faculty_id}`, find_subject: `Searched subjects "${input.query}"`,
  get_subject: `Looked up ${input.subject_code}`, check_subject_move: `Checked moving ${input.subject_code} to ${input.date} ${input.session}`,
}[name] || name);

// ------------------------------------------------------------------ built-in parser mode
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function parseDate(s) {
  const year = (store.config.start_date || '2026').slice(0, 4);
  const pad = (n) => String(n).padStart(2, '0');
  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return m[0];
  m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?/i);
  if (m) return `${m[3] || year}-${pad(MONTHS.indexOf(m[2].toLowerCase()) + 1)}-${pad(m[1])}`;
  m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i);
  if (m) return `${m[3] || year}-${pad(MONTHS.indexOf(m[1].toLowerCase()) + 1)}-${pad(m[2])}`;
  m = s.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/);
  if (m) return `${m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : year}-${pad(m[2])}-${pad(m[1])}`;
  return null;
}
const parseSession = (s, fallback) => (/\b(fn|forenoon|morning)\b/i.test(s) ? 'FN' : /\b(an|afternoon|evening)\b/i.test(s) ? 'AN'
  : /\b(both|full day|whole day|entire day|all day)\b/i.test(s) ? 'BOTH' : fallback);

function findFacultyIn(s) {
  const id = s.match(/\bSRKR\d{4}\b/i);
  if (id) return [store.faculty.get(id[0].toUpperCase())].filter(Boolean);
  const low = s.toLowerCase();
  return [...store.faculty.values()].filter((f) => low.includes(f.name.replace(/^Dr\.\s*/, '').toLowerCase()));
}
function findSubjectIn(s) {
  const code = s.match(/\bB23[A-Z]{2}[A-Z0-9]{4}\b/i);
  if (code) return [store.slotOf.get(code[0].toUpperCase())].filter(Boolean);
  const low = s.toLowerCase();
  const hits = store.timetable.filter((t) => low.includes(t.subject_name.toLowerCase()));
  const longest = Math.max(0, ...hits.map((h) => h.subject_name.length));
  return hits.filter((h) => h.subject_name.length === longest);
}

function parseCommands(text) {
  const actions = [], notes = [];
  const parts = text.split(/[.;\n]+|\band\b(?=\s+(?:room|faculty|srkr|move|shift|declare|holiday|no exams?|dr\.?|mr|mrs|ms|prof))/i).map((p) => p.trim()).filter(Boolean);
  for (const p of parts) {
    const room = p.match(/\b([A-Z]{2}-\d{3})\b/i);
    const date = parseDate(p);
    if (room && /(maintenance|repair|unavailable|not available|closed|broken|damage|leak|no power|out of order|can't be used|cannot be used|renovat)/i.test(p)) {
      actions.push({ type: 'set_room_availability', room_id: room[1].toUpperCase(), usable: false });
    } else if (room && /(available|open|fixed|ready|repaired|back|usable)/i.test(p)) {
      actions.push({ type: 'set_room_availability', room_id: room[1].toUpperCase(), usable: true });
    } else if (/(holiday|no exams?)\b/i.test(p) && date) {
      actions.push({ type: 'add_holiday', date });
    } else if (/(move|shift|reschedule|postpone|prepone|change)\b/i.test(p) && date) {
      const subj = findSubjectIn(p);
      const session = parseSession(p, null);
      if (subj.length === 1 && session && session !== 'BOTH') actions.push({ type: 'move_subject', subject_code: subj[0].subject_code, date, session });
      else if (subj.length > 1) notes.push(`"${p}": which subject? ${subj.map((s) => `${s.subject_code} (${s.department} yr ${s.year})`).join(', ')}`);
      else if (!subj.length) notes.push(`"${p}": I could not find that subject - use its code, e.g. B23CS3102.`);
      else notes.push(`"${p}": please say FN or AN.`);
    } else if (/(unpin|release)\b/i.test(p)) {
      const subj = findSubjectIn(p);
      if (subj.length === 1) actions.push({ type: 'unpin_subject', subject_code: subj[0].subject_code });
    } else if (/(extend|last exam|end date|finish by|end by)\b/i.test(p) && date) {
      actions.push({ type: 'set_last_exam_date', date });
    } else if (/(leave|absent|not available|unavailable|can'?t come|cannot come|busy|away|sick)\b/i.test(p)) {
      const fac = findFacultyIn(p);
      if (fac.length === 1 && date) actions.push({ type: 'add_faculty_leave', faculty_id: fac[0].faculty_id, date, session: parseSession(p, 'BOTH') });
      else if (fac.length > 1) notes.push(`"${p}": several faculty match - ${fac.slice(0, 5).map((f) => `${f.faculty_id} ${f.name}`).join(', ')}. Use the ID.`);
      else if (!fac.length) notes.push(`"${p}": I could not find that faculty member - use their ID, e.g. SRKR0012.`);
      else notes.push(`"${p}": which date?`);
    }
  }
  return { actions, notes };
}

function chatWithParser(text) {
  const { actions, notes } = parseCommands(text);
  if (actions.length) {
    const result = propose(`Change request: ${text.slice(0, 120)}`, actions);
    if (result.proposal) {
      // Put the explanation above the proposal card it refers to.
      const card = state.items.pop();
      addItem({ kind: 'assistant', text: `I understood ${actions.length} change${actions.length > 1 ? 's' : ''}. Check them below and press **Apply** to re-plan.${notes.length ? `\n\nAlso:\n${notes.map((n) => `- ${n}`).join('\n')}` : ''}` });
      state.items.push(card);
    } else {
      addItem({ kind: 'assistant', text: `I could not use that:\n${result.errors.map((e) => `- ${e.error}`).join('\n')}` });
    }
    return;
  }
  if (notes.length) return void addItem({ kind: 'assistant', text: notes.map((n) => `- ${n}`).join('\n') });
  const room = text.match(/\b([A-Z]{2}-\d{3})\b/i);
  if (room) {
    const r = lookups.get_room({ room_id: room[1] });
    if (!r.error) return void addItem({ kind: 'assistant', text: `**${r.room_id}** - ${r.block}, floor ${r.floor}, ${r.capacity} seats, ${r.exam_usable === 'yes' ? 'exam-usable' : 'NOT usable'}; used in ${r.sessions_in_use} sessions${r.uses.length ? ` (first ${r.uses[0].date} ${r.uses[0].session})` : ''}.` });
  }
  const o = lookups.get_plan_overview();
  addItem({ kind: 'assistant', text: `The built-in assistant understands clear change requests. For example:
- "Room CS-204 is under maintenance"
- "SRKR0012 is on leave on 2 Dec AN"
- "Declare 28 Nov a holiday"
- "Move B23CS3102 to 25 Nov FN"
- "Extend the last exam date to 12 Dec"

Right now: ${o.timetable.days_used} exam days (${o.timetable.first} to ${o.timetable.last}), ${o.timetable.clashes} clashes, ${o.seating.same_subject_neighbours} same-paper neighbours.
To ask questions in any wording, add a free Gemini API key (or a Claude key) - see the note at the top.` });
}

// ------------------------------------------------------------------ entry point
/** "the admin is on the Seating page looking at CS-204 on 2026-11-16 FN" - so "this room" makes sense. */
function describeContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return '';
  const clean = (v) => String(v ?? '').replace(/[^\w\s:./-]/g, '').slice(0, 60);
  const bits = [];
  if (ctx.page) bits.push(`is on the "${clean(ctx.page)}" page`);
  if (ctx.room_id) bits.push(`looking at room ${clean(ctx.room_id)}`);
  if (ctx.date) bits.push(`for ${clean(ctx.date)} ${clean(ctx.session)}`.trim());
  return bits.length ? `\n\n[Screen context: the admin ${bits.join(', ')}.]` : '';
}

let busy = false;
export async function sendMessage(text, by, context = null) {
  text = String(text || '').trim().slice(0, 4000);
  if (!text) throw Object.assign(new Error('message is empty'), { status: 400 });
  if (busy) throw Object.assign(new Error('the assistant is still answering - wait a moment'), { status: 409 });
  busy = true;
  try {
    addItem({ kind: 'user', text, by });
    const which = provider();
    if (which === 'gemini') await chatWithGemini(text + describeContext(context));
    else if (which === 'claude') await chatWithClaude(text + describeContext(context));
    else {
      // The parser has no idea what "this room" is, so fill in the room on screen.
      const room = context?.room_id && /\b[A-Z]{2}-\d{3}\b/i.test(text) === false ? String(context.room_id) : null;
      chatWithParser(room ? text.replace(/\b(this|the current|that) room\b/i, `room ${room}`) : text);
    }
  } finally {
    busy = false;
    save();
  }
  return getConversation();
}

export { parseCommands };
