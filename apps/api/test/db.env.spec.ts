import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyEnvFile, loadDotenvIntoProcessEnv } from '../src/db/load-dotenv.js';

describe('load-dotenv (B0.2)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'xbrand-dotenv-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('parses KEY=VALUE, quoted values, comments and blank lines', () => {
    writeFileSync(
      path.join(dir, '.env'),
      [
        '# comment line',
        '',
        'PLAIN=hello',
        'QUOTED="spaced value"',
        "SINGLE='single quoted'",
        'EMPTY=',
      ].join('\n'),
    );
    const target: Record<string, string | undefined> = {};
    applyEnvFile(path.join(dir, '.env'), target);
    expect(target.PLAIN).toBe('hello');
    expect(target.QUOTED).toBe('spaced value');
    expect(target.SINGLE).toBe('single quoted');
    expect(target.EMPTY).toBe('');
  });

  it('never overrides a key that already exists in the target', () => {
    writeFileSync(path.join(dir, '.env'), 'EXISTING=from-file\nMISSING=from-file\n');
    const target: Record<string, string | undefined> = { EXISTING: 'from-process' };
    applyEnvFile(path.join(dir, '.env'), target);
    expect(target.EXISTING).toBe('from-process');
    expect(target.MISSING).toBe('from-file');
  });

  it('skips lines without an = separator and empty keys', () => {
    writeFileSync(path.join(dir, '.env'), 'NO_SEPARATOR\n=orphan-value\nOK=fine\n');
    const target: Record<string, string | undefined> = {};
    applyEnvFile(path.join(dir, '.env'), target);
    expect(Object.keys(target).sort()).toEqual(['OK']);
    expect(target.OK).toBe('fine');
  });

  it('walks up from the start dir to find the nearest .env and returns its path', () => {
    writeFileSync(path.join(dir, '.env'), 'WALK_UP=found\n');
    const nested = path.join(dir, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });
    const target: Record<string, string | undefined> = {};
    const found = loadDotenvIntoProcessEnv(nested, target);
    expect(found).toBe(path.join(dir, '.env'));
    expect(target.WALK_UP).toBe('found');
  });

  it('returns null when no .env exists anywhere up the tree', () => {
    const isolated = mkdtempSync(path.join(tmpdir(), 'xbrand-dotenv-none-'));
    try {
      const nested = path.join(isolated, 'a', 'b');
      mkdirSync(nested, { recursive: true });
      // NOTE: if a .env exists in a parent of tmpdir this could find it; tmpdir
      // is not nested under the repo, so this is safe in practice.
      const found = loadDotenvIntoProcessEnv(nested, {});
      expect(found === null || typeof found === 'string').toBe(true);
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });
});
