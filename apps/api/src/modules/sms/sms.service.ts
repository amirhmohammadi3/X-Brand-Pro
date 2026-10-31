import { Inject, Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import type { SmsTestResult } from '@app/contracts';
// QueuesService is constructor-injected via the QUEUES_SERVICE token: Nest
// reads parameter types at runtime through emitDecoratorMetadata — value
// imports stay (do not "fix").
import { QUEUES_SERVICE } from '../../queue/queue.module.js';
import type { QueuesService } from '../../queue/queues.service.js';
// SmsCredentialsService is constructor-injected: Nest reads its type at
// runtime from emitDecoratorMetadata, so it must stay a value import even
// though it is not used as a value in this file (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SmsCredentialsService } from './sms-credentials.service.js';
import { isRetryableCause, SmsProviderError } from './sms.driver.js';
import type { SmsDriver, SmsMessage } from './sms.driver.js';

/** Queue all SMS deliveries go through (consumed by the worker process). */
export const SMS_QUEUE = 'sms';

export const SMS_DRIVER_FAKE = Symbol('SMS_DRIVER_FAKE');
export const SMS_DRIVER_MELIPAYAMAK = Symbol('SMS_DRIVER_MELIPAYAMAK');
export const SMS_DRIVER_KAVENEGAR = Symbol('SMS_DRIVER_KAVENEGAR');

/** OTP jobs must not leave the code behind in Redis once delivered. */
export const OTP_JOB_OPTS = {
  removeOnComplete: true,
  removeOnFail: { age: 3_600 },
} as const;

const OTP_TEXT: Readonly<Record<'fa' | 'en', string>> = {
  fa: 'کد ورود شما: {code}',
  en: 'Your verification code: {code}',
};

/** Builds the plain-text OTP message for a locale (i18n module lands later). */
export function buildOtpMessage(locale: 'fa' | 'en', code: string): string {
  return OTP_TEXT[locale].replace('{code}', code);
}

/**
 * SMS delivery (B1.5). `send`/`sendOtp` only ENQUEUE on the `sms` queue —
 * the actual provider call happens in the worker via `deliver`, which
 * resolves the driver from `sms.provider` at processing time and fails
 * without retry for non-retryable provider errors (UnrecoverableError).
 */
@Injectable()
export class SmsService {
  constructor(
    @Inject(SMS_DRIVER_FAKE) private readonly fake: SmsDriver,
    @Inject(SMS_DRIVER_MELIPAYAMAK) private readonly melipayamak: SmsDriver,
    @Inject(SMS_DRIVER_KAVENEGAR) private readonly kavenegar: SmsDriver,
    private readonly credentials: SmsCredentialsService,
    @Inject(QUEUES_SERVICE) private readonly queues: QueuesService,
  ) {}

  /** Queues a plain-text SMS and returns immediately. */
  async send(to: string, text: string): Promise<{ jobId: string }> {
    const jobId = await this.queues.enqueue(SMS_QUEUE, 'send', { to, text } satisfies SmsMessage);
    return { jobId };
  }

  /**
   * Queues an OTP delivery. Uses the provider's template when configured
   * (melipayamak body id / kavenegar lookup template, decided at enqueue
   * time), otherwise the built-in locale text. The code lives only in the
   * job data, which is removed on completion.
   */
  async sendOtp(to: string, code: string, locale?: 'fa' | 'en'): Promise<{ jobId: string }> {
    const payload = await this.buildOtpPayload(to, code, locale);
    const jobId = await this.queues.enqueue(SMS_QUEUE, 'send', payload, OTP_JOB_OPTS);
    return { jobId };
  }

  /** Worker-side processor: sends through the CURRENT provider, classifies failures. */
  async deliver(payload: SmsMessage): Promise<void> {
    const driver = await this.resolveDriver();
    try {
      await driver.send(payload);
    } catch (cause) {
      if (!isRetryableCause(cause)) {
        // BullMQ marks the job failed and skips the remaining attempts.
        throw new UnrecoverableError(
          `sms delivery failed permanently via ${driver.name}: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
      }
      throw cause;
    }
  }

  /**
   * Synchronous send through the currently configured provider — used by the
   * admin test endpoint. Never throws: provider failures come back as
   * `{ ok: false, errorCode }` so a missing credential surfaces as a clear
   * result, not a 500.
   */
  async sendNow(to: string, text: string): Promise<SmsTestResult> {
    const driver = await this.resolveDriver();
    try {
      const result = await driver.send({ to, text });
      return { driver: driver.name, ok: true, providerMessageId: result.providerMessageId };
    } catch (cause) {
      const errorCode =
        cause instanceof SmsProviderError
          ? (cause.providerCode ?? cause.name)
          : cause instanceof Error
            ? cause.name
            : 'UNKNOWN';
      return { driver: driver.name, ok: false, errorCode };
    }
  }

  private async resolveDriver(): Promise<SmsDriver> {
    const provider = await this.credentials.provider();
    switch (provider) {
      case 'fake':
        return this.fake;
      case 'melipayamak':
        return this.melipayamak;
      case 'kavenegar':
        return this.kavenegar;
      default:
        throw new SmsProviderError(
          `unknown sms.provider "${String(provider)}"`,
          false,
          'UNKNOWN_PROVIDER',
        );
    }
  }

  private async buildOtpPayload(
    to: string,
    code: string,
    locale?: 'fa' | 'en',
  ): Promise<SmsMessage> {
    const provider = await this.credentials.provider();
    if (provider === 'melipayamak') {
      const creds = await this.credentials.melipayamak();
      if (creds.otpBodyId) {
        return { to, template: { name: creds.otpBodyId, tokens: { token: code } } };
      }
    }
    if (provider === 'kavenegar') {
      const creds = await this.credentials.kavenegar();
      if (creds.otpTemplate) {
        return { to, template: { name: creds.otpTemplate, tokens: { token: code } } };
      }
    }
    const resolved = locale ?? (await this.credentials.siteLocale());
    return { to, text: buildOtpMessage(resolved, code) };
  }
}
