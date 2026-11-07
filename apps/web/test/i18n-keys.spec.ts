/**
 * i18n key coverage (Q1.1). Scans every .ts/.tsx file under `apps/web/src` for
 * translation calls (`useTranslations`/`getTranslations` namespace +
 * `t('...')`/`tRoot('...')` string-literal calls), composes the full dotted
 * key, and asserts every key resolves to a string leaf in BOTH seed bundles
 * (`src/i18n/fallback/{fa,en}.json`, which `sync-i18n-fallback.mjs` keeps
 * byte-identical to the API seeds).
 *
 * Dynamic keys (template literals, variables, `err.messageKey`) are skipped —
 * only string-literal first args are collected, so this catches the common
 * "I referenced `t('account.settings.password.title')` but forgot to add it
 * to the seeds" bug without false positives on parameterised calls.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import faSeed from '../src/i18n/fallback/fa.json';
import enSeed from '../src/i18n/fallback/en.json';

const SRC_DIR = path.resolve(__dirname, '..', 'src');

/** Recursively collect .ts/.tsx source files under a directory. */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Flatten a nested message tree into dot-path → string-leaf pairs. */
function flattenLeaves(
  node: unknown,
  prefix = '',
  acc: Record<string, string> = {},
): Record<string, string> {
  if (node === null || typeof node !== 'object') return acc;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const pathKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      acc[pathKey] = value;
    } else if (value !== null && typeof value === 'object') {
      flattenLeaves(value, pathKey, acc);
    }
  }
  return acc;
}

const FA_KEYS = new Set(Object.keys(flattenLeaves(faSeed)));
const EN_KEYS = new Set(Object.keys(flattenLeaves(enSeed)));

/**
 * Per-file: find each `const X = useTranslations('ns')` / `getTranslations('ns')`
 * (ns optional → root) and collect the string-literal first arg of every `X(...)`
 * call, composing `ns.arg` (or just `arg` for root).
 */
function extractKeysFromFile(source: string): string[] {
  const nsByVar = new Map<string, string>();
  // `const t = useTranslations('account.settings')` or `const tRoot = useTranslations()`.
  const nsRe =
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:useTranslations|getTranslations)\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/g;
  for (let m: RegExpExecArray | null = nsRe.exec(source); m !== null; m = nsRe.exec(source)) {
    const varName = m[1];
    const ns = m[2] ?? m[3] ?? ''; // undefined arg → root namespace
    nsByVar.set(varName, ns);
  }
  if (nsByVar.size === 0) return [];

  const keys: string[] = [];
  for (const [varName, ns] of nsByVar) {
    // `<varName>('literal'` or `<varName>("literal"` — first string-literal arg only.
    const callRe = new RegExp(
      `\\b${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\(\\s*(?:'([^']*)'|"([^"]*)")`,
      'g',
    );
    for (let m: RegExpExecArray | null = callRe.exec(source); m !== null; m = callRe.exec(source)) {
      const segment = m[1] ?? m[2];
      if (segment === undefined) continue;
      keys.push(ns ? `${ns}.${segment}` : segment);
    }
  }
  return keys;
}

const REFERENCED_KEYS: string[] = [];
for (const file of collectSourceFiles(SRC_DIR)) {
  const source = readFileSync(file, 'utf8');
  for (const key of extractKeysFromFile(source)) REFERENCED_KEYS.push(key);
}

// De-duplicate for a stable, readable failure output.
const UNIQUE_KEYS = [...new Set(REFERENCED_KEYS)].sort();

describe('i18n key coverage (Q1.1)', () => {
  it('every translation key referenced in web source exists in both seed bundles', () => {
    expect(UNIQUE_KEYS.length, 'expected at least one referenced key').toBeGreaterThan(0);

    const missingFa: string[] = [];
    const missingEn: string[] = [];
    for (const key of UNIQUE_KEYS) {
      if (!FA_KEYS.has(key)) missingFa.push(key);
      if (!EN_KEYS.has(key)) missingEn.push(key);
    }

    expect(
      { missingFa, missingEn, totalReferenced: UNIQUE_KEYS.length },
      'every t()/tRoot() string-literal key in apps/web/src must resolve to a string leaf in both fa.json and en.json',
    ).toEqual({ missingFa: [], missingEn: [], totalReferenced: UNIQUE_KEYS.length });
  });

  it('the fa and en seed bundles expose the same set of message keys', () => {
    const onlyFa = [...FA_KEYS].filter((k) => !EN_KEYS.has(k));
    const onlyEn = [...EN_KEYS].filter((k) => !FA_KEYS.has(k));
    expect(
      { onlyFa, onlyEn },
      'fa.json and en.json must stay in sync (same key set) — run `node scripts/sync-i18n-fallback.mjs` after editing a seed',
    ).toEqual({ onlyFa: [], onlyEn: [] });
  });
});
