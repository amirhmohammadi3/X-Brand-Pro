#!/usr/bin/env node
// apps/api/scripts/dev-worker.mjs — watch mode for the worker process.
// Spawns `nest build --watch` (rebuilds dist/ on every source change) and
// `node --watch dist/src/worker.js` (restarts when dist output changes).
// Cross-platform pure Node; kills both children on exit or signal.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';

const children = [
  spawn(isWin ? 'pnpm.cmd' : 'pnpm', ['exec', 'nest', 'build', '--watch'], {
    cwd: API_ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: isWin,
  }),
  spawn(process.execPath, ['--watch', 'dist/src/worker.js'], {
    cwd: API_ROOT,
    stdio: 'inherit',
  }),
];

function stopAll(code) {
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill(isWin ? undefined : 'SIGTERM');
  }
  process.exitCode = code;
}

for (const child of children) {
  child.on('exit', (code) => {
    if (children.some((c) => c.exitCode === null && !c.killed)) stopAll(code ?? 1);
  });
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
