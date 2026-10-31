import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Secret encryption for the settings table (B1.1): AES-256-GCM with a key
 * derived from the SETTINGS_ENCRYPTION_KEY env value. Wire format:
 *   v1.<iv b64url>.<tag b64url>.<ciphertext b64url>
 * The version prefix allows future key-rotation formats without re-reading
 * old values. GCM's auth tag makes tampering and wrong-key decryption fail
 * loudly instead of returning garbage.
 */
const VERSION = 'v1';
const KEY_LENGTH = 32; // AES-256
const IV_LENGTH = 12; // GCM recommended nonce size
const SALT = 'xbrand.settings.v1'; // static salt: the env key is the real secret

export function deriveKey(keyMaterial: string): Buffer {
  if (keyMaterial.length < 32) {
    throw new Error(
      'SETTINGS_ENCRYPTION_KEY is too short — provide at least 32 characters (generate with `pnpm env:init`)',
    );
  }
  return scryptSync(keyMaterial, SALT, KEY_LENGTH);
}

export function encryptSecret(plaintext: string, keyMaterial: string): string {
  const key = deriveKey(keyMaterial);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(encoded: string, keyMaterial: string): string {
  const [version, ivPart, tagPart, ciphertextPart] = encoded.split('.');
  if (version !== VERSION || !ivPart || !tagPart || !ciphertextPart) {
    throw new Error(`Unsupported secret envelope (expected ${VERSION}.iv.tag.ciphertext)`);
  }
  const key = deriveKey(keyMaterial);
  try {
    const iv = Buffer.from(ivPart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');
    const ciphertext = Buffer.from(ciphertextPart, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error(
      'Secret decryption failed — the stored value was tampered with or SETTINGS_ENCRYPTION_KEY changed',
    );
  }
}

/** True when the stored value looks like our encrypted envelope. */
export function isEncryptedEnvelope(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts[0] === VERSION;
}

/** Never log or return a real secret — fixed-length mask for admin views. */
export const SECRET_MASK = '••••••••';
