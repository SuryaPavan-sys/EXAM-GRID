import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCommands } from '../src/assistant.js';
import { checkSubjectMove, examDays, validateAction } from '../src/planChanges.js';
import { store } from '../src/store.js';

const someFaculty = [...store.faculty.values()][5];
const someRoom = [...store.rooms.values()].find((r) => r.exam_usable === 'yes');
const someSubject = store.timetable[10];

test('room maintenance becomes set_room_availability(false)', () => {
  const { actions } = parseCommands(`Room ${someRoom.room_id} is under maintenance`);
  assert.deepEqual(actions, [{ type: 'set_room_availability', room_id: someRoom.room_id, usable: false }]);
});

test('faculty leave by ID with a natural date and session', () => {
  const { actions } = parseCommands(`${someFaculty.faculty_id} is on leave on 2 Dec afternoon`);
  assert.deepEqual(actions, [{ type: 'add_faculty_leave', faculty_id: someFaculty.faculty_id, date: '2026-12-02', session: 'AN' }]);
});

test('faculty leave by name defaults to the full day', () => {
  const name = someFaculty.name.replace(/^Dr\.\s*/, '');
  const { actions, notes } = parseCommands(`${name} can't come on Nov 20`);
  const matches = [...store.faculty.values()].filter((f) => f.name.replace(/^Dr\.\s*/, '') === name);
  if (matches.length === 1) assert.deepEqual(actions[0], { type: 'add_faculty_leave', faculty_id: someFaculty.faculty_id, date: '2026-11-20', session: 'BOTH' });
  else assert.ok(notes.length, 'ambiguous names ask which one');
});

test('several requests in one message', () => {
  const { actions } = parseCommands(`Declare 28 Nov a holiday and room ${someRoom.room_id} is broken; move ${someSubject.subject_code} to 25 Nov FN`);
  assert.deepEqual(actions.map((a) => a.type), ['add_holiday', 'set_room_availability', 'move_subject']);
  assert.equal(actions[2].date, '2026-11-25');
});

test('validation rejects unknown rooms and non-exam days', () => {
  assert.equal(validateAction({ type: 'set_room_availability', room_id: 'ZZ-999', usable: false }).ok, false);
  assert.equal(validateAction({ type: 'move_subject', subject_code: someSubject.subject_code, date: '2026-11-22', session: 'FN' }).ok, false); // Sunday
  assert.equal(validateAction({ type: 'add_faculty_leave', faculty_id: someFaculty.faculty_id, date: '2026-12-02', session: 'AN' }).ok, true);
});

test('exam days skip Sundays and the declared holiday', () => {
  const days = examDays();
  assert.ok(!days.includes('2026-11-22') && !days.includes('2026-11-24') && days.includes('2026-11-16'));
});

test('checking a move reports what it would collide with', () => {
  const r = checkSubjectMove(someSubject.subject_code, '2026-11-25', 'FN');
  assert.equal(r.ok, true);
  assert.equal(r.students, someSubject.students);
  assert.ok(Array.isArray(r.clashes_in_target_session));
});
