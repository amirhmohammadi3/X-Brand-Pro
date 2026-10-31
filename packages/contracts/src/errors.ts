/**
 * Canonical error codes and their HTTP status mapping.
 * Adding a new code requires updating ERROR_CODES, ERROR_HTTP_STATUS, and
 * docs/SECURITY.md (the error-code table).
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_BANNED',
  'TOKEN_REUSED',
  'SESSION_REVOKED',
  'ACCOUNT_LOCKED',
  'OTP_INVALID',
  'OTP_EXPIRED',
  'OTP_TOO_MANY_ATTEMPTS',
  'OTP_RESEND_TOO_SOON',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UNPROCESSABLE',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Maps each error code to its HTTP status. */
export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_BANNED: 403,
  TOKEN_REUSED: 401,
  SESSION_REVOKED: 401,
  ACCOUNT_LOCKED: 429,
  OTP_INVALID: 422,
  OTP_EXPIRED: 422,
  OTP_TOO_MANY_ATTEMPTS: 429,
  OTP_RESEND_TOO_SOON: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNPROCESSABLE: 422,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/**
 * i18n message key for an error code, e.g. VALIDATION_FAILED -> errors.validation_failed.
 */
export function errorMessageKey(code: ErrorCode): string {
  return `errors.${code.toLowerCase()}`;
}

/** Zod-compatible check for whether a string is a known error code. */
export function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}
