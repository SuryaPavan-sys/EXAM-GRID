// Loads web/server/.env (KEY=value lines) into process.env, without overriding real env vars.
// Imported first by index.js so every module sees the values.
import fs from 'node:fs';

const file = new URL('../.env', import.meta.url);
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}
