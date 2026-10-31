import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  deriveKey,
  encryptSecret,
  isEncryptedEnvelope,
  SECRET_MASK,
} from '../src/modules/settings/secret-crypto.js';

const KEY_MATERIAL = 'unit-test-key-material-0123456789abcdef-0123456789';

describe('secret-crypto (B1.1)', () => {
  it('roundtrips unicode plaintext through the v1 envelope', () => {
    const plaintext = JSON.stringify({ token: 'توکن-محرماته', scopes: ['send', 'read'] });
    const encoded = encryptSecret(plaintext, KEY_MATERIAL);
    expect(encoded.startsWith('v1.')).toBe(true);
    expect(encoded).not.toContain('توکن');
    expect(decryptSecret(encoded, KEY_MATERIAL)).toBe(plaintext);
  });

  it('detects tampering (any bit flipped in ciphertext/tag/iv fails)', () => {
    const encoded = encryptSecret('secret-value', KEY_MATERIAL);
    const [version, iv, tag, ciphertext] = encoded.split('.');
    if (!version || !iv || !tag || !ciphertext) throw new Error('malformed envelope in test');
    const tamperedTag = Buffer.from(tag, 'base64url');
    const firstByte = tamperedTag[0];
    if (firstByte === undefined) throw new Error('empty auth tag in test');
    tamperedTag[0] = firstByte ^ 0xff;
    const tampered = [version, iv, tamperedTag.toString('base64url'), ciphertext].join('.');
    expect(() => decryptSecret(tampered, KEY_MATERIAL)).toThrow(/decryption failed/);
  });

  it('fails with a different key (rotated key cannot silently read old values)', () => {
    const encoded = encryptSecret('secret-value', KEY_MATERIAL);
    expect(() => decryptSecret(encoded, `${KEY_MATERIAL}-rotated`)).toThrow(/decryption failed/);
  });

  it('rejects short key material and malformed envelopes', () => {
    expect(() => deriveKey('short')).toThrow(/too short/);
    expect(() => decryptSecret('v2.a.b.c', KEY_MATERIAL)).toThrow(/Unsupported secret envelope/);
    expect(() => decryptSecret('not-an-envelope', KEY_MATERIAL)).toThrow(
      /Unsupported secret envelope/,
    );
  });

  it('recognizes its own envelopes and masks secrets with a fixed mask', () => {
    expect(isEncryptedEnvelope(encryptSecret('x', KEY_MATERIAL))).toBe(true);
    expect(isEncryptedEnvelope('plain-value')).toBe(false);
    expect(SECRET_MASK).toBe('••••••••');
  });
});
