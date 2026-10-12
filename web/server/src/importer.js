// Validates uploaded CSVs before they are accepted. Row numbers count the header as row 1,
// like a spreadsheet, so the admin can find the problem cell directly.
import { parse } from 'csv-parse/sync';
import { store } from './store.js';

const SCHEMAS = {
  students: ['roll_no', 'name', 'branch', 'year', 'needs_ground_floor'],
  registrations: ['roll_no', 'subject_code', 'reg_type'],
  rooms: ['room_id', 'rows', 'cols', 'capacity'],
};

export function validateCsv(type, text) {
  if (!SCHEMAS[type]) return { ok: false, errors: [{ row: 0, column: '', error: `unknown file type ${type}` }] };
  let rows;
  try {
    rows = parse(text, { columns: true, skip_empty_lines: true, bom: true, trim: true });
  } catch (e) {
    return { ok: false, rows: 0, errors: [{ row: 0, column: '', error: `not valid CSV: ${e.message}` }] };
  }
  const errors = [];
  const add = (i, column, error) => errors.push({ row: i + 2, column, error });
  const missing = SCHEMAS[type].filter((c) => rows.length && !(c in rows[0]));
  if (missing.length) return { ok: false, rows: rows.length, errors: [{ row: 1, column: missing.join(', '), error: 'missing column' }] };

  const seen = new Set();
  rows.forEach((r, i) => {
    if (type === 'students') {
      if (!r.roll_no) add(i, 'roll_no', 'required');
      else if (seen.has(r.roll_no)) add(i, 'roll_no', 'duplicate roll_no');
      seen.add(r.roll_no);
      if (!r.branch) add(i, 'branch', 'required');
      if (!['1', '2', '3', '4'].includes(String(r.year))) add(i, 'year', 'must be 1-4');
      if (!['yes', 'no'].includes(r.needs_ground_floor)) add(i, 'needs_ground_floor', 'must be yes/no');
    } else if (type === 'registrations') {
      if (!store.students.has(r.roll_no)) add(i, 'roll_no', 'unknown student');
      if (!store.subjects.has(r.subject_code)) add(i, 'subject_code', 'unknown subject');
      const key = `${r.roll_no}|${r.subject_code}`;
      if (seen.has(key)) add(i, 'subject_code', 'duplicate registration');
      seen.add(key);
      if (!['REGULAR', 'BACKLOG'].includes(r.reg_type)) add(i, 'reg_type', 'must be REGULAR/BACKLOG');
    } else if (type === 'rooms') {
      if (seen.has(r.room_id)) add(i, 'room_id', 'duplicate room_id');
      seen.add(r.room_id);
      const rowsN = Number(r.rows), colsN = Number(r.cols), cap = Number(r.capacity);
      if (!(rowsN > 0)) add(i, 'rows', 'must be positive');
      if (!(colsN > 0)) add(i, 'cols', 'must be positive');
      if (rowsN > 0 && colsN > 0 && cap !== rowsN * colsN) add(i, 'capacity', 'capacity must equal rows x cols');
    }
  });
  return { ok: errors.length === 0, type, rows: rows.length, errors };
}
