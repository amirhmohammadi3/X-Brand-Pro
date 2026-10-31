import { maskTarget } from '@app/contracts';

/**
 * SMS driver contract (B1.5). Every provider — fake, Melipayamak, Kavenegar —
 * implements this interface; callers never see provider specifics. The
 * `template` variant is used for OTP sends where the provider applies its own
 * configured body/template instead of free text.
 */
export interface SmsMessage {
  to: string;
  /** Plain text — XOR with `template`. */
  text?: string;
  /** Provider template (OTP) — XOR with `text`. */
  template?: { name: string; tokens: Record<string, string> };
}

export interface SmsSendResult {
  providerMessageId?: string;
}

export interface SmsDriver {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsSendResult>;
}

/**
 * Provider failure with a retry classification. Retryable: network errors,
 * timeouts and HTTP 5xx / explicit "try later" provider codes — BullMQ may
 * re-attempt the job. Non-retryable: bad credentials, invalid number,
 * missing configuration, insufficient credit — retrying cannot succeed.
 */
export class SmsProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly providerCode?: string,
  ) {
    super(message);
    this.name = 'SmsProviderError';
  }
}

/** Converts an E.164 Iranian mobile (`+98912…`) to the providers' `0912…` form. */
export function toProviderFormat(e164: string): string {
  if (!/^\+989\d{9}$/.test(e164)) {
    throw new SmsProviderError(
      `not a normalised Iranian mobile (expected +989xxxxxxxxx): ${maskTarget(e164)}`,
      false,
      'INVALID_NUMBER',
    );
  }
  return `0${e164.slice(3)}`;
}

/**
 * True when the error is worth a BullMQ retry: an SmsProviderError flagged
 * retryable, or a low-level failure (AbortSignal.timeout abort, socket
 * error). Anything else must not be retried.
 */
export function isRetryableCause(cause: unknown): boolean {
  if (cause instanceof SmsProviderError) return cause.retryable;
  if (cause instanceof Error) {
    // AbortSignal.timeout aborts with a TimeoutError DOMException; fetch
    // network failures surface as TypeError ("fetch failed").
    return (
      cause.name === 'TimeoutError' || cause.name === 'AbortError' || cause.name === 'TypeError'
    );
  }
  return false;
}

/** Shared 8-second fetch timeout per the prompt (AbortSignal.timeout). */
export const SMS_FETCH_TIMEOUT_MS = 8_000;
