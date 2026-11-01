#!/usr/bin/env node
/**
 * sync-i18n-fallback.mjs (F1.1) — copies the API seed message files into the
 * web app so the site still renders when the API is unreachable (bundled
 * fallback bundles). Run automatically via the web package's `prebuild`
 * script; also runnable by hand after editing the seeds.
 *
 * Cross-platform pure Node (AGENTS.md section 4). Deterministic output: the
 * files are committed and the drift is guarded by test/i18n-fallback-sync.spec.ts.
 */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seedDir = join(repoRoot, 'apps/api/src/modules/i18n/seed');
const outDir = join(repoRoot, 'apps/web/src/i18n/fallback');

mkdirSync(outDir, { recursive: true });

const files = readdirSync(seedDir).filter((file) => file.endsWith('.json'));
if (files.length === 0) {
  console.error(`[sync-i18n-fallback] no seed files found in ${seedDir}`);
  process.exit(1);
}
for (const file of files) {
  copyFileSync(join(seedDir, file), join(outDir, file));
  console.log(`[sync-i18n-fallback] ${file}`);
}
