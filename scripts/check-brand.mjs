#!/usr/bin/env node
// scripts/check-brand.mjs — fails if the brand name (nameFa/nameEn) appears
// in any tracked text file outside the allow-list (docs/, brand.ts itself,
// pnpm-lock.yaml, i18n seed JSON, logo SVGs).
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractBrandNames, isBrandAllowed, findBrandOccurrence } from './lib/brand.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function gitLsFiles() {
  try {
    const out = execSync('git ls-files', { cwd: repoRoot, encoding: 'utf8' });
    return out.split(/\r?\n/).filter(Boolean);
  } catch (_e) {
    console.error('check-brand: could not run `git ls-files`. Are you in a git repo?');
    process.exit(2);
  }
}

const brandTsPath = path.join(repoRoot, 'packages', 'config', 'src', 'brand.ts');
const brandSource = readFileSync(brandTsPath, 'utf8');
const brand = extractBrandNames(brandSource);
if (!brand) {
  console.error('check-brand: could not extract nameFa/nameEn from packages/config/src/brand.ts');
  process.exit(2);
}

const tracked = gitLsFiles();
const failures = [];
for (const rel of tracked) {
  const posix = rel.replace(/\\/g, '/');
  if (isBrandAllowed(posix)) continue;
  // Skip binary files (by extension) — we can't scan them as text.
  if (/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|pdf|zip|gz|tar)$/i.test(posix)) continue;
  const abs = path.join(repoRoot, rel);
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    continue; // binary or unreadable — skip
  }
  const line = findBrandOccurrence(text, brand);
  if (line !== null) {
    failures.push({ file: posix, line });
  }
}

if (failures.length > 0) {
  console.error(
    `check-brand: brand name "${brand.nameEn}" / "${brand.nameFa}" found outside the allow-list:`,
  );
  for (const f of failures) console.error(`  - ${f.file}:${f.line}`);
  process.exit(1);
}

console.log(`check-brand: OK (brand name only appears in allow-listed files).`);
