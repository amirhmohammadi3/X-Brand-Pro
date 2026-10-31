#!/usr/bin/env node
// scripts/dev.mjs — cross-platform `pnpm dev`: runs api, worker and web in
// watch mode (AGENTS.md section 4). Pure Node (no bash), per AGENTS.md
// scripts rule. Web is spawned only once apps/web exists (created by F0.1).
// Any child exiting non-zero stops all children with the same code.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const pnpm = isWin ? 'pnpm.cmd' : 'pnpm';

const targets = [
  { name: 'api', args: ['--filter', '@app/api', 'run', 'dev'] },
  { name: 'worker', args: ['--filter', '@app/api', 'run', 'dev:worker'] },
  ...(existsSync(path.join(ROOT, 'apps', 'web'))
    ? [{ name: 'web', args: ['--filter', '@app/web', 'run', 'dev'] }]
    : []),
];

const children = [];
let stopping = false;

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill(isWin ? undefined : 'SIGTERM');
  }
  process.exitCode = code;
}

for (const target of targets) {
  const child = spawn(pnpm, target.args, {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: isWin,
  });
  child.on('exit', (code) => {
    if (!stopping) {
      process.stderr.write(`[dev] ${target.name} exited with code ${code} — stopping all\n`);
      stopAll(code ?? 1);
    }
  });
  children.push(child);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
