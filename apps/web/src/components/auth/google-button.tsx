'use client';

import { useTranslations } from 'next-intl';
import { env } from '../../lib/env';
import { cn } from '../../lib/cn';
import { Button } from '../ui';

export interface GoogleButtonProps {
  /** Validated `next` target carried through the OAuth round-trip. */
  next: string;
  className?: string;
}

/** Self-contained Google "G" mark (no external asset request). */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.32A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.96H.96a9 9 0 0 0 0 8.08l3.01-2.32Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.96l3.01 2.32C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/**
 * `GoogleButton` (F1.8). Rendered on the login screen ONLY when the admin
 * enabled `oauth.google.enabled` (see `useOAuthProviders`). It is a plain
 * `<a>` to the API's `GET /auth/google/start` route — a full navigation, not
 * an SPA route, because the API answers with a 302 to Google and finally
 * redirects back into the web app with fresh session cookies.
 *
 * The note under the button sets the expectation that Google may be
 * unreachable from Iran; the failure then shows up as a browser error page
 * on the API origin, which is exactly why the fallback methods exist.
 */
export function GoogleButton({ next, className }: GoogleButtonProps) {
  const t = useTranslations('auth.login');
  const apiBase = env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '');
  const href = `${apiBase}/auth/google/start?next=${encodeURIComponent(next)}`;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Button variant="secondary" block asChild>
        <a href={href}>
          <GoogleMark />
          {t('googleButton')}
        </a>
      </Button>
      <p className="text-xs text-text-subtle">{t('googleNote')}</p>
    </div>
  );
}
