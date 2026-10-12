// Safe, checked edits to the exam data that the Plan Assistant can propose.
// Every apply backs up the touched files to data/<scale>/.history/<id>/ so it can be undone.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { DATA_DIR } from './paths.js';
import { store } from './store.js';

export const ACTION_TYPES = ['set_room_availability', 'add_faculty_leave', 'add_holiday', 'move_subject',
  'unpin_subject', 'set_last_exam_date'];
const FILES = ['rooms.csv', 'faculty_unavailability.csv', 'exam_config.json'];
const HISTORY = path.join(DATA_DIR, '.history');
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const readCsv = (name) => parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'), { columns: true, bom: true, skip_empty_lines: true });
const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function writeCsv(name, rows, header) {
  header = header || Object.keys(rows[0] || {});
  fs.writeFileSync(path.join(DATA_DIR, name), [header.join(','), ...rows.map((r) => header.map((h) => cell(r[h])).join(','))].join('\n') + '\n');
}
const readConfig = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'exam_config.json'), 'utf8'));
const weekday = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long' });
const sessionCodes = () => (store.config.sessions || []).map((s) => s.code);

/** Every exam day currently allowed by the config (no excluded weekdays or holidays). */
export function examDays(config = store.config) {
  const out = [];
  const holidays = new Set(config.holidays || []);
  const excluded = new Set(config.exclude_weekdays || ['Sunday']);
  for (let d = new Date(`${config.start_date}T00:00:00`); d <= new Date(`${config.last_allowed_date}T00:00:00`); d.setDate(d.getDate() + 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!holidays.has(iso) && !excluded.has(weekday(iso))) out.push(iso);
  }
  return out;
}

/** What moving a subject to a slot would collide with in the current plan (the re-plan then fixes it). */
export function checkSubjectMove(code, date, session) {
  const t = store.slotOf.get(code);
  if (!t) return { ok: false, error: `${code} is not in the timetable` };
  const students = new Set(store.registrations.filter((r) => r.subject_code === code).map((r) => r.roll_no));
  const regular = new Set(store.registrations.filter((r) => r.subject_code === code && r.reg_type === 'REGULAR').map((r) => r.roll_no));
  const sameSession = [], sameDayRegular = [];
  let load = students.size;
  for (const other of store.timetable) {
    if (other.subject_code === code || other.exam_date !== date) continue;
    const regs = store.registrations.filter((r) => r.subject_code === other.subject_code);
    if (other.session === session) {
      load += other.students;
      const shared = regs.filter((r) => students.has(r.roll_no)).length;
      if (shared) sameSession.push({ subject_code: other.subject_code, shared_students: shared });
    } else {
      const shared = regs.filter((r) => r.reg_type === 'REGULAR' && regular.has(r.roll_no)).length;
      if (shared) sameDayRegular.push({ subject_code: other.subject_code, shared_regular_students: shared });
    }
  }
  const seats = store.timetableReport.seats_per_session;
  return {
    ok: true, subject_code: code, subject_name: store.subjects.get(code)?.subject_name, students: students.size,
    current_slot: { date: t.exam_date, session: t.session }, target_slot: { date, session, weekday: weekday(date) },
    clashes_in_target_session: sameSession, regular_students_with_another_exam_that_day: sameDayRegular,
    seats_needed_in_target_session: load, seats_available: seats,
    note: sameSession.length || sameDayRegular.length || load > seats
      ? 'The re-plan keeps this subject pinned and moves the subjects it clashes with to other sessions.'
      : 'No clash with the current plan.',
  };
}

/** Validate one action; returns { ok, error } or { ok, description }. */
export function validateAction(a) {
  const config = store.config;
  const days = examDays(config);
  const bad = (error) => ({ ok: false, error });
  switch (a?.type) {
    case 'set_room_availability': {
      const room = store.rooms.get(a.room_id);
      if (!room) return bad(`room ${a.room_id} does not exist`);
      if (typeof a.usable !== 'boolean') return bad('usable must be true or false');
      return { ok: true, description: `Mark room ${a.room_id} (${room.block}, floor ${room.floor}, ${room.capacity} seats) as ${a.usable ? 'available' : 'NOT available'} for exams` };
    }
    case 'add_faculty_leave': {
      const f = store.faculty.get(a.faculty_id);
      if (!f) return bad(`faculty ${a.faculty_id} does not exist`);
      if (!ISO.test(a.date || '')) return bad('date must be YYYY-MM-DD');
      if (!['FN', 'AN', 'BOTH'].includes(a.session)) return bad('session must be FN, AN or BOTH');
      return { ok: true, description: `Add leave for ${f.name} (${a.faculty_id}) on ${weekday(a.date)} ${a.date}, ${a.session === 'BOTH' ? 'full day' : a.session}` };
    }
    case 'add_holiday': {
      if (!ISO.test(a.date || '')) return bad('date must be YYYY-MM-DD');
      if ((config.holidays || []).includes(a.date)) return bad(`${a.date} is already a holiday`);
      const pinned = Object.entries(config.fixed_slots || {}).find(([, v]) => v.date === a.date);
      if (pinned) return bad(`${pinned[0]} is pinned to ${a.date}; unpin it first`);
      return { ok: true, description: `Declare ${weekday(a.date)} ${a.date} a holiday (no exams); exams that day are re-planned` };
    }
    case 'move_subject': {
      const t = store.slotOf.get(a.subject_code);
      if (!t) return bad(`subject ${a.subject_code} is not in the timetable`);
      if (!days.includes(a.date)) return bad(`${a.date} is not an exam day (outside the window, a Sunday or a holiday)`);
      if (!sessionCodes().includes(a.session)) return bad(`session must be one of ${sessionCodes().join(', ')}`);
      return { ok: true, description: `Pin ${a.subject_code} ${store.subjects.get(a.subject_code)?.subject_name || ''} to ${weekday(a.date)} ${a.date} ${a.session} (now ${t.exam_date} ${t.session})` };
    }
    case 'unpin_subject': {
      if (!(config.fixed_slots || {})[a.subject_code]) return bad(`${a.subject_code} is not pinned`);
      return { ok: true, description: `Unpin ${a.subject_code} so the scheduler may place it anywhere` };
    }
    case 'set_last_exam_date': {
      if (!ISO.test(a.date || '')) return bad('date must be YYYY-MM-DD');
      if (a.date < config.start_date) return bad('last exam date must be after the start date');
      const late = Object.entries(config.fixed_slots || {}).find(([, v]) => v.date > a.date);
      if (late) return bad(`${late[0]} is pinned to ${late[1].date}, after ${a.date}`);
      return { ok: true, description: `Set the last allowed exam date to ${weekday(a.date)} ${a.date} (now ${config.last_allowed_date})` };
    }
    default:
      return bad(`unknown action type ${a?.type}; use one of ${ACTION_TYPES.join(', ')}`);
  }
}

/** Apply validated actions to the data files. Returns the backup id. */
export function applyActions(actions) {
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(HISTORY, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of FILES) fs.copyFileSync(path.join(DATA_DIR, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'actions.json'), JSON.stringify(actions, null, 2));

  const config = readConfig();
  let rooms = null, leave = null;
  for (const a of actions) {
    if (a.type === 'set_room_availability') {
      rooms ??= readCsv('rooms.csv');
      rooms.find((r) => r.room_id === a.room_id).exam_usable = a.usable ? 'yes' : 'no';
    } else if (a.type === 'add_faculty_leave') {
      leave ??= readCsv('faculty_unavailability.csv');
      leave.push({ faculty_id: a.faculty_id, date: a.date, session: a.session, reason: 'Reported via Plan Assistant' });
    } else if (a.type === 'add_holiday') {
      config.holidays = [...new Set([...(config.holidays || []), a.date])].sort();
    } else if (a.type === 'move_subject') {
      config.fixed_slots = { ...(config.fixed_slots || {}), [a.subject_code]: { date: a.date, session: a.session } };
    } else if (a.type === 'unpin_subject') {
      const { [a.subject_code]: _, ...rest } = config.fixed_slots || {};
      config.fixed_slots = rest;
    } else if (a.type === 'set_last_exam_date') {
      config.last_allowed_date = a.date;
    }
  }
  if (rooms) writeCsv('rooms.csv', rooms);
  if (leave) writeCsv('faculty_unavailability.csv', leave, ['faculty_id', 'date', 'session', 'reason']);
  fs.writeFileSync(path.join(DATA_DIR, 'exam_config.json'), JSON.stringify(config, null, 2));
  return id;
}

export function lastBackup() {
  if (!fs.existsSync(HISTORY)) return null;
  const ids = fs.readdirSync(HISTORY).sort();
  if (!ids.length) return null;
  const id = ids[ids.length - 1];
  return { id, actions: JSON.parse(fs.readFileSync(path.join(HISTORY, id, 'actions.json'), 'utf8')) };
}

/** Restore the files from the most recent backup. */
export function undoLast() {
  const last = lastBackup();
  if (!last) return null;
  for (const f of FILES) fs.copyFileSync(path.join(HISTORY, last.id, f), path.join(DATA_DIR, f));
  fs.rmSync(path.join(HISTORY, last.id), { recursive: true, force: true });
  return last;
}

/** Key numbers + per-entity facts, to show what a re-plan changed. */
export function snapshot(actions = []) {
  const tt = store.timetableReport, seat = store.solverReport.seating || {}, duty = store.solverReport.duties?.checks || {};
  const facts = {};
  for (const a of actions) {
    if (a.room_id) {
      const used = [...store.seating.keys()].filter((k) => k.endsWith(`|${a.room_id}`)).length;
      facts[`room ${a.room_id}`] = `${used} sessions in use`;
    }
    if (a.faculty_id) {
      const ds = store.duties.filter((d) => d.faculty_id === a.faculty_id);
      const onDay = ds.filter((d) => d.exam_date === a.date && (a.session === 'BOTH' || d.session === a.session)).length;
      facts[`${a.faculty_id} duties`] = `${ds.length} total, ${onDay} on ${a.date} ${a.session || ''}`.trim();
    }
    if (a.subject_code) {
      const t = store.slotOf.get(a.subject_code);
      facts[`${a.subject_code} slot`] = t ? `${t.exam_date} ${t.session}` : 'not scheduled';
    }
    if (a.type === 'add_holiday') {
      facts[`exams on ${a.date}`] = String(store.timetable.filter((t) => t.exam_date === a.date).length);
    }
  }
  return {
    clashes: tt.clashes_same_session, regular_same_day: tt.regular_students_two_exams_same_day,
    backlog_same_day: tt.backlog_students_two_exams_same_day, exam_days: tt.exam_days_used,
    last_exam: tt.last_exam, back_to_back_pct: tt.pct_students_with_back_to_back,
    seated: seat.students_seated, unseated: seat.unseated, neighbours: seat.same_subject_neighbours,
    room_sessions: seat.room_sessions, duties: duty.duties, own_subject: duty.own_subject_violations,
    on_leave: duty.on_leave_violations, facts,
  };
}
