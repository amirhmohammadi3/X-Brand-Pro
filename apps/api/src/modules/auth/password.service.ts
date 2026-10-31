import { Injectable } from '@nestjs/common';
import {
  argon2id,
  hash as argon2Hash,
  needsRehash as argon2NeedsRehash,
  verify as argon2Verify,
} from 'argon2';

/**
 * OWASP Password Storage Cheat Sheet (2024+) recommended argon2id parameters
 * for interactive logins: m=19 MiB (19456 KiB), t=2, p=1. Recorded in
 * docs/DECISIONS.md (2026-11-01 B1.3). Changing them invalidates old hashes
 * gradually via needsRehash() — never change without a DECISIONS entry.
 */
export const ARGON2_PARAMS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/** Pure helper shared with the seeder CLI (no Nest DI needed there). */
export function hashPassword(plain: string): Promise<string> {
  return argon2Hash(plain, { type: argon2id, ...ARGON2_PARAMS });
}

/**
 * Password hashing/verification (B1.3).
 *
 * Timing-attack mitigation: verifying a password for a user that does not
 * exist (or has no password yet) performs a dummy verification against a
 * precomputed hash so the response time matches the "user exists" path.
 */
@Injectable()
export class PasswordService {
  /** Computed once on first use; argon2 hashes are self-describing. */
  private dummyHash: string | null = null;

  hash(plain: string): Promise<string> {
    return hashPassword(plain);
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return argon2Verify(hash, plain);
  }

  /** True when the stored hash no longer matches the current parameters. */
  needsRehash(hash: string): boolean {
    return argon2NeedsRehash(hash, ARGON2_PARAMS);
  }

  /**
   * Burn the same CPU time as a real verification when the account is
   * unknown. Failures are fine — only the delay matters.
   */
  async dummyVerify(plain: string): Promise<void> {
    this.dummyHash ??= await argon2Hash('dummy-password-for-timing', {
      type: argon2id,
      ...ARGON2_PARAMS,
    });
    try {
      await argon2Verify(this.dummyHash, plain);
    } catch {
      // never happens for argon2.verify with valid inputs; kept for safety
    }
  }
}
