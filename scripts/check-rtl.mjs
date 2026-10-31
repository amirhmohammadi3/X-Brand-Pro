#!/usr/bin/env node
// scripts/check-rtl.mjs — fails when apps/web source uses physical
// directional Tailwind classes (ml/mr/pl/pr/left/right/text-left/...).
// A line ending with `// rtl-ok` (or containing /* rtl-ok */ in CSS) is
// exempt for genuinely physical needs such as map controls.
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRtlViolations } from './lib/rtl.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function gitLsFiles() {
  try {
    const out = execSync('git ls-files', { cwd: repoRoot, encoding: 'utf8' });
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    console.error('check-rtl: could not run `git ls-files`. Are you in a git repo?');
    process.exit(2);
  }
}

const targets = gitLsFiles().filter((f) =>
  /^apps\/web\/(src|e2e)\/.*\.(ts|tsx|css)$/i.test(f.replace(/\\/g, '/')),
);

const failures = [];
for (const rel of targets) {
  const abs = path.join(repoRoot, rel);
  let text;
  try {
    text = await import('node:fs').then((fs) => fs.promises.readFile(abs, 'utf8'));
  } catch {
    continue; // deleted but still tracked in the index
  }
  for (const v of findRtlViolations(text)) {
    failures.push({ file: rel, ...v });
  }
}

if (failures.length > 0) {
  console.error(`check-rtl: ${failures.length} physical-direction violation(s):`);
  for (const f of failures) {
    console.error(`  ${f.file}:${f.line}: "${f.match}"`);
    console.error(`    ${f.lineText.trim()}`);
  }
  console.error(
    'Use logical utilities instead: ms-/me-/ps-/pe-/start-/end-/text-start/text-end/border-s/border-e/rounded-s/rounded-e.',
  );
  console.error(
    'If a physical value is genuinely required (e.g. map controls), end the line with `// rtl-ok`.',
  );
  process.exit(1);
}
console.log(`check-rtl: OK (${targets.length} files scanned)`);
