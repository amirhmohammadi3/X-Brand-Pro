import type { ErrorCode } from '@app/contracts';

/**
 * The one error type every API failure becomes. Carries the envelope's i18n
 * messageKey (components translate from it), the machine code, HTTP status
 * and the requestId for support/debug output. Network and envelope-shape
 * failures get synthetic codes so UI code can branch uniformly.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'NETWORK_ERROR' | 'INVALID_ENVELOPE';
  readonly messageKey: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(params: {
    status: number;
    code: ErrorCode | 'NETWORK_ERROR' | 'INVALID_ENVELOPE';
    message: string;
    messageKey?: string;
    details?: unknown;
    requestId?: string;
  }) {
    super(params.message);
    this.name = 'ApiRequestError';
    this.status = params.status;
    this.code = params.code;
    this.messageKey = params.messageKey ?? `errors.${params.code.toLowerCase()}`;
    this.details = params.details;
    this.requestId = params.requestId;
  }

  /** 4xx are client errors — TanStack Query must not retry them. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  get isRateLimited(): boolean {
    return this.code === 'RATE_LIMITED';
  }
}

/** Type guard for retry policies and error boundaries. */
export function isApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError;
}
