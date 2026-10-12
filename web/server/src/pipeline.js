// Re-runs the whole planning pipeline: Python timetable -> Python turnout -> Java seating/duties.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, OUT_DIR, ROOT } from './paths.js';
import { store } from './store.js';

const PY = path.join(ROOT, 'services', 'scheduler', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const JAR = path.join(ROOT, 'services', 'solver', 'target', 'examgrid-solver-0.1.0.jar');

const STEPS = [
  { name: 'Timetable (DSatur graph colouring)', cmd: PY, args: ['-m', 'examgrid_scheduler.cli', DATA_DIR, '--out', OUT_DIR],
    cwd: path.join(ROOT, 'services', 'scheduler') },
  { name: 'Turnout prediction (regression)', cmd: PY, args: ['-m', 'examgrid_scheduler.turnout_cli', DATA_DIR,
    '--timetable', path.join(OUT_DIR, 'timetable.csv'), '--out', OUT_DIR], cwd: path.join(ROOT, 'services', 'scheduler') },
  { name: 'Seating + invigilation (Timefold)', cmd: 'java', args: ['-jar', JAR, 'batch', DATA_DIR, OUT_DIR, '6'], cwd: ROOT },
];

let state = { running: false, steps: STEPS.map((s) => ({ name: s.name, status: 'idle', log: '' })), startedAt: null, finishedAt: null };

export const pipelineState = () => state;

const runStep = (step, view) => new Promise((resolve) => {
  view.status = 'running';
  const t0 = Date.now();
  const child = spawn(step.cmd, step.args, { cwd: step.cwd });
  const append = (d) => { view.log = (view.log + d.toString()).slice(-6000); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('error', (e) => { append(String(e)); view.status = 'failed'; resolve(false); });
  child.on('close', (code) => {
    view.seconds = Math.round((Date.now() - t0) / 100) / 10;
    view.status = code === 0 ? 'done' : 'failed';
    resolve(code === 0);
  });
});

let current = null;

/** Starts a run (or joins the one in progress) and returns its state immediately. */
export async function runPipeline() {
  startRun();
  return state;
}

/** Starts a run (or joins the one in progress) and resolves when it has finished. */
export async function runPipelineAndWait() {
  await startRun();
  return state;
}

function startRun() {
  if (state.running && current) return current;
  if (!fs.existsSync(PY) || !fs.existsSync(JAR)) {
    throw Object.assign(new Error('Python venv or solver jar missing - see README setup'), { status: 500 });
  }
  state = { running: true, steps: STEPS.map((s) => ({ name: s.name, status: 'waiting', log: '' })),
    startedAt: new Date().toISOString(), finishedAt: null };
  current = (async () => {
    for (let i = 0; i < STEPS.length; i++) {
      if (!(await runStep(STEPS[i], state.steps[i]))) break;
    }
    // seat edits refer to the old plan, so start a fresh edit log with the new one
    if (state.steps.every((s) => s.status === 'done')) {
      fs.rmSync(path.join(OUT_DIR, 'seat_edits.json'), { force: true });
      store.load();
    }
    state.running = false;
    state.finishedAt = new Date().toISOString();
    state.ok = state.steps.every((s) => s.status === 'done');
  })();
  return current;
}
