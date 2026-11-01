import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { createHash } from 'node:crypto';
import { AUTH_SERVICE_EVENTS } from '../auth/auth.service.js';
import { AUTH_EVENTS } from '../auth/session.service.js';
import { SETTINGS_EVENTS } from '../settings/settings.service.js';
// Value import: the constructor param type feeds emitDecoratorMetadata for
// Nest DI — a type-only import would crash dependency resolution.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DI metadata
import { AuditService } from './audit.service.js';

/** Failed logins are sampled: at most ONE row per identifier hash per minute. */
const LOGIN_FAILED_SAMPLE_MS = 60_000;

/**
 * Maps auth/settings domain events to audit rows (B1.11). The subscriber is
 * the ONLY writer for these actions — services emit, audit persists — so a
 * removed listener can never silently drop the trail.
 */
@Injectable()
export class AuthAuditSubscriber {
  /** identifier-hash → last written timestamp (in-process sampling window). */
  private readonly lastFailedLoginAt = new Map<string, number>();

  constructor(private readonly audit: AuditService) {}

  @OnEvent(AUTH_SERVICE_EVENTS.registered)
  onRegistered(payload: { userId: string; username: string; ip?: string | null }): void {
    this.audit.log({
      actor: { id: payload.userId, role: 'user' },
      action: 'auth.register',
      entityType: 'user',
      entityId: payload.userId,
      after: { username: payload.username },
      request: { ip: payload.ip ?? null },
    });
  }

  @OnEvent(AUTH_SERVICE_EVENTS.loginSucceeded)
  onLoginSucceeded(payload: { userId: string; sessionId: string; ip?: string | null }): void {
    this.audit.log({
      actor: { id: payload.userId },
      action: 'auth.login',
      entityType: 'session',
      entityId: payload.sessionId,
      request: { ip: payload.ip ?? null },
    });
  }

  @OnEvent(AUTH_SERVICE_EVENTS.loginFailed)
  onLoginFailed(payload: { userId?: string | null; ip?: string | null; reason?: string }): void {
    // Sample: hash whatever identifies the attempt (userId, else ip+reason)
    // and write at most one row per hash per minute — a brute-force burst
    // must not flood the trail.
    const identity = payload.userId ?? `${payload.ip ?? 'unknown'}:${payload.reason ?? 'unknown'}`;
    const hash = createHash('sha256').update(identity).digest('hex').slice(0, 16);
    const now = Date.now();
    const last = this.lastFailedLoginAt.get(hash) ?? 0;
    if (now - last < LOGIN_FAILED_SAMPLE_MS) return;
    this.lastFailedLoginAt.set(hash, now);
    if (this.lastFailedLoginAt.size > 1000) {
      // Bound the sampling map — entries older than the window are prunable.
      for (const [key, ts] of this.lastFailedLoginAt) {
        if (now - ts >= LOGIN_FAILED_SAMPLE_MS) this.lastFailedLoginAt.delete(key);
      }
    }
    this.audit.log({
      actor: payload.userId ? { id: payload.userId } : null,
      action: 'auth.login_failed',
      entityType: payload.userId ? 'user' : null,
      entityId: payload.userId ?? null,
      after: { reason: payload.reason ?? null },
      request: { ip: payload.ip ?? null },
    });
  }

  @OnEvent(AUTH_SERVICE_EVENTS.logout)
  onLogout(payload: { userId: string; sessionId: string }): void {
    this.audit.log({
      actor: { id: payload.userId },
      action: 'auth.logout',
      entityType: 'session',
      entityId: payload.sessionId,
    });
  }

  @OnEvent(AUTH_EVENTS.sessionRevoked)
  onSessionRevoked(payload: { sessionId: string; reason: string; userId?: string | null }): void {
    this.audit.log({
      actor: payload.userId ? { id: payload.userId } : null,
      action: 'auth.session_revoked',
      entityType: 'session',
      entityId: payload.sessionId,
      after: { reason: payload.reason },
    });
  }

  @OnEvent(AUTH_EVENTS.tokenReuseDetected)
  onTokenReuse(payload: {
    userId: string;
    sessionId: string;
    familySize: number;
    ip?: string | null;
    userAgent?: string | null;
  }): void {
    this.audit.log({
      actor: { id: payload.userId },
      action: 'auth.token_reuse',
      entityType: 'session',
      entityId: payload.sessionId,
      after: { familySize: payload.familySize },
      request: { ip: payload.ip ?? null, userAgent: payload.userAgent ?? null },
    });
  }

  @OnEvent(SETTINGS_EVENTS.updated)
  onSettingsUpdated(payload: {
    key: string;
    actorId?: string | null;
    actorRole?: string | null;
    before: unknown;
    after: unknown;
    changed: boolean;
    action: 'settings.update' | 'settings.reset';
  }): void {
    this.audit.log({
      actor: payload.actorId ? { id: payload.actorId, role: payload.actorRole ?? null } : null,
      action: payload.action,
      entityType: 'setting',
      entityId: payload.key,
      before: payload.before,
      after: payload.after,
    });
  }
}
