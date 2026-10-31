import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REQUIRED_EXTENSIONS, resolveMigrationsFolder } from '../src/db/migrate.js';

const drizzleDir = path.resolve(__dirname, '..', 'drizzle');

describe('drizzle migrations folder (B0.2)', () => {
  it('has a journal whose every entry points at an existing SQL file', () => {
    const journalPath = path.join(drizzleDir, 'meta', '_journal.json');
    expect(existsSync(journalPath)).toBe(true);
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      version: string;
      dialect: string;
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.dialect).toBe('postgresql');
    expect(Array.isArray(journal.entries)).toBe(true);
    for (const entry of journal.entries) {
      expect(existsSync(path.join(drizzleDir, `${entry.tag}.sql`))).toBe(true);
    }
  });

  it('requires exactly the four project extensions, in a stable order', () => {
    expect([...REQUIRED_EXTENSIONS]).toEqual(['postgis', 'pg_trgm', 'unaccent', 'pgcrypto']);
  });

  it('resolves the migrations folder relative to the compiled file', () => {
    const resolved = resolveMigrationsFolder();
    expect(path.basename(resolved)).toBe('drizzle');
    expect(existsSync(resolved)).toBe(true);
  });
});
