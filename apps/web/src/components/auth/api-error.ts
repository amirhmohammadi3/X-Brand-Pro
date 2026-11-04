import { useTranslations, type useTranslations as UseTranslations } from 'next-intl';
import { isApiRequestError } from '../../lib/api/errors';
import { z } from 'zod';
import { translateIssue } from '../../lib/forms/translate-issue';

type Translations = ReturnType<typeof UseTranslations>;

/**
 * `retryAfterSec` from an API error's `details` (B1.3 throttle payloads:
 * `{ retryAfterSec: number }` on ACCOUNT_LOCKED / RATE_LIMITED /
 * OTP_RESEND_TOO_SOON). Returns null when the payload is missing/malformed.
 */
export function retryAfterSec(error: unknown): number | null {
  if (!isApiRequestError(error)) return null;
  const schema = z.object({ retryAfterSec: z.number().int().min(0) });
  const parsed = schema.safeParse(error.details);
  return parsed.success ? parsed.data.retryAfterSec : null;
}

/**
 * Translate an `ApiRequestError` into user-facing text via its envelope
 * `messageKey` (`errors.*` seeds). Network failures read as "service
 * unavailable" rather than a cryptic message; unknown keys fall back to the
 * raw key (visible, never silent — translate-issue convention).
 */
export function apiErrorText(t: Translations, error: unknown): string {
  if (isApiRequestError(error) && error.code === 'NETWORK_ERROR') {
    return t('errors.service_unavailable');
  }
  if (isApiRequestError(error)) {
    return translateIssue(t, { message: error.messageKey });
  }
  return t('errors.internal_error');
}

/** Convenience hook form for components that only need the two helpers. */
export function useApiErrorText(): (error: unknown) => string {
  const t = useTranslations();
  return (error: unknown) => apiErrorText(t, error);
}
