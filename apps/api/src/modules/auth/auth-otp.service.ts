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
import {
  emailSchema,
  iranMobileSchema,
  maskTarget,
  normalizeDigits,
  type CurrentUser,
  type OtpRequestResult,
} from '@app/contracts';
import { createHash, randomInt } from 'node:crypto';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.js';
import { REDIS, type RedisLike } from '../../redis/redis.client.js';
import { PasswordService } from './password.service.js';
import { SessionService, type SessionMeta } from './session.service.js';
import { TokenService } from './token.service.js';
import { AUTH_SERVICE_EVENTS, type AuthFlowResult } from './auth.service.js';
import { UsersService } from '../users/users.service.js';
import { OtpService } from '../otp/otp.service.js';
import { SmsService } from '../sms/sms.service.js';
import { EmailService } from '../email/email.service.js';
import type { UserRow } from '../../db/schema/users.js';

/** Forgot-password requests per identifier per hour (prompt B1.7). */
export const FORGOT_HOURLY_CAP_PER_IDENTIFIER = 3;

export type OtpAuthChannel = 'sms' | 'email';

const OTP_PURPOSE_LOGIN = 'login';
const OTP_PURPOSE_VERIFY_EMAIL = 'verify_email';
const OTP_PURPOSE_VERIFY_PHONE = 'verify_phone';
const OTP_PURPOSE_RESET_PASSWORD = 'reset_password';

function otpAuthError(
  code: 'CONFLICT' | 'ACCOUNT_BANNED' | 'OTP_INVALID',
  message: string,
  status: HttpStatus,
  details?: Record<string, unknown>,
): HttpException {
  return new HttpException({ code, message, details }, status);
}

/**
 * OTP-based auth flows (B1.7): passwordless login/registration by SMS or
 * email code, verification of email/phone, and password reset. Anti-
 * enumeration: code REQUESTS always issue + send and always answer with the
 * same shape; existence only matters at VERIFY time where the code itself is
 * the gate (residual risk documented in SECURITY.md).
 */
@Injectable()
export class AuthOtpService {
  private readonly logger = new Logger(AuthOtpService.name);

  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(OtpService) private readonly otp: OtpService,
    @Inject(SmsService) private readonly sms: SmsService,
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(REDIS) private readonly redis: RedisLike,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly events: EventEmitter2,
  ) {}

  /** Normalize per channel: phones → E.164 (Persian digits ok), emails → lc. */
  normalizeTarget(channel: OtpAuthChannel, raw: string): string {
    const parsed = channel === 'sms' ? iranMobileSchema.safeParse(raw) : emailSchema.safeParse(raw);
    if (!parsed.success) {
      throw new HttpException(
        {
          code: 'VALIDATION_FAILED' as const,
          message: channel === 'sms' ? 'invalid mobile number' : 'invalid email address',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    return parsed.data;
  }

  /** Username/email/phone normalization for forgot/reset (AuthService rule). */
  normalizeIdentifier(raw: string): string {
    const ascii = normalizeDigits(raw)
      .trim()
      .toLowerCase()
      .replace(/[\s\-()]/g, '');
    const phoneMatch = ascii.match(/^(?:\+98|0098|98|0)?9\d{9}$/);
    if (phoneMatch) return `+98${ascii.replace(/^(?:\+98|0098|98|0)/, '')}`;
    return ascii;
  }

  private isVerified(row: UserRow, channel: OtpAuthChannel): boolean {
    return channel === 'email' ? row.emailVerifiedAt !== null : row.phoneVerifiedAt !== null;
  }

  private fieldOf(row: UserRow, channel: OtpAuthChannel): string | null {
    return channel === 'email' ? row.email : row.phone;
  }

  /** otp channel → users-domain column family (sms ↔ phone). */
  private attachChannel(channel: OtpAuthChannel): 'email' | 'phone' {
    return channel === 'email' ? 'email' : 'phone';
  }

  /** Redis 3/h-per-identifier counter for forgot (fail-open like OTP caps). */
  private async assertForgotCap(identifier: string): Promise<void> {
    const key = `otp:forgot-cap:${createHash('sha256').update(identifier).digest('hex').slice(0, 24)}`;
    try {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, 3_600, 'NX');
      if (count > FORGOT_HOURLY_CAP_PER_IDENTIFIER) {
        const ttl = await this.redis.ttl(key);
        throw otpAuthError(
          'OTP_INVALID',
          'Too many reset requests for this identifier',
          HttpStatus.UNPROCESSABLE_ENTITY,
          { retryAfterSec: ttl > 0 ? ttl : 3_600 },
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(
        `forgot cap degraded (fail-open): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // POST /auth/otp/request — passwordless login code (purpose: login)
  // -------------------------------------------------------------------------

  async requestLoginOtp(params: {
    channel: OtpAuthChannel;
    target: string;
    ip: string | null;
    locale?: string;
  }): Promise<OtpRequestResult> {
    const target = this.normalizeTarget(params.channel, params.target);
    const issued = await this.otp.issue({
      purpose: OTP_PURPOSE_LOGIN,
      channel: params.channel,
      target,
      ip: params.ip,
    });
    await this.deliverCode({
      channel: params.channel,
      target,
      code: issued.code,
      ttlSec: issued.expiresInSec,
      template: 'otp',
      locale: params.locale,
    });
    return {
      resendAfterSec: issued.resendAfterSec,
      expiresInSec: issued.expiresInSec,
      channel: params.channel,
      targetMasked: maskTarget(target),
    };
  }

  // -------------------------------------------------------------------------
  // POST /auth/otp/verify — login or register by code
  // -------------------------------------------------------------------------

  async verifyLoginOtp(params: {
    channel: OtpAuthChannel;
    target: string;
    code: string;
    meta: SessionMeta;
    localeHint?: string;
  }): Promise<AuthFlowResult> {
    const target = this.normalizeTarget(params.channel, params.target);
    await this.otp.verify({
      purpose: OTP_PURPOSE_LOGIN,
      channel: params.channel,
      target,
      code: params.code,
    });

    let row = await this.users.getByIdentifier(target);
    let isNew = false;

    if (!row) {
      // Registration: throwaway username, no password, target verified.
      row = await this.createOtpUser(params.channel, target, params.localeHint);
      isNew = true;
    } else {
      if (row.status === 'blocked' || this.users.isCurrentlyBanned(row)) {
        throw otpAuthError('ACCOUNT_BANNED', 'Account is banned', HttpStatus.FORBIDDEN);
      }
      // Ownership proven — an unverified target becomes verified on login.
      if (!this.isVerified(row, params.channel)) {
        const outcome = await this.users.attachIdentifier({
          userId: row.id,
          channel: this.attachChannel(params.channel),
          target,
        });
        if (outcome === 'attached') {
          const refreshed = await this.users.getById(row.id);
          if (refreshed) row = refreshed;
        }
      }
    }

    await this.users.recordLogin(row.id);
    const issued = await this.sessions.create(row.id, params.meta);
    const accessToken = await this.tokens.signAccess({
      sub: row.id,
      sid: issued.sessionId,
      role: row.role,
    });
    this.events.emit(AUTH_SERVICE_EVENTS.loginSucceeded, {
      userId: row.id,
      sessionId: issued.sessionId,
      ip: params.meta.ip,
      method: params.channel === 'sms' ? 'otp_sms' : 'otp_email',
    });
    if (isNew) {
      this.events.emit(AUTH_SERVICE_EVENTS.registered, {
        userId: row.id,
        username: row.username,
        ip: params.meta.ip,
      });
    }
    return {
      auth: { user: this.toCurrentUser(row), accessExpiresAt: this.tokens.accessExpiresAt() },
      accessToken,
      refreshToken: issued.refreshToken,
      sessionId: issued.sessionId,
    };
  }

  private async createOtpUser(
    channel: OtpAuthChannel,
    target: string,
    localeHint: string | undefined,
  ): Promise<UserRow> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const username = `u${randomBase36(8)}`;
      try {
        return await this.users.create({
          username,
          email: channel === 'email' ? target : null,
          phone: channel === 'sms' ? target : null,
          passwordHash: null,
          locale: localeHint === 'fa' || localeHint === 'en' ? localeHint : null,
          emailVerified: channel === 'email',
          phoneVerified: channel === 'sms',
        });
      } catch (err) {
        lastError = err;
        if (err instanceof ConflictException) continue; // username collision → retry
        throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('could not create otp user');
  }

  // -------------------------------------------------------------------------
  // POST /auth/verify/request + /confirm — attach or verify an identifier
  // -------------------------------------------------------------------------

  async requestVerification(params: {
    userId: string;
    channel: OtpAuthChannel;
    target: string;
    ip: string | null;
    locale?: string;
  }): Promise<OtpRequestResult> {
    const target = this.normalizeTarget(params.channel, params.target);
    const purpose =
      params.channel === 'email' ? OTP_PURPOSE_VERIFY_EMAIL : OTP_PURPOSE_VERIFY_PHONE;

    const current = await this.users.getById(params.userId);
    if (this.fieldOf(current, params.channel) !== target) {
      // A NEW identifier: a verified holder other than the caller → 409.
      const holder = await this.users.getByIdentifier(target);
      if (holder && holder.id !== params.userId && this.isVerified(holder, params.channel)) {
        throw otpAuthError(
          'CONFLICT',
          'identifier already belongs to another account',
          HttpStatus.CONFLICT,
        );
      }
    }

    const issued = await this.otp.issue({
      purpose,
      channel: params.channel,
      target,
      ip: params.ip,
      userId: params.userId,
    });
    await this.deliverCode({
      channel: params.channel,
      target,
      code: issued.code,
      ttlSec: issued.expiresInSec,
      template: params.channel === 'email' ? 'verify-email' : 'otp',
      locale: params.locale,
      displayName: current.displayName ?? undefined,
    });
    return {
      resendAfterSec: issued.resendAfterSec,
      expiresInSec: issued.expiresInSec,
      channel: params.channel,
      targetMasked: maskTarget(target),
    };
  }

  async confirmVerification(params: {
    userId: string;
    channel: OtpAuthChannel;
    target: string;
    code: string;
  }): Promise<CurrentUser> {
    const target = this.normalizeTarget(params.channel, params.target);
    await this.otp.verify({
      purpose: params.channel === 'email' ? OTP_PURPOSE_VERIFY_EMAIL : OTP_PURPOSE_VERIFY_PHONE,
      channel: params.channel,
      target,
      code: params.code,
    });
    // Unique constraint re-checked inside the transaction (new identifier may
    // have been verified by its owner between request and confirm).
    const outcome = await this.users.attachIdentifier({
      userId: params.userId,
      channel: this.attachChannel(params.channel),
      target,
    });
    if (outcome === 'conflict') {
      throw otpAuthError(
        'CONFLICT',
        'identifier already belongs to another account',
        HttpStatus.CONFLICT,
      );
    }
    return this.toCurrentUser(await this.users.getById(params.userId));
  }

  // -------------------------------------------------------------------------
  // POST /auth/password/forgot + /reset
  // -------------------------------------------------------------------------

  /**
   * Where a reset code would be sent for a row: verified email preferred,
   * else verified phone; null when the user has neither (NO delivery).
   */
  private resetChannelFor(row: UserRow): { channel: OtpAuthChannel; target: string } | null {
    if (row.emailVerifiedAt !== null && row.email) return { channel: 'email', target: row.email };
    if (row.phoneVerifiedAt !== null && row.phone) return { channel: 'sms', target: row.phone };
    return null;
  }

  /** Always 200 `{ ok: true }` — never reveals whether the account exists. */
  async forgotPassword(params: {
    identifier: string;
    ip: string | null;
    locale?: string;
  }): Promise<{ ok: true }> {
    const identifier = this.normalizeIdentifier(params.identifier);
    await this.assertForgotCap(identifier);

    const row = await this.users.getByIdentifier(identifier);
    const route = row ? this.resetChannelFor(row) : null;
    if (row && route) {
      const issued = await this.otp.issue({
        purpose: OTP_PURPOSE_RESET_PASSWORD,
        channel: route.channel,
        target: route.target,
        ip: params.ip,
        userId: row.id,
      });
      await this.deliverCode({
        channel: route.channel,
        target: route.target,
        code: issued.code,
        ttlSec: issued.expiresInSec,
        template: route.channel === 'email' ? 'reset-password' : 'otp',
        locale: params.locale,
        displayName: row.displayName ?? undefined,
      });
    } else {
      // Same external behaviour, no delivery: still burn a (bounded) code
      // slot so the Redis counters advance identically for both branches.
      await this.otp
        .issue({
          purpose: OTP_PURPOSE_RESET_PASSWORD,
          channel: 'email',
          target: identifier,
          ip: params.ip,
        })
        .catch(() => undefined);
    }
    return { ok: true };
  }

  /** 204 on success; wrong code / wrong purpose / unknown → OTP_INVALID. */
  async resetPassword(params: {
    identifier: string;
    code: string;
    newPassword: string;
    meta: SessionMeta;
  }): Promise<void> {
    const identifier = this.normalizeIdentifier(params.identifier);
    const row = await this.users.getByIdentifier(identifier);
    // The code was delivered to the row's preferred verified channel — verify
    // against exactly that target (a code for another target/purpose fails).
    const route = row ? this.resetChannelFor(row) : null;
    await this.otp.verify({
      purpose: OTP_PURPOSE_RESET_PASSWORD,
      channel: route?.channel ?? 'email',
      target: route?.target ?? identifier,
      code: params.code,
    });
    if (!row) {
      // Verified a code that cannot belong to anyone — generic failure.
      throw otpAuthError('OTP_INVALID', 'Invalid or expired code', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const passwordHash = await this.passwords.hash(params.newPassword);
    await this.users.setPasswordHash(row.id, passwordHash);
    // A password reset is a security event: every session dies immediately.
    await this.sessions.revokeAllForUser(row.id);
    this.logger.log(`password reset completed for user ${row.id} (all sessions revoked)`);
  }

  // -------------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------------

  private async deliverCode(params: {
    channel: OtpAuthChannel;
    target: string;
    code: string;
    ttlSec: number;
    template: 'otp' | 'verify-email' | 'reset-password';
    locale?: string;
    displayName?: string;
  }): Promise<void> {
    const locale = params.locale === 'fa' || params.locale === 'en' ? params.locale : undefined;
    const ttlMin = String(Math.max(1, Math.round(params.ttlSec / 60)));
    if (params.channel === 'sms') {
      await this.sms.sendOtp(params.target, params.code, locale);
      return;
    }
    const vars: Record<string, string> = { code: params.code, ttlMin };
    if (params.template === 'verify-email' || params.template === 'reset-password') {
      const path = params.template === 'verify-email' ? 'verify' : 'reset-password';
      vars['url'] = `${this.config.publicWebUrl}/${path}?code=${encodeURIComponent(params.code)}`;
      vars['name'] = params.displayName ?? '';
    }
    await this.email.send({
      to: params.target,
      template: params.template,
      locale,
      vars,
    });
  }

  toCurrentUser(row: UserRow): CurrentUser {
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      phone: row.phone,
      role: row.role,
      status: row.status,
      displayName: row.displayName,
      locale: row.locale,
      emailVerified: row.emailVerifiedAt !== null,
      phoneVerified: row.phoneVerifiedAt !== null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

/** 8 random lowercase base36 chars (B1.7 throwaway usernames). */
function randomBase36(length: number): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[randomInt(0, alphabet.length)];
  }
  return out;
}
