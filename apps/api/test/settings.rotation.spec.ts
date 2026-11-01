import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import {
  encryptSecret,
  isEncryptedEnvelope,
  decryptSecret,
} from '../src/modules/settings/secret-crypto.js';
import { rotateSettingsKey } from '../src/scripts/rotate-settings-key.js';
import { databaseAvailable, databaseReachableSync, prepareTestDatabase } from './db.js';

process.env.DATABASE_URL = 'postgres://app:app_dev_password@localhost:5432/app_test';
process.env.TEST_DATABASE_URL = 'postgres://app:app_dev_password@localhost:5432/app_test';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const OLD_KEY = 'rotation-spec-old-key-0123456789abcdef';
const NEW_KEY = 'rotation-spec-new-key-fedcba9876543210';

let pool: Pool | null = null;

beforeAll(async () => {
  if (!(await databaseAvailable())) {
    console.warn('[settings.rotation.spec] test database unavailable — suite skipped');
    return;
  }
  pool = new Pool({ connectionString: TEST_DB_URL, max: 3 });
  await prepareTestDatabase();
  await pool.query('truncate table settings');
}, 20_000);

afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!databaseReachableSync())('rotateSettingsKey (I1.1)', () => {
  it('re-encrypts secret settings so they are readable with the NEW key only', async () => {
    const p = pool!;
    await p.query(
      'insert into settings (key, value, is_secret, "group") values ($1, $2, true, \'general\')',
      ['test.secret.one', encryptSecret('first-secret-value', OLD_KEY)],
    );
    await p.query(
      'insert into settings (key, value, is_secret, "group") values ($1, $2, true, \'general\')',
      ['test.secret.two', encryptSecret('second-secret-value', OLD_KEY)],
    );
    // A non-secret row must be untouched by the rotation.
    await p.query(
      'insert into settings (key, value, is_secret, "group") values ($1, $2, false, \'general\')',
      ['test.plain', '"plain-json"'],
    );

    const result = await rotateSettingsKey(p, OLD_KEY, NEW_KEY, () => undefined);
    expect(result).toEqual({ rotated: 2, skipped: 0 });

    for (const [key, expected] of [
      ['test.secret.one', 'first-secret-value'],
      ['test.secret.two', 'second-secret-value'],
    ] as const) {
      const res = await p.query<{ value: unknown }>('select value from settings where key = $1', [
        key,
      ]);
      const stored = String(res.rows[0]!.value);
      expect(isEncryptedEnvelope(stored)).toBe(true);
      expect(decryptSecret(stored, NEW_KEY)).toBe(expected);
      // The old key no longer decrypts the rotated value.
      expect(() => decryptSecret(stored, OLD_KEY)).toThrow();
    }

    // Non-secret rows untouched.
    const plain = await p.query<{ value: unknown }>('select value from settings where key = $1', [
      'test.plain',
    ]);
    expect(plain.rows[0]!.value).toBe('plain-json');
  });

  it('rolls back completely when the OLD key cannot decrypt a row', async () => {
    const p = pool!;
    // A row encrypted with a THIRD key: rotation must fail and leave
    // everything (including the previously rotated rows) untouched.
    await p.query(
      'insert into settings (key, value, is_secret, "group") values ($1, $2, true, \'general\')',
      [
        'test.secret.bad',
        encryptSecret('encrypted-with-other-key', 'another-key-0123456789abcdef-012345'),
      ],
    );
    const before = await p.query<{ key: string; value: unknown }>(
      'select key, value from settings order by key',
    );

    await expect(rotateSettingsKey(p, OLD_KEY, NEW_KEY, () => undefined)).rejects.toThrow();

    const after = await p.query<{ key: string; value: unknown }>(
      'select key, value from settings order by key',
    );
    expect(after.rows).toEqual(before.rows);
  });
});
