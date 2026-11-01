import {
  isEncryptedEnvelope,
  decryptSecret,
  encryptSecret,
} from '../modules/settings/secret-crypto.js';
import type { Pool } from 'pg';

/**
 * Settings-key rotation (I1.1). Re-encrypts every secret setting with a NEW
 * SETTINGS_ENCRYPTION_KEY inside ONE transaction — a half-rotated table is
 * impossible (any failure rolls back everything). Rows that are not
 * encrypted envelopes are skipped. Never logs secret values.
 *
 * Importable for the integration test; the CLI is rotate-settings-key.cli.ts.
 */
export async function rotateSettingsKey(
  pool: Pool,
  oldKey: string,
  newKey: string,
  log: (message: string) => void = (message) => console.log(`[rotate] ${message}`),
): Promise<{ rotated: number; skipped: number }> {
  if (newKey.length < 32) {
    throw new Error(
      'the new SETTINGS_ENCRYPTION_KEY must be at least 32 characters (pnpm env:init format)',
    );
  }
  if (oldKey === newKey) {
    throw new Error('the new SETTINGS_ENCRYPTION_KEY must differ from the current key');
  }

  const client = await pool.connect();
  const counts = { rotated: 0, skipped: 0 };
  try {
    await client.query('BEGIN');
    const rows = await client.query<{ key: string; value: unknown }>(
      'SELECT key, value FROM settings WHERE is_secret = true FOR UPDATE',
    );
    for (const row of rows.rows) {
      const stored = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
      if (!isEncryptedEnvelope(stored)) {
        counts.skipped += 1;
        continue;
      }
      const plaintext = decryptSecret(stored, oldKey); // wrong key throws → rollback
      const reencrypted = encryptSecret(plaintext, newKey);
      await client.query('UPDATE settings SET value = $1, updated_at = now() WHERE key = $2', [
        reencrypted,
        row.key,
      ]);
      counts.rotated += 1;
      log(`rotated: ${row.key}`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  log(`done: ${counts.rotated} secret(s) rotated, ${counts.skipped} skipped (non-envelope)`);
  return counts;
}
