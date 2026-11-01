import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Fallback drift guard (F1.1): the bundled seed copies under
 * src/i18n/fallback/ must exactly match the API seed files. If this test
 * fails, run `node scripts/sync-i18n-fallback.mjs` (the web build does it
 * automatically on `prebuild`).
 */

const repoRoot = resolve(__dirname, '../../..');
const seedDir = join(repoRoot, 'apps/api/src/modules/i18n/seed');
const fallbackDir = join(resolve(__dirname, '..'), 'src/i18n/fallback');

const seedFiles = readdirSync(seedDir).filter((file) => file.endsWith('.json'));

describe('bundled i18n fallback copies', () => {
  it('covers every API seed file', () => {
    expect(seedFiles.length).toBeGreaterThan(0);
    for (const file of seedFiles) {
      expect(readFileSync(join(fallbackDir, file), 'utf8'), file).toBeTruthy();
    }
  });

  it.each(seedFiles)('is byte-identical to the API seed %s', (file) => {
    const seed = readFileSync(join(seedDir, file), 'utf8');
    const bundled = readFileSync(join(fallbackDir, file), 'utf8');
    expect(bundled).toBe(seed);
  });

  it('contains the keys the app actually uses (prompt F1.1)', () => {
    for (const file of seedFiles) {
      const parsed: unknown = JSON.parse(readFileSync(join(fallbackDir, file), 'utf8'));
      const flat = flatten(parsed);
      for (const key of [
        'common.currency.toman',
        'common.language',
        'a11y.skipToContent',
        'a11y.mainContent',
        'home.hero.title',
        'home.hero.subtitle',
        'home.cta',
      ]) {
        expect(flat, `${file}:${key}`).toHaveProperty(key);
        expect(flat[key], `${file}:${key}`).not.toBe('');
      }
    }
  });
});

function flatten(nested: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (nested === null || typeof nested !== 'object') return out;
  for (const [key, value] of Object.entries(nested as Record<string, unknown>)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (value !== null && typeof value === 'object') {
      Object.assign(out, flatten(value, path));
    } else if (typeof value === 'string') {
      out[path] = value;
    }
  }
  return out;
}
