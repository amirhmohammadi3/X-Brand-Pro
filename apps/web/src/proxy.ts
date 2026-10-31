import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

/**
 * Locale negotiation and prefixing (Next.js 16 "proxy" convention — the file
 * formerly known as middleware.ts). Handles: `/` -> `/` (fa, no prefix),
 * `/en/...` for the prefixed locale, and locale cookie persistence.
 */
export default createMiddleware(routing);

export const config = {
  // Skip API routes, Next internals and all static files.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
