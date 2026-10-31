#!/usr/bin/env node
// scripts/check-no-external.mjs — fails when apps/web source contains an
// http(s) URL to a third-party host (fonts, scripts, analytics, tiles,
// avatars — AGENTS.md section 7). localhost / 127.0.0.1 are allowed for dev;
// a line containing `external-ok` is exempt with a reason next to it.
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findExternalUrls } from './lib/external.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function gitLsFiles() {
  try {
    const out = execSync('git ls-files', { cwd: repoRoot, encoding: 'utf8' });
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    console.error('check-no-external: could not run `git ls-files`. Are you in a git repo?');
    process.exit(2);
  }
}

const targets = gitLsFiles().filter((f) =>
  /^apps\/web\/(src|e2e|public)\/.*\.(ts|tsx|css|mjs|json|html)$/i.test(f.replace(/\\/g, '/')),
);

const failures = [];
for (const rel of targets) {
  const abs = path.join(repoRoot, rel);
  let text;
  try {
    text = await import('node:fs').then((fs) => fs.promises.readFile(abs, 'utf8'));
  } catch {
    continue;
  }
  for (const v of findExternalUrls(text)) {
    failures.push({ file: rel, ...v });
  }
}

if (failures.length > 0) {
  console.error(`check-no-external: ${failures.length} external URL(s) found:`);
  for (const f of failures) {
    console.error(`  ${f.file}:${f.line}: ${f.url} (host: ${f.host})`);
  }
  console.error(
    'The browser must never talk to a third-party host. Self-host the asset or proxy it through the API.',
  );
  console.error(
    'If a URL is genuinely not a runtime request (docs, code sample), end the line with `// external-ok`.',
  );
  process.exit(1);
}
console.log(`check-no-external: OK (${targets.length} files scanned)`);
