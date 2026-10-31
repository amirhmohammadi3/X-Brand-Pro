import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { maskTarget, normalizeDigits } from '@app/contracts';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.js';
import { REDIS, type RedisLike } from '../../redis/redis.client.js';
import { SettingsService } from '../settings/settings.service.js';
import { OTP_REPOSITORY, type OtpRepositoryLike } from './otp.repository.js';

/** Issue-side guardrails (docs/SECURITY.md): resend cooldown + hourly caps. */
export const OTP_RESEND_COOLDOWN_SEC = 60;
export const OTP_HOURLY_CAP_PER_TARGET = 5;
export const OTP_HOURLY_CAP_PER_IP = 20;
/** Maintenance cleanup horizon: rows expired more than 1 day ago are deleted. */
export const OTP_CLEANUP_AFTER_MS = 24 * 3_600_000;

export interface OtpIssueParams {
  purpose: string;
  channel: 'sms' | 'email';
  /** Normalized E.164 phone or lowercase email (callers normalize). */
  target: string;
  ip?: string | null;
  userId?: string | null;
}

export interface OtpIssued {
  otpId: string;
  /** PLAIN code — returned ONLY to the calling service that sends it. */
  code: string;
  resendAfterSec: number;
  expiresInSec: number;
}

function otpError(
  code: 'OTP_INVALID' | 'OTP_EXPIRED' | 'OTP_TOO_MANY_ATTEMPTS' | 'OTP_RESEND_TOO_SOON',
  message: string,
  details?: Record<string, unknown>,
): HttpException {
  return new HttpException({ code, message, details }, HttpStatus.UNPROCESSABLE_ENTITY);
}

/**
 * Generic one-time-code engine (B1.4). Codes are numeric, generated with
 * crypto.randomInt (leading zeros preserved via padding), stored ONLY as
 * HMAC-SHA256(`<id>:<code>`) keyed by OTP_HMAC_SECRET, verified with
 * timingSafeEqual. The plain code exists only in the return value of
 * `issue()` — never in the database, logs, or controller responses.
 *
 * Settings: `otp.length`, `otp.ttlSec`, `otp.maxAttempts` (registry B1.1).
 * Caps (Redis, fail-open like the rest of the platform): 1 issue / 60 s per
 * target+purpose, 5 / hour per target, 20 / hour per ip.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @Inject(OTP_REPOSITORY) private readonly repo: OtpRepositoryLike,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: RedisLike,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** HMAC-SHA256 hex of `<id>:<code>` — the ONLY stored representation. */
  private codeHash(otpId: string, code: string): string {
    return createHmac('sha256', this.config.otpHmacSecret).update(`${otpId}:${code}`).digest('hex');
  }

  private async setting<T>(key: string, fallback: T): Promise<T> {
    try {
      return await this.settings.get<T>(key);
    } catch (err) {
      this.logger.warn(
        `setting ${key} unavailable, using default: ${err instanceof Error ? err.message : String(err)}`,
      );
      return fallback;
    }
  }

  private hashKey(kind: string, value: string): string {
    return `otp:${kind}:${createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 24)}`;
  }

  private async consumeCounter(
    key: string,
    limit: number,
    windowSec: number,
  ): Promise<{ allowed: boolean; retryAfterSec: number }> {
    try {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, windowSec, 'NX');
      if (count <= limit) return { allowed: true, retryAfterSec: 0 };
      const ttl = await this.redis.ttl(key);
      return { allowed: false, retryAfterSec: ttl > 0 ? ttl : windowSec };
    } catch (err) {
      this.logger.warn(
        `otp counter degraded (fail-open): ${err instanceof Error ? err.message : String(err)}`,
      );
      return { allowed: true, retryAfterSec: 0 };
    }
  }

  async issue(params: OtpIssueParams): Promise<OtpIssued> {
    const length = await this.setting<number>('otp.length', 6);
    const ttlSec = await this.setting<number>('otp.ttlSec', 120);
    const maxAttempts = await this.setting<number>('otp.maxAttempts', 5);

    // 1 per 60 s per target+purpose — INCR + EXPIRE NX (first request in the
    // window wins; rejected re-sends never extend the cooldown).
    const cooldownKey = this.hashKey('resend', `${params.target}|${params.purpose}`);
    try {
      const count = await this.redis.incr(cooldownKey);
      if (count === 1) await this.redis.expire(cooldownKey, OTP_RESEND_COOLDOWN_SEC, 'NX');
      if (count > 1) {
        const ttl = await this.redis.ttl(cooldownKey);
        throw otpError('OTP_RESEND_TOO_SOON', 'Please wait before requesting another code', {
          retryAfterSec: ttl > 0 ? ttl : OTP_RESEND_COOLDOWN_SEC,
        });
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(
        `otp cooldown degraded (fail-open): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const targetCap = await this.consumeCounter(
      this.hashKey('hour-target', `${params.target}`),
      OTP_HOURLY_CAP_PER_TARGET,
      3_600,
    );
    if (!targetCap.allowed) {
      throw otpError('OTP_RESEND_TOO_SOON', 'Too many codes requested', {
        retryAfterSec: targetCap.retryAfterSec,
      });
    }
    if (params.ip) {
      const ipCap = await this.consumeCounter(
        this.hashKey('hour-ip', params.ip),
        OTP_HOURLY_CAP_PER_IP,
        3_600,
      );
      if (!ipCap.allowed) {
        throw otpError('OTP_RESEND_TOO_SOON', 'Too many codes requested from this network', {
          retryAfterSec: ipCap.retryAfterSec,
        });
      }
    }

    // A fresh issue invalidates previous unconsumed codes (old codes die).
    await this.repo.invalidateUnconsumed(params.target, params.purpose);

    const otpId = randomUUID();
    const code = String(randomInt(0, 10 ** length)).padStart(length, '0');
    const expiresAt = new Date(Date.now() + ttlSec * 1000);
    await this.repo.insert({
      id: otpId,
      purpose: params.purpose as never,
      channel: params.channel,
      target: params.target,
      codeHash: this.codeHash(otpId, code),
      expiresAt,
      maxAttempts,
      ip: params.ip ?? null,
      userId: params.userId ?? null,
    });
    this.logger.log(
      `otp issued id=${otpId} purpose=${params.purpose} channel=${params.channel} target=${maskTarget(params.target)}`,
    );
    return { otpId, code, resendAfterSec: OTP_RESEND_COOLDOWN_SEC, expiresInSec: ttlSec };
  }

  /**
   * Verify a submitted code. The attempt counter is incremented ATOMICALLY
   * (SQL `attempts + 1`) before comparison; comparison uses timingSafeEqual
   * on the HMAC buffers. Persian/Arabic digits are normalized first.
   */
  async verify(params: {
    purpose: string;
    channel: 'sms' | 'email';
    target: string;
    code: string;
  }): Promise<{ otpId: string }> {
    const code = normalizeDigits(params.code).trim();

    const row = await this.repo.findLatestUnconsumed(params.target, params.purpose);
    if (!row) throw otpError('OTP_INVALID', 'Code not found or already used');
    if (row.expiresAt.getTime() <= Date.now()) {
      throw otpError('OTP_EXPIRED', 'Code has expired');
    }
    if (row.attempts >= row.maxAttempts) {
      throw otpError('OTP_TOO_MANY_ATTEMPTS', 'Too many failed attempts for this code');
    }

    const attempts = await this.repo.incrementAttempts(row.id);
    if (!this.compareCode(this.codeHash(row.id, code), row.codeHash)) {
      if ((attempts ?? row.attempts + 1) >= row.maxAttempts) {
        throw otpError('OTP_TOO_MANY_ATTEMPTS', 'Too many failed attempts for this code');
      }
      throw otpError('OTP_INVALID', 'Invalid code');
    }

    await this.repo.markConsumed(row.id);
    this.logger.log(
      `otp verified id=${row.id} purpose=${params.purpose} target=${maskTarget(params.target)}`,
    );
    return { otpId: row.id };
  }

  /** Maintenance: delete rows expired more than 1 day ago (queue `otp:cleanup`). */
  async cleanupExpired(): Promise<number> {
    return this.repo.deleteExpired(OTP_CLEANUP_AFTER_MS);
  }

  /**
   * Timing-safe HMAC comparison — a separate (spy-able) method so tests can
   * assert the comparison helper is used instead of `===`. Equal length is a
   * precondition of timingSafeEqual; unequal hashes can never match.
   */
  protected compareCode(expectedHex: string, actualHex: string): boolean {
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = Buffer.from(actualHex, 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
