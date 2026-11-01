#!/usr/bin/env node
// check-secrets.mjs (I1.1) — scans TRACKED files for material that looks
// like a real credential and fails with file:line. .env.example, lockfiles
// and lines marked `// fake-secret` (test fixtures) are exempt.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanContent } from './lib/env-tools.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const EXEMPT_FILES = new Set(['.env.example', 'pnpm-lock.yaml']);
const EXEMPT_DIRS = ['node_modules/', 'dist/', '.next/', 'test/'];

function trackedFiles() {
  const out = execSync('git ls-files', {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return out.split('\n').filter((f) => f.trim().length > 0);
}

function isExemptPath(file) {
  if (EXEMPT_FILES.has(file)) return true;
  return EXEMPT_DIRS.some((d) => file.startsWith(d));
}

function main() {
  let findings = 0;
  for (const file of trackedFiles()) {
    if (isExemptPath(file)) continue;
    let content;
    try {
      content = readFileSync(path.join(root, file), 'utf8');
    } catch {
      continue; // deleted/binary — skip quietly
    }
    for (const f of scanContent(content, file)) {
      findings += 1;
      console.error(`[check:secrets] ${f.file}:${f.line} — ${f.rule}`);
      console.error(`    ${f.snippet}`);
    }
  }

  if (findings > 0) {
    console.error(`[check:secrets] FAIL — ${findings} suspicious line(s).`);
    console.error('If this is intentional test data, mark the line with `// fake-secret`.');
    process.exitCode = 1;
    return;
  }
  console.log('[check:secrets] OK (no credential-shaped strings in tracked files)');
}

main();
