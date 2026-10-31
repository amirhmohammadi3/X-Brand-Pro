import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
// Value import (not type-only): Nest reads the constructor parameter type at
// runtime via emitDecoratorMetadata — type-only would break DI (B1.3).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.js';
import type { SessionRow } from '../../db/schema/sessions.js';
import { REDIS, type RedisLike } from '../../redis/redis.client.js';
import { TokenService } from './token.service.js';
import { SESSIONS_REPOSITORY, type SessionsRepositoryLike } from './session.repository.js';

/** Domain events (no secrets in payloads — AGENTS.md section 9). */
export const AUTH_EVENTS = {
  sessionRevoked: 'auth.session.revoked',
  tokenReuseDetected: 'auth.token.reuse_detected',
} as const;

export interface SessionMeta {
  ip: string | null;
  userAgent: string | null;
  /** When true, refresh/login/register responses include the refresh token body field. */
  includeRefreshToken?: boolean;
}

export interface IssuedSession {
  sessionId: string;
  userId: string;
  refreshToken: string;
  expiresAt: Date;
}

function sessionError(code: 'SESSION_REVOKED' | 'TOKEN_REUSED', message: string): HttpException {
  return new HttpException({ code, message }, HttpStatus.UNAUTHORIZED);
}

/**
 * Server-side session lifecycle (B1.3): create, rotate with reuse detection,
 * revoke, list, and the Redis-backed `isActive` check used by JwtAuthGuard.
 *
 * Rotation model: one row per refresh token; a rotation marks the old row
 * `replaced_by = <new row>` and mints a fresh row in the SAME family.
 * Presenting a token that is already revoked OR already replaced burns the
 * whole family (`reuse_detected`) — that is the sound of a stolen token.
 */
@Injectable()
export class SessionService {
  private readonly activeTtlSec = 60;

  constructor(
    @Inject(SESSIONS_REPOSITORY) private readonly repo: SessionsRepositoryLike,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(REDIS) private readonly redis: RedisLike,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly events: EventEmitter2,
  ) {}

  private activeKey(sessionId: string): string {
    return `session:active:${sessionId}`;
  }

  async create(userId: string, meta: SessionMeta): Promise<IssuedSession> {
    const refreshToken = this.tokens.generateRefreshToken();
    const expiresAt = new Date(Date.now() + this.config.refreshTtlSec * 1000);
    const row = await this.repo.insert({
      userId,
      familyId: randomUUID(),
      refreshHash: this.tokens.hashRefresh(refreshToken),
      userAgent: meta.userAgent,
      ip: meta.ip,
      expiresAt,
    });
    return { sessionId: row.id, userId: row.userId, refreshToken, expiresAt: row.expiresAt };
  }

  /**
   * Rotate a refresh token. Throws TOKEN_REUSED (and burns the family) when
   * the presented token was already replaced or revoked; SESSION_REVOKED for
   * unknown or expired tokens.
   */
  async rotate(refreshToken: string, meta: SessionMeta): Promise<IssuedSession> {
    const hash = this.tokens.hashRefresh(refreshToken);
    const row = await this.repo.findByRefreshHash(hash);
    if (!row) throw sessionError('SESSION_REVOKED', 'Refresh token not recognized');

    if (row.revokedAt !== null || row.replacedBy !== null) {
      // Reuse of an already-consumed/revoked token: burn the whole family.
      const revoked = await this.repo.revokeFamily(row.familyId, 'reuse_detected');
      this.redis.del(...(await this.activeKeysForFamily(row))).catch(() => {});
      this.events.emit(AUTH_EVENTS.tokenReuseDetected, {
        userId: row.userId,
        sessionId: row.id,
        familySize: revoked + 1,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw sessionError('TOKEN_REUSED', 'Refresh token was already used');
    }

    if (row.expiresAt.getTime() <= Date.now()) {
      throw sessionError('SESSION_REVOKED', 'Refresh token expired');
    }

    const refreshTokenNew = this.tokens.generateRefreshToken();
    const newRow = await this.repo.insert({
      userId: row.userId,
      familyId: row.familyId,
      refreshHash: this.tokens.hashRefresh(refreshTokenNew),
      userAgent: meta.userAgent ?? row.userAgent,
      ip: meta.ip ?? row.ip,
      expiresAt: new Date(Date.now() + this.config.refreshTtlSec * 1000),
    });
    await this.repo.markReplaced(row.id, newRow.id);
    await this.repo.touchUsed(row.id, new Date());
    this.redis.del(this.activeKey(row.id)).catch(() => {});
    return {
      sessionId: newRow.id,
      userId: newRow.userId,
      refreshToken: refreshTokenNew,
      expiresAt: newRow.expiresAt,
    };
  }

  private async activeKeysForFamily(row: SessionRow): Promise<string[]> {
    const family = await this.repo.listActiveForUser(row.userId);
    return family.filter((s) => s.familyId === row.familyId).map((s) => this.activeKey(s.id));
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.repo.revoke(sessionId, reason);
    this.redis.del(this.activeKey(sessionId)).catch(() => {});
    this.events.emit(AUTH_EVENTS.sessionRevoked, { sessionId, reason });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<number> {
    const active = await this.repo.listActiveForUser(userId);
    let count = 0;
    for (const s of active) {
      if (exceptSessionId && s.id === exceptSessionId) continue;
      await this.repo.revoke(s.id, 'logout_all');
      this.redis.del(this.activeKey(s.id)).catch(() => {});
      this.events.emit(AUTH_EVENTS.sessionRevoked, { sessionId: s.id, reason: 'logout_all' });
      count += 1;
    }
    return count;
  }

  async listForUser(userId: string): Promise<SessionRow[]> {
    return this.repo.listActiveForUser(userId);
  }

  /**
   * Redis-cached liveness (TTL 60s) with a database fallback on cache miss
   * AND on Redis failure — a Redis outage must not resurrect revoked tokens
   * (fail closed to the DB, never open).
   */
  async isActive(sessionId: string): Promise<boolean> {
    try {
      const cached = await this.redis.get(this.activeKey(sessionId));
      if (cached === '1') return true;
    } catch {
      // fall through to the database
    }
    const row = await this.repo.findById(sessionId);
    const active = row !== null && row.revokedAt === null && row.expiresAt.getTime() > Date.now();
    if (active) {
      try {
        await this.redis.set(this.activeKey(sessionId), '1', 'EX', this.activeTtlSec);
      } catch {
        // cache write failures are non-fatal
      }
    }
    return active;
  }
}
