import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
// Value import (not type-only): Nest reads the constructor parameter type at
// runtime via emitDecoratorMetadata — type-only would break DI (B1.3).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import { normalizeDigits, type AuthResult, type CurrentUser } from '@app/contracts';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.js';
import type { UserRow } from '../../db/schema/users.js';
import { PasswordService } from './password.service.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { SessionService, type SessionMeta } from './session.service.js';
import { TokenService } from './token.service.js';
import { UsersService } from '../users/users.service.js';
import { toCurrentUser } from '../users/current-user.mapper.js';

/** Domain events consumed by audit (B1.11) and later notification wiring. */
export const AUTH_SERVICE_EVENTS = {
  registered: 'auth.registered',
  loginSucceeded: 'auth.login.succeeded',
  loginFailed: 'auth.login.failed',
  logout: 'auth.logout',
} as const;

const CONFLICT_FIELD_BY_MESSAGE: Record<string, string> = {
  username_taken: 'username',
  email_taken: 'email',
  phone_taken: 'phone',
};

/**
 * What a completed auth flow hands back to the controller: the enveloped
 * `auth` payload plus the raw tokens so the controller can set cookies (and,
 * for body-based refresh clients, expose the new refresh token). Tokens are
 * NEVER logged by this module.
 */
export interface AuthFlowResult {
  auth: AuthResult;
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

/**
 * Authentication core (B1.3): username/password register + login with
 * argon2id, brute-force lockout, rotating refresh sessions and domain
 * events. Controllers only parse/authorize — all rules live here.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    // Explicit @Inject tokens keep the imports runtime values for DI while
    // satisfying consistent-type-imports (params are type-only otherwise).
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(LoginThrottleService) private readonly throttle: LoginThrottleService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly events: EventEmitter2,
  ) {}

  toCurrentUser(row: UserRow): CurrentUser {
    // Shared mapper (B1.10) — auth responses and /users/me stay identical.
    return toCurrentUser(row);
  }

  /**
   * Normalize a login identifier: Persian/Arabic digits → ASCII, trim,
   * lowercase. Phones additionally collapse to E.164 +989… so `0912…`,
   * `+98912…`, `۹۸۹۱۲…` all hit the same row.
   */
  normalizeIdentifier(raw: string): string {
    const ascii = normalizeDigits(raw)
      .trim()
      .toLowerCase()
      .replace(/[\s\-()]/g, '');
    const phoneMatch = ascii.match(/^(?:\+98|0098|98|0)?9\d{9}$/);
    if (phoneMatch) {
      return `+98${ascii.replace(/^(?:\+98|0098|98|0)/, '')}`;
    }
    return ascii;
  }

  async register(
    body: {
      username: string;
      password: string;
      fullName?: string;
      email?: string;
      phone?: string;
      locale?: string;
    },
    meta: SessionMeta,
  ): Promise<AuthFlowResult> {
    const passwordHash = await this.passwords.hash(body.password);
    let row: UserRow;
    try {
      row = await this.users.create({
        username: body.username,
        email: body.email ?? null,
        phone: body.phone ?? null,
        passwordHash,
        displayName: body.fullName ?? null,
        locale: body.locale ?? null,
        // email/phone are stored UNVERIFIED — B1.7 flips the stamps.
        emailVerified: false,
        phoneVerified: false,
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        const field = CONFLICT_FIELD_BY_MESSAGE[err.message];
        if (field) {
          throw new HttpException(
            {
              code: 'CONFLICT' as const,
              message: `${field} already taken`,
              details: { field },
            },
            HttpStatus.CONFLICT,
          );
        }
      }
      throw err;
    }

    this.events.emit(AUTH_SERVICE_EVENTS.registered, {
      userId: row.id,
      username: row.username,
      ip: meta.ip,
    });

    const issued = await this.sessions.create(row.id, meta);
    const accessToken = await this.tokens.signAccess({
      sub: row.id,
      sid: issued.sessionId,
      role: row.role,
    });
    return {
      auth: { user: this.toCurrentUser(row), accessExpiresAt: this.tokens.accessExpiresAt() },
      accessToken,
      refreshToken: issued.refreshToken,
      sessionId: issued.sessionId,
    };
  }

  async login(
    body: { identifier: string; password: string },
    meta: SessionMeta & { ip: string },
  ): Promise<AuthFlowResult> {
    const identifier = this.normalizeIdentifier(body.identifier);

    // Layer 1 (rate limit) + layer 2 (lockout) — both BEFORE password work.
    await this.throttle.assertCanAttempt(meta.ip, identifier);

    const row = await this.users.getByIdentifier(identifier);
    if (!row || !row.passwordHash) {
      // Same work + same error for unknown identifier and wrong password.
      await this.passwords.dummyVerify(body.password);
      await this.throttle.recordFailure(identifier);
      this.events.emit(AUTH_SERVICE_EVENTS.loginFailed, {
        userId: row?.id,
        ip: meta.ip,
        reason: 'unknown_identifier',
      });
      throw new HttpException(
        { code: 'INVALID_CREDENTIALS' as const, message: 'Invalid credentials' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const passwordOk = await this.passwords.verify(row.passwordHash, body.password);
    if (!passwordOk) {
      await this.throttle.recordFailure(identifier);
      this.events.emit(AUTH_SERVICE_EVENTS.loginFailed, {
        userId: row.id,
        ip: meta.ip,
        reason: 'wrong_password',
      });
      throw new HttpException(
        { code: 'INVALID_CREDENTIALS' as const, message: 'Invalid credentials' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Verified owner may learn the ban state — non-owners get generic 401.
    if (this.users.effectiveStatus(row) === 'blocked' || this.users.isCurrentlyBanned(row)) {
      this.events.emit(AUTH_SERVICE_EVENTS.loginFailed, {
        userId: row.id,
        ip: meta.ip,
        reason: 'banned',
      });
      throw new HttpException(
        { code: 'ACCOUNT_BANNED' as const, message: 'Account is banned' },
        HttpStatus.FORBIDDEN,
      );
    }

    await this.throttle.reset(identifier);
    if (this.passwords.needsRehash(row.passwordHash)) {
      const rehashed = await this.passwords.hash(body.password);
      await this.users.setPasswordHash(row.id, rehashed);
      this.logger.log(`rehashed password for user ${row.id} (parameters upgraded)`);
    }
    await this.users.recordLogin(row.id);

    const issued = await this.sessions.create(row.id, meta);
    const accessToken = await this.tokens.signAccess({
      sub: row.id,
      sid: issued.sessionId,
      role: row.role,
    });
    this.events.emit(AUTH_SERVICE_EVENTS.loginSucceeded, {
      userId: row.id,
      sessionId: issued.sessionId,
      ip: meta.ip,
    });
    return {
      auth: { user: this.toCurrentUser(row), accessExpiresAt: this.tokens.accessExpiresAt() },
      accessToken,
      refreshToken: issued.refreshToken,
      sessionId: issued.sessionId,
    };
  }

  /** Rotate a refresh token into a new session (same family). */
  async refresh(refreshToken: string, meta: SessionMeta & { ip: string }): Promise<AuthFlowResult> {
    const issued = await this.sessions.rotate(refreshToken, meta);
    const row = await this.users.getById(issued.userId);
    // An account banned between rotations dies here; the fresh session burns.
    if (this.users.effectiveStatus(row) === 'blocked' || this.users.isCurrentlyBanned(row)) {
      await this.sessions.revoke(issued.sessionId, 'banned_user');
      throw new HttpException(
        { code: 'ACCOUNT_BANNED' as const, message: 'Account is banned' },
        HttpStatus.FORBIDDEN,
      );
    }
    const accessToken = await this.tokens.signAccess({
      sub: row.id,
      sid: issued.sessionId,
      role: row.role,
    });
    return {
      auth: { user: this.toCurrentUser(row), accessExpiresAt: this.tokens.accessExpiresAt() },
      accessToken,
      refreshToken: issued.refreshToken,
      sessionId: issued.sessionId,
    };
  }

  async logout(sessionId: string, userId: string): Promise<void> {
    await this.sessions.revoke(sessionId, 'logout');
    this.events.emit(AUTH_SERVICE_EVENTS.logout, { userId, sessionId });
  }

  /** GET /auth/me payload — fresh DB read, mapped to the wire shape. */
  async me(userId: string): Promise<CurrentUser> {
    const row = await this.users.getById(userId);
    return this.toCurrentUser(row);
  }

  async logoutAll(userId: string, exceptSessionId?: string): Promise<number> {
    return this.sessions.revokeAllForUser(userId, exceptSessionId);
  }
}
