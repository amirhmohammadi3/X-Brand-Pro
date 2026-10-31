#!/usr/bin/env node
// scripts/check-foundation.mjs — fails if any foundation file is missing or
// if any prompt ID in docs/PROGRESS.md is duplicated.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FOUNDATION_FILES,
  findMissingFoundationFiles,
  findDuplicatePromptIds,
} from './lib/foundation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function gitLsFiles() {
  try {
    const out = execSync('git ls-files', { cwd: repoRoot, encoding: 'utf8' });
    return out.split(/\r?\n/).filter(Boolean);
  } catch (_e) {
    console.error('check-foundation: could not run `git ls-files`. Are you in a git repo?');
    process.exit(2);
  }
}

const tracked = gitLsFiles();
const missing = findMissingFoundationFiles(tracked);
if (missing.length > 0) {
  console.error('check-foundation: missing foundation files:');
  for (const f of missing) console.error(`  - ${f}`);
  process.exit(1);
}

const progressPath = path.join(repoRoot, 'docs', 'PROGRESS.md');
const progressText = readFileSync(progressPath, 'utf8');
const dups = findDuplicatePromptIds(progressText);
if (dups.length > 0) {
  console.error('check-foundation: duplicate prompt IDs in docs/PROGRESS.md:');
  for (const id of dups) console.error(`  - ${id}`);
  process.exit(1);
}

console.log(
  `check-foundation: OK (${FOUNDATION_FILES.length} foundation files present, no duplicate IDs).`,
);
