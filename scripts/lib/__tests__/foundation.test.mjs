import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findMissingFoundationFiles,
  findDuplicatePromptIds,
  FOUNDATION_FILES,
} from '../foundation.mjs';

test('FOUNDATION_FILES lists the 8 expected files', () => {
  assert.equal(FOUNDATION_FILES.length, 8);
  assert.ok(FOUNDATION_FILES.includes('AGENTS.md'));
  assert.ok(FOUNDATION_FILES.includes('docs/PROGRESS.md'));
});

test('findMissingFoundationFiles returns empty when all present', () => {
  const tracked = [...FOUNDATION_FILES, 'package.json', 'src/index.ts'];
  assert.deepEqual(findMissingFoundationFiles(tracked), []);
});

test('findMissingFoundationFiles reports missing files', () => {
  const tracked = ['AGENTS.md', 'docs/PROGRESS.md', 'package.json'];
  const missing = findMissingFoundationFiles(tracked);
  assert.ok(missing.includes('docs/DECISIONS.md'));
  assert.ok(missing.includes('docs/DESIGN.md'));
  assert.ok(missing.includes('docs/API.md'));
  assert.ok(missing.includes('docs/DATA_MODEL.md'));
  assert.ok(missing.includes('docs/SECURITY.md'));
  assert.ok(missing.includes('docs/DEPLOYMENT.md'));
  assert.equal(missing.length, 6);
});

test('findMissingFoundationFiles normalises backslashes (Windows)', () => {
  const tracked = ['AGENTS.md', 'docs\\PROGRESS.md', 'docs\\DECISIONS.md'];
  // Only docs/PROGRESS.md and docs/DECISIONS.md would match after normalisation.
  const missing = findMissingFoundationFiles(tracked);
  assert.ok(!missing.includes('docs/PROGRESS.md'));
  assert.ok(!missing.includes('docs/DECISIONS.md'));
});

test('findDuplicatePromptIds finds duplicates', () => {
  const md = `
- [ ] P0.1 🟢 first
- [ ] P0.2 🟢 second
- [x] P0.1 🟢 duplicate
- [ ] B1.3 🔴 hard
`;
  const dups = findDuplicatePromptIds(md);
  assert.deepEqual(dups, ['P0.1']);
});

test('findDuplicatePromptIds returns empty when no duplicates', () => {
  const md = `
- [ ] P0.1 🟢 first
- [ ] P0.2 🟢 second
- [ ] B1.3 🔴 hard
`;
  assert.deepEqual(findDuplicatePromptIds(md), []);
});

test('findDuplicatePromptIds handles already-ticked items', () => {
  const md = `
- [x] P0.1 🟢 done (2026-10-31)
- [ ] P0.2 🟢 next
`;
  assert.deepEqual(findDuplicatePromptIds(md), []);
});
