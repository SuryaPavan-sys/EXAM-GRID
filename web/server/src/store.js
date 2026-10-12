// In-memory store loaded from the dataset and the planning outputs.
// Seat edits are written back to output/<scale>/seating.csv and logged in seat_edits.json.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { DATA_DIR, OUT_DIR } from './paths.js';

const readCsv = (file) =>
  fs.existsSync(file) ? parse(fs.readFileSync(file, 'utf8'), { columns: true, skip_empty_lines: true, bom: true }) : [];
const readJson = (file, fallback = null) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);

export const sessionKey = (date, session) => `${date} ${session}`;
const roomKey = (date, session, roomId) => `${date}|${session}|${roomId}`;

class Store {
  load() {
    this.config = readJson(path.join(DATA_DIR, 'exam_config.json'), {});
    this.students = new Map(readCsv(path.join(DATA_DIR, 'students.csv')).map((s) => [s.roll_no, s]));
    this.subjects = new Map(readCsv(path.join(DATA_DIR, 'subjects.csv')).map((s) => [s.subject_code, s]));
    this.registrations = readCsv(path.join(DATA_DIR, 'registrations.csv'));
    this.rooms = new Map(readCsv(path.join(DATA_DIR, 'rooms.csv')).map((r) => [r.room_id, { ...r,
      rows: +r.rows, cols: +r.cols, floor: +r.floor, capacity: +r.capacity }]));
    this.faculty = new Map(readCsv(path.join(DATA_DIR, 'faculty.csv')).map((f) => [f.faculty_id, f]));
    this.teaches = new Map();
    for (const t of readCsv(path.join(DATA_DIR, 'faculty_subjects.csv'))) {
      if (!this.teaches.has(t.faculty_id)) this.teaches.set(t.faculty_id, new Set());
      this.teaches.get(t.faculty_id).add(t.subject_code);
    }
    this.branches = readCsv(path.join(DATA_DIR, 'branches.csv'));
    this.leave = readCsv(path.join(DATA_DIR, 'faculty_unavailability.csv'));

    this.timetable = readCsv(path.join(OUT_DIR, 'timetable.csv')).map((t) => ({ ...t, students: +t.students,
      regular: +t.regular, backlog: +t.backlog }));
    this.slotOf = new Map(this.timetable.map((t) => [t.subject_code, t]));
    this.timetableReport = readJson(path.join(OUT_DIR, 'timetable_report.json'), {});
    this.turnout = readJson(path.join(OUT_DIR, 'turnout_report.json'), {});
    this.solverReport = readJson(path.join(OUT_DIR, 'solver_report.json'), {});
    this.duties = readCsv(path.join(OUT_DIR, 'duties.csv'));
    this.attendProb = new Map(readCsv(path.join(OUT_DIR, 'turnout_papers.csv'))
      .map((p) => [`${p.roll_no}|${p.subject_code}`, +p.attend_prob]));
    this.edits = readJson(path.join(OUT_DIR, 'seat_edits.json'), []);

    // seating: room-session -> Map("r,c" -> seat); roll -> seats
    this.seating = new Map();
    this.seatsOfRoll = new Map();
    for (const s of readCsv(path.join(OUT_DIR, 'seating.csv'))) this.#placeSeat({ ...s, row: +s.row, col: +s.col,
      floor: +s.floor, seat_no: +s.seat_no });
    this.loadedAt = new Date().toISOString();
    return this;
  }

  #placeSeat(seat) {
    const k = roomKey(seat.exam_date, seat.session, seat.room_id);
    if (!this.seating.has(k)) this.seating.set(k, new Map());
    this.seating.get(k).set(`${seat.row},${seat.col}`, seat);
    if (!this.seatsOfRoll.has(seat.roll_no)) this.seatsOfRoll.set(seat.roll_no, []);
    this.seatsOfRoll.get(seat.roll_no).push(seat);
  }

  get ready() {
    return this.timetable.length > 0 && this.seating.size > 0;
  }

  sessionTime(code) {
    const s = (this.config.sessions || []).find((x) => x.code === code);
    return s ? `${s.start}–${s.end}` : code;
  }

  // ------------------------------------------------------------ sessions & rooms
  sessions() {
    const out = new Map();
    for (const [k, seats] of this.seating) {
      const [date, session, roomId] = k.split('|');
      const key = sessionKey(date, session);
      if (!out.has(key)) out.set(key, { date, session, time: this.sessionTime(session), students: 0, rooms: 0,
        seats_open: 0, subjects: new Set(), invigilators: 0 });
      const o = out.get(key);
      o.students += seats.size;
      o.rooms += 1;
      o.seats_open += this.rooms.get(roomId)?.capacity || 0;
      for (const s of seats.values()) o.subjects.add(s.subject_code);
    }
    for (const d of this.duties) {
      const o = out.get(sessionKey(d.exam_date, d.session));
      if (o) o.invigilators += 1;
    }
    return [...out.values()].map((o) => ({ ...o, subjects: o.subjects.size,
      fill: o.seats_open ? Math.round((1000 * o.students) / o.seats_open) / 10 : 0 }))
      .sort((a, b) => (a.date + a.session).localeCompare(b.date + b.session));
  }

  roomsOfSession(date, session) {
    const rooms = [];
    for (const [k, seats] of this.seating) {
      const [d, s, roomId] = k.split('|');
      if (d !== date || s !== session) continue;
      const room = this.rooms.get(roomId);
      const subjects = {};
      for (const seat of seats.values()) subjects[seat.subject_code] = (subjects[seat.subject_code] || 0) + 1;
      rooms.push({ room_id: roomId, block: room.block, floor: room.floor, capacity: room.capacity, seated: seats.size,
        subjects, invigilators: this.dutiesOf(date, session, roomId).map((x) => x.faculty_name),
        violations: this.violations(date, session, roomId).length });
    }
    return rooms.sort((a, b) => a.room_id.localeCompare(b.room_id));
  }

  dutiesOf(date, session, roomId) {
    return this.duties.filter((d) => d.exam_date === date && d.session === session && d.room_id === roomId);
  }

  roomGrid(date, session, roomId) {
    const room = this.rooms.get(roomId);
    const seats = this.seating.get(roomKey(date, session, roomId));
    if (!room || !seats) return null;
    return {
      room, date, session, time: this.sessionTime(session),
      seats: [...seats.values()].map((s) => ({ ...s, name: this.students.get(s.roll_no)?.name || '',
        needs_ground_floor: this.students.get(s.roll_no)?.needs_ground_floor === 'yes',
        subject_name: this.subjects.get(s.subject_code)?.subject_name || s.subject_code })),
      invigilators: this.dutiesOf(date, session, roomId),
      violations: this.violations(date, session, roomId),
    };
  }

  /** Rule check for one room: same-paper neighbours (left/right/front/back) and ground-floor needs. */
  violations(date, session, roomId, seatsMap = null) {
    const room = this.rooms.get(roomId);
    const seats = seatsMap || this.seating.get(roomKey(date, session, roomId));
    if (!room || !seats) return [];
    const out = [];
    for (const s of seats.values()) {
      for (const [dr, dc, side] of [[0, 1, 'beside'], [1, 0, 'behind']]) {
        const n = seats.get(`${s.row + dr},${s.col + dc}`);
        if (n && n.subject_code === s.subject_code) {
          out.push({ type: 'neighbour', seats: [[s.row, s.col], [n.row, n.col]], subject: s.subject_code,
            message: `${s.roll_no} and ${n.roll_no} write ${s.subject_code} and sit ${side} each other` });
        }
      }
      if (room.floor !== 0 && this.students.get(s.roll_no)?.needs_ground_floor === 'yes') {
        out.push({ type: 'ground_floor', seats: [[s.row, s.col]],
          message: `${s.roll_no} needs a ground-floor seat` });
      }
    }
    return out;
  }

  /** Move a student to another seat in the same room (swap if occupied). dryRun only checks the rules. */
  moveSeat(date, session, roomId, from, to, { dryRun = false, by = 'admin' } = {}) {
    const k = roomKey(date, session, roomId);
    const seats = this.seating.get(k);
    const room = this.rooms.get(roomId);
    if (!seats || !room) throw Object.assign(new Error('room not in use this session'), { status: 404 });
    if (to.row < 1 || to.col < 1 || to.row > room.rows || to.col > room.cols) {
      throw Object.assign(new Error('target seat outside room'), { status: 400 });
    }
    const a = seats.get(`${from.row},${from.col}`);
    if (!a) throw Object.assign(new Error('no student on the source seat'), { status: 400 });
    const b = seats.get(`${to.row},${to.col}`);
    const trial = new Map(seats);
    const moved = (seat, row, col) => ({ ...seat, row, col, seat_no: (row - 1) * room.cols + col });
    trial.delete(`${from.row},${from.col}`);
    trial.delete(`${to.row},${to.col}`);
    trial.set(`${to.row},${to.col}`, moved(a, to.row, to.col));
    if (b) trial.set(`${from.row},${from.col}`, moved(b, from.row, from.col));
    const before = this.violations(date, session, roomId).length;
    const after = this.violations(date, session, roomId, trial);
    const result = { ok: after.length <= before && after.length === 0, violations: after, swapped: Boolean(b) };
    if (dryRun) return result;

    this.seating.set(k, trial);
    for (const seat of [a, b].filter(Boolean)) {
      const list = this.seatsOfRoll.get(seat.roll_no) || [];
      const i = list.findIndex((x) => x.exam_date === date && x.session === session && x.subject_code === seat.subject_code);
      const updated = trial.get(seat === a ? `${to.row},${to.col}` : `${from.row},${from.col}`);
      if (i >= 0) list[i] = updated;
    }
    this.edits.push({ at: new Date().toISOString(), by, date, session, room_id: roomId, from, to,
      student: a.roll_no, swapped_with: b?.roll_no || null, violations_after: after.length });
    this.#persistSeating();
    return { ...result, grid: this.roomGrid(date, session, roomId) };
  }

  #persistSeating() {
    const header = ['exam_date', 'session', 'room_id', 'building', 'floor', 'seat_no', 'row', 'col', 'roll_no',
      'subject_code', 'branch'];
    const lines = [header.join(',')];
    for (const seats of this.seating.values()) {
      for (const s of [...seats.values()].sort((x, y) => x.seat_no - y.seat_no)) {
        lines.push(header.map((h) => {
          const v = String(s[h] ?? '');
          return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        }).join(','));
      }
    }
    fs.writeFileSync(path.join(OUT_DIR, 'seating.csv'), lines.join('\n') + '\n');
    fs.writeFileSync(path.join(OUT_DIR, 'seat_edits.json'), JSON.stringify(this.edits, null, 2));
  }

  // ------------------------------------------------------------ people
  examsOf(roll) {
    const seats = this.seatsOfRoll.get(roll) || [];
    return this.registrations.filter((r) => r.roll_no === roll).map((r) => {
      const t = this.slotOf.get(r.subject_code) || {};
      const seat = seats.find((s) => s.subject_code === r.subject_code);
      return { subject_code: r.subject_code, subject_name: this.subjects.get(r.subject_code)?.subject_name || '',
        reg_type: r.reg_type, exam_date: t.exam_date, session: t.session, weekday: t.weekday,
        time: this.sessionTime(t.session), room_id: seat?.room_id || null, building: seat?.building || null,
        floor: seat?.floor ?? null, seat_no: seat?.seat_no ?? null, row: seat?.row ?? null, col: seat?.col ?? null };
    }).sort((a, b) => `${a.exam_date}${a.session}`.localeCompare(`${b.exam_date}${b.session}`));
  }

  facultyDuties(fid) {
    return this.duties.filter((d) => d.faculty_id === fid).map((d) => {
      const seats = this.seating.get(roomKey(d.exam_date, d.session, d.room_id));
      const subjects = [...new Set([...(seats?.values() || [])].map((s) => s.subject_code))];
      const room = this.rooms.get(d.room_id);
      return { ...d, time: this.sessionTime(d.session), block: room?.block, floor: room?.floor, subjects };
    }).sort((a, b) => `${a.exam_date}${a.session}`.localeCompare(`${b.exam_date}${b.session}`));
  }
}

export const store = new Store().load();
