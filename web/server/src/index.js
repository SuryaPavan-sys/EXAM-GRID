import './env.js';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { applyProposal, getConversation, rejectProposal, resetConversation, sendMessage, undo } from './assistant.js';
import { demoAccounts, login, requireAuth, ticketSignature } from './auth.js';
import { validateCsv } from './importer.js';
import { CLIENT_DIST, DATA_DIR, SCALE } from './paths.js';
import { hallTicket, roomChart } from './pdf.js';
import { pipelineState, runPipeline } from './pipeline.js';
import { store } from './store.js';

const app = express();
app.use(express.json({ limit: '20mb' }));
const api = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;

// ------------------------------------------------------------------ public
api.get('/health', (req, res) => res.json({ status: 'ok', scale: SCALE, ready: store.ready, loadedAt: store.loadedAt }));
api.get('/auth/demo-accounts', (req, res) => res.json(demoAccounts()));
api.post('/auth/login', (req, res) => {
  const result = login(req.body.role, req.body.username, req.body.password);
  if (!result) return res.status(401).json({ error: 'Wrong username or password for this role' });
  res.json(result);
});

/** Public seat finder: roll number -> exam slots and seats (no personal details). */
api.get('/lookup/:roll', (req, res) => {
  const roll = req.params.roll.trim().toUpperCase();
  if (!store.students.has(roll)) return res.status(404).json({ error: 'Roll number not found' });
  res.json({ roll_no: roll, exams: store.examsOf(roll).map(({ reg_type, ...e }) => e) });
});

/** Hall-ticket QR target. */
api.get('/verify/:roll', (req, res) => {
  const roll = req.params.roll.toUpperCase();
  const s = store.students.get(roll);
  const valid = Boolean(s) && req.query.sig === ticketSignature(roll);
  res.json({ valid, roll_no: roll, name: valid ? s.name : null, branch: valid ? s.branch : null,
    exams: valid ? store.examsOf(roll) : [] });
});

// ------------------------------------------------------------------ any logged-in user
api.get('/me', requireAuth(), (req, res) => res.json(req.user));

api.get('/timetable', requireAuth(), (req, res) => {
  const { branch, year, q } = req.query;
  let rows = store.timetable.map((t) => {
    const s = store.subjects.get(t.subject_code) || {};
    return { ...t, offered_to: s.offered_to || '', time: store.sessionTime(t.session) };
  });
  if (branch) rows = rows.filter((r) => r.offered_to.split(';').includes(branch));
  if (year) rows = rows.filter((r) => String(r.year) === String(year));
  if (q) rows = rows.filter((r) => `${r.subject_code} ${r.subject_name}`.toLowerCase().includes(String(q).toLowerCase()));
  res.json({ rows, config: store.config, branches: store.branches.map((b) => b.branch) });
});

// ------------------------------------------------------------------ students
const selfOrAdmin = (param) => (req, res, next) =>
  req.user.role === 'admin' || req.user.id === req.params[param] ? next() : res.status(403).json({ error: 'Not your record' });

api.get('/students/:roll/exams', requireAuth('student', 'admin'), selfOrAdmin('roll'), (req, res) => {
  const s = store.students.get(req.params.roll);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json({ student: s, exams: store.examsOf(req.params.roll) });
});
api.get('/students/:roll/hallticket.pdf', requireAuth('student', 'admin'), selfOrAdmin('roll'), wrap(async (req, res) => {
  if (!store.students.has(req.params.roll)) return res.status(404).json({ error: 'not found' });
  await hallTicket(req.params.roll, baseUrl(req), res);
}));

// ------------------------------------------------------------------ faculty
api.get('/faculty/:id/duties', requireAuth('faculty', 'admin'), selfOrAdmin('id'), (req, res) => {
  const f = store.faculty.get(req.params.id);
  if (!f) return res.status(404).json({ error: 'not found' });
  res.json({ faculty: { ...f, teaches: [...(store.teaches.get(f.faculty_id) || [])] }, duties: store.facultyDuties(f.faculty_id) });
});

// ------------------------------------------------------------------ admin
const admin = requireAuth('admin');

api.get('/summary', admin, (req, res) => {
  const tt = store.timetableReport, tr = store.turnout, sr = store.solverReport;
  const byBranch = {};
  for (const s of store.students.values()) {
    byBranch[s.branch] ??= { branch: s.branch, y1: 0, y2: 0, y3: 0, y4: 0, total: 0 };
    byBranch[s.branch][`y${s.year}`] += 1;
    byBranch[s.branch].total += 1;
  }
  const sessions = store.sessions();
  const turnoutBySession = new Map((tr.sessions || []).map((s) => [`${s.exam_date} ${s.session}`, s]));
  const load = {};
  for (const d of store.duties) load[d.faculty_id] = (load[d.faculty_id] || 0) + 1;
  const dutyHist = {};
  for (const f of store.faculty.values()) {
    const n = load[f.faculty_id] || 0;
    dutyHist[n] = (dutyHist[n] || 0) + 1;
  }
  res.json({
    counts: { students: store.students.size, subjects: store.subjects.size, registrations: store.registrations.length,
      backlog: store.registrations.filter((r) => r.reg_type === 'BACKLOG').length, rooms: store.rooms.size,
      faculty: store.faculty.size, sessions: sessions.length },
    config: store.config,
    timetable: tt,
    turnout: { summary: tr.summary, backtest: tr.backtest, learned_effects: tr.learned_effects, model: tr.model,
      test_cycle: tr.test_cycle },
    seating: sr.seating,
    duties: sr.duties?.checks,
    seat_edits: store.edits.length,
    charts: {
      branches: Object.values(byBranch).sort((a, b) => b.total - a.total),
      sessions: sessions.map((s) => {
        const t = turnoutBySession.get(`${s.date} ${s.session}`) || {};
        return { key: `${s.date.slice(5)} ${s.session}`, date: s.date, session: s.session, registered: s.students,
          expected: Math.round(t.expected || 0), booked: t.seats_booked || 0, seats: store.timetableReport.seats_per_session,
          rooms: s.rooms, fill_pct: s.fill }; // not "fill": Recharts reads that key as the bar colour
      }),
      duty_histogram: Object.entries(dutyHist).map(([duties, faculty]) => ({ duties: +duties, faculty }))
        .sort((a, b) => a.duties - b.duties),
    },
  });
});

api.get('/sessions', admin, (req, res) => res.json(store.sessions()));
api.get('/sessions/:date/:session/rooms', admin, (req, res) =>
  res.json(store.roomsOfSession(req.params.date, req.params.session)));

api.get('/rooms/:date/:session/:room', requireAuth('admin', 'faculty'), (req, res) => {
  const grid = store.roomGrid(req.params.date, req.params.session, req.params.room);
  if (!grid) return res.status(404).json({ error: 'room not in use this session' });
  if (req.user.role === 'faculty' && !grid.invigilators.some((d) => d.faculty_id === req.user.id)) {
    return res.status(403).json({ error: 'You are not invigilating this room' });
  }
  res.json(grid);
});
api.get('/rooms/:date/:session/:room/chart.pdf', requireAuth('admin', 'faculty'), (req, res) => {
  const grid = store.roomGrid(req.params.date, req.params.session, req.params.room);
  if (!grid) return res.status(404).json({ error: 'room not in use this session' });
  roomChart(grid, res);
});

/** Seat editor: move/swap within a room. dryRun=true checks the rules live without saving. */
api.post('/rooms/:date/:session/:room/move', admin, (req, res) => {
  const { from, to, dryRun, force } = req.body;
  try {
    const check = store.moveSeat(req.params.date, req.params.session, req.params.room, from, to, { dryRun: true });
    if (dryRun) return res.json(check);
    if (!check.ok && !force) return res.status(409).json({ ...check, error: 'This move breaks a seating rule' });
    res.json(store.moveSeat(req.params.date, req.params.session, req.params.room, from, to,
      { by: req.user.id }));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

api.get('/duties', admin, (req, res) => {
  const { date, session } = req.query;
  let rows = store.duties;
  if (date) rows = rows.filter((d) => d.exam_date === date);
  if (session) rows = rows.filter((d) => d.session === session);
  const load = {};
  for (const d of store.duties) load[d.faculty_id] = (load[d.faculty_id] || 0) + 1;
  const faculty = [...store.faculty.values()].map((f) => ({ ...f, duties: load[f.faculty_id] || 0 }));
  res.json({ rows, faculty, checks: store.solverReport.duties?.checks });
});

api.get('/students', admin, (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  const rows = [...store.students.values()].filter((s) => !q || `${s.roll_no} ${s.name}`.toLowerCase().includes(q)).slice(0, 50);
  res.json(rows);
});

api.get('/faculty', admin, (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  res.json([...store.faculty.values()].filter((f) => !q || `${f.faculty_id} ${f.name} ${f.department}`.toLowerCase().includes(q)).slice(0, 50));
});

api.post('/import/validate', admin, (req, res) => res.json(validateCsv(req.body.type, req.body.csv || '')));
api.get('/import/sample/:type', admin, (req, res) => {
  const name = `${req.params.type}_bad.csv`;
  const file = path.join(DATA_DIR, 'invalid_samples', name);
  if (!/^(students|registrations|rooms)$/.test(req.params.type) || !fs.existsSync(file)) return res.status(404).json({ error: 'no sample' });
  res.json({ name, csv: fs.readFileSync(file, 'utf8') });
});

// ------------------------------------------------------------------ Plan Assistant (exam cell only)
const send = (fn) => async (req, res) => {
  try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
};
api.get('/assistant', admin, send(() => getConversation()));
api.post('/assistant/message', admin, send((req) => sendMessage(req.body.text, req.user.name)));
api.post('/assistant/proposals/:id/apply', admin, send((req) => applyProposal(req.params.id, req.user.name)));
api.post('/assistant/proposals/:id/reject', admin, send((req) => rejectProposal(req.params.id)));
api.post('/assistant/undo', admin, send((req) => undo(req.user.name)));
api.post('/assistant/reset', admin, send(() => resetConversation()));

api.get('/pipeline', admin, (req, res) => res.json(pipelineState()));
api.post('/pipeline/run', admin, wrap(async (req, res) => res.json(await runPipeline())));

api.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
app.use('/api', api);

// ------------------------------------------------------------------ website
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`ExamGrid running at http://localhost:${port}  (data: ${SCALE}, ${store.students.size} students, `
    + `${store.seating.size} room-sessions seated)`);
});
