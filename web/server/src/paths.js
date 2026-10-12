import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '../../..');
export const SCALE = process.env.EXAMGRID_SCALE || 'full';
export const DATA_DIR = path.join(ROOT, 'data', SCALE);
export const OUT_DIR = path.join(ROOT, 'output', SCALE);
export const CLIENT_DIST = path.resolve(here, '../../client/dist');
export const SEED_USERS = path.resolve(here, '../seed/users.json');
