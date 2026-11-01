import { Inject, Injectable } from '@nestjs/common';
import { emailSchema } from '@app/contracts';
import { UnrecoverableError } from 'bullmq';
import type { EmailTestResult } from '@app/contracts';
// QueuesService is constructor-injected via the QUEUES_SERVICE token: Nest
// reads parameter types at runtime through emitDecoratorMetadata — value
// imports stay (do not "fix").
import { QUEUES_SERVICE } from '../../queue/queue.module.js';
import type { QueuesService } from '../../queue/queues.service.js';
// EmailCredentialsService is constructor-injected (emitDecoratorMetadata).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EmailCredentialsService } from './email-credentials.service.js';
import { isRetryableEmailCause, EmailProviderError } from './email.driver.js';
import type { EmailDriver } from './email.driver.js';
import { renderEmail, type EmailTemplateId } from './templates/index.js';

/** Queue all email deliveries go through (consumed by the worker process). */
export const MAIL_QUEUE = 'mail';

export const SMTP_DRIVER = Symbol('SMTP_DRIVER');

export interface MailJobData {
  to: string;
  template: EmailTemplateId;
  locale: string;
  vars: Record<string, string>;
}

/** Queue options per template: OTP codes must not survive in Redis. */
export function mailJobOpts(template: EmailTemplateId): {
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  removeOnComplete: boolean | { age: number; count: number };
  removeOnFail: { age: number };
} {
  return {
    attempts: 5,
    backoff: { type: 'exponential', delay: 15_000 },
    ...(template === 'otp'
      ? { removeOnComplete: true, removeOnFail: { age: 3_600 } }
      : {
          removeOnComplete: { age: 24 * 3_600, count: 1_000 },
          removeOnFail: { age: 7 * 24 * 3_600 },
        }),
  };
}

/**
 * Email delivery (B1.6). `send` only ENQUEUES on the `mail` queue — the
 * processor renders the template, sends through the CURRENT SMTP config and
 * retries only retryable failures (transport/4xx). Recipients are validated
 * with the shared emailSchema; exactly one recipient per call.
 */
@Injectable()
export class EmailService {
  constructor(
    @Inject(SMTP_DRIVER) private readonly driver: EmailDriver,
    private readonly credentials: EmailCredentialsService,
    @Inject(QUEUES_SERVICE) private readonly queues: QueuesService,
  ) {}

  /** Queues a templated email and returns immediately. */
  async send(input: {
    to: string;
    template: EmailTemplateId;
    locale?: string;
    vars?: Record<string, string>;
  }): Promise<{ jobId: string }> {
    // Validates shape AND rejects multiple recipients (emailSchema is
    // single-address; a comma list fails the schema).
    const to = emailSchema.parse(input.to);
    const opts = mailJobOpts(input.template);
    const jobId = await this.queues.enqueue(
      MAIL_QUEUE,
      'send',
      {
        to,
        template: input.template,
        locale: input.locale ?? '',
        vars: input.vars ?? {},
      } satisfies MailJobData,
      opts,
    );
    return { jobId };
  }

  /** Worker-side processor: render + send, classifying failures for BullMQ. */
  async deliver(payload: MailJobData): Promise<void> {
    const locale =
      payload.locale === 'fa' || payload.locale === 'en'
        ? payload.locale
        : await this.credentials.siteLocale();
    const rendered = renderEmail(payload.template, locale, payload.vars, locale);
    try {
      await this.driver.send({
        to: payload.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
    } catch (cause) {
      if (!isRetryableEmailCause(cause)) {
        throw new UnrecoverableError(
          `email delivery failed permanently via ${this.driver.name}: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
      }
      throw cause;
    }
  }

  /**
   * Synchronous send of the `generic` template through the CURRENT driver —
   * used by the admin test endpoint. Never throws: failures come back as
   * `{ ok: false, errorCode }` so a bad SMTP config surfaces as a clear
   * result, not a 500.
   */
  async sendNow(to: string, vars: { title: string; body: string }): Promise<EmailTestResult> {
    const address = emailSchema.parse(to);
    const locale = await this.credentials.siteLocale();
    const rendered = renderEmail('generic', locale, vars, locale);
    try {
      const result = await this.driver.send({
        to: address,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      return { ok: true, providerMessageId: result.providerMessageId };
    } catch (cause) {
      const errorCode =
        cause instanceof EmailProviderError
          ? (cause.providerCode ?? cause.name)
          : cause instanceof Error
            ? cause.name
            : 'UNKNOWN';
      return { ok: false, errorCode };
    }
  }
}
