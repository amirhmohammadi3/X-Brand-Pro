/**
 * Email driver contract (B1.6). SMTP is the only real driver today; the
 * interface keeps the door open for providers with HTTP APIs later. Callers
 * (queue processor, admin test endpoint) never see nodemailer types.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: { address: string; name?: string };
  replyTo?: string;
}

export interface EmailSendResult {
  providerMessageId?: string;
}

export interface EmailDriver {
  readonly name: string;
  send(mail: EmailMessage): Promise<EmailSendResult>;
}

/**
 * Provider/transport failure with a retry classification (B1.6): connection
 * failures, timeouts and SMTP 4xx responses are retryable — BullMQ may
 * re-attempt the job. SMTP 5xx recipient errors and auth failures are NOT
 * retryable — retrying cannot succeed.
 */
export class EmailProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly providerCode?: string,
  ) {
    super(message);
    this.name = 'EmailProviderError';
  }
}

/**
 * True when the cause is worth a BullMQ retry. The SMTP driver maps every
 * nodemailer failure into EmailProviderError with the right flag; anything
 * that arrives here unclassified is treated as NOT retryable (fail fast
 * instead of looping on an unknown configuration problem).
 */
export function isRetryableEmailCause(cause: unknown): boolean {
  return cause instanceof EmailProviderError && cause.retryable;
}

/** nodemailer error codes that mean "transport/temporary — try again". */
const RETRYABLE_NOREMAILER_CODES = new Set([
  'ECONNECTION',
  'ECONNREFUSED',
  'ECONNRESET',
  'ESOCKET',
  'ETIMEDOUT',
  'EDNS',
]);

/**
 * Maps a raw nodemailer failure to an EmailProviderError (identity when the
 * cause is already classified). Classification per nodemailer's error model:
 * `responseCode` is the SMTP status (4xx temporary / 5xx permanent),
 * `code` is the transport-level reason (EAUTH, ETIMEDOUT, …).
 */
export function toEmailProviderError(cause: unknown): EmailProviderError {
  if (cause instanceof EmailProviderError) return cause;
  if (cause instanceof Error) {
    const smtpError = cause as Error & { code?: string; responseCode?: number };
    const responseCode = smtpError.responseCode;
    if (typeof responseCode === 'number') {
      // 4xx = temporary (greylisting, throttling), 5xx = permanent rejection.
      return new EmailProviderError(
        cause.message,
        responseCode >= 400 && responseCode < 500,
        `SMTP_${responseCode}`,
      );
    }
    if (smtpError.code && RETRYABLE_NOREMAILER_CODES.has(smtpError.code)) {
      return new EmailProviderError(cause.message, true, smtpError.code);
    }
    // EAUTH, EENVELOPE, EMESSAGE and unknown codes: retrying cannot help.
    return new EmailProviderError(cause.message, false, smtpError.code ?? 'SMTP_ERROR');
  }
  return new EmailProviderError(String(cause), false, 'UNKNOWN');
}
