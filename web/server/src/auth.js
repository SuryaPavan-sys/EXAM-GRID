// JWT auth with three roles. Admin comes from seed/users.json; faculty log in with their
// faculty ID and students with their roll number (demo passwords from the same file).
import crypto from 'node:crypto';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { SEED_USERS } from './paths.js';
import { store } from './store.js';

const seed = JSON.parse(fs.readFileSync(SEED_USERS, 'utf8'));

/** JWT key: env var, else a random key kept in web/server/.jwt-secret so logins survive restarts. */
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = new URL('../.jwt-secret', import.meta.url);
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'));
  return fs.readFileSync(file, 'utf8').trim();
}
const SECRET = loadSecret();
const hashes = {
  admin: bcrypt.hashSync(process.env.ADMIN_PASSWORD || seed.admin.password, 10),
  faculty: bcrypt.hashSync(process.env.FACULTY_PASSWORD || seed.faculty_password, 10),
  student: bcrypt.hashSync(process.env.STUDENT_PASSWORD || seed.student_password, 10),
};

export function login(role, username, password) {
  username = String(username || '').trim();
  let user = null;
  if (role === 'admin' && username === seed.admin.username && bcrypt.compareSync(password, hashes.admin)) {
    user = { role, id: username, name: seed.admin.name };
  } else if (role === 'faculty' && store.faculty.has(username) && bcrypt.compareSync(password, hashes.faculty)) {
    const f = store.faculty.get(username);
    user = { role, id: username, name: f.name, department: f.department, designation: f.designation };
  } else if (role === 'student' && store.students.has(username.toUpperCase()) && bcrypt.compareSync(password, hashes.student)) {
    const s = store.students.get(username.toUpperCase());
    user = { role, id: s.roll_no, name: s.name, branch: s.branch, year: s.year };
  }
  if (!user) return null;
  return { token: jwt.sign(user, SECRET, { expiresIn: '8h' }), user };
}

export function demoAccounts() {
  return {
    note: 'Local demo accounts (from web/server/seed/users.json)',
    admin: { username: seed.admin.username, password: seed.admin.password },
    faculty: { username: seed.examples.faculty_id, password: seed.faculty_password, hint: 'any faculty ID, e.g. SRKR0001' },
    student: { username: seed.examples.roll_no, password: seed.student_password, hint: 'any roll number' },
  };
}

/** Express middleware: require a valid token, optionally one of the given roles. */
export const requireAuth = (...roles) => (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  try {
    req.user = jwt.verify(token, SECRET);
  } catch {
    return res.status(401).json({ error: 'Please log in' });
  }
  if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Not allowed for your role' });
  next();
};

const TICKET_SECRET = process.env.TICKET_SECRET || 'examgrid-local-demo-ticket-key';
export const ticketSignature = (roll) =>
  crypto.createHmac('sha256', TICKET_SECRET).update(roll).digest('hex').slice(0, 16);
