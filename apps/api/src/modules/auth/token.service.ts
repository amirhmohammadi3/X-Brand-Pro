import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.js';

/** Access token claims (B1.3). `sid` ties the token to a server session. */
export interface AccessClaims {
  sub: string;
  sid: string;
  role: string;
  jti: string;
}

/**
 * Token minting/verification (B1.3).
 *
 * - Access token: JWT HS256 signed with JWT_ACCESS_SECRET; claims sub, sid,
 *   role, iat, exp, jti. Short-lived (ACCESS_TTL_SEC, default 15 min).
 * - Refresh token: opaque — 32 random bytes as base64url. Only its SHA-256
 *   hash is stored (sessions.refresh_hash); the raw token is never persisted
 *   or logged.
 */
@Injectable()
export class TokenService {
  private readonly accessKey: Uint8Array;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.accessKey = new TextEncoder().encode(config.jwtAccessSecret);
  }

  async signAccess(claims: { sub: string; sid: string; role: string }): Promise<string> {
    return new SignJWT({ role: claims.role, sid: claims.sid })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(`${this.config.accessTtlSec}s`)
      .sign(this.accessKey);
  }

  /** Returns null for any invalid/expired/tampered token — never throws. */
  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.accessKey, { algorithms: ['HS256'] });
      const sid = (payload as Record<string, unknown>).sid;
      const role = (payload as Record<string, unknown>).role;
      if (typeof payload.sub !== 'string' || typeof sid !== 'string' || typeof role !== 'string') {
        return null;
      }
      return {
        sub: payload.sub,
        sid,
        role,
        jti: typeof payload.jti === 'string' ? payload.jti : '',
      };
    } catch {
      return null;
    }
  }

  /** 32 random bytes as base64url (~43 chars). */
  generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /** SHA-256 hex of the opaque refresh token — this is what the DB stores. */
  hashRefresh(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  /** ISO timestamp when currently issued access tokens will expire. */
  accessExpiresAt(now: number = Date.now()): string {
    return new Date(now + this.config.accessTtlSec * 1000).toISOString();
  }
}
