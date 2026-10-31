import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF origin check for cookie-authenticated unsafe requests (B1.3).
 *
 * Rule: POST/PUT/PATCH/DELETE requests that arrive with ANY cookie must
 * carry an `Origin` header (or a `Referer` whose origin is used as fallback)
 * equal to PUBLIC_WEB_URL's origin, otherwise 403 (messageKey errors.csrf).
 *
 * Consequences (all intended):
 * - Bearer-only clients (no cookies at all) pass — no CSRF surface.
 * - Public auth routes (login/register/refresh) accept either a MATCHING
 *   Origin or NO cookies at all; stale cookies without Origin are rejected.
 * - Same-origin browser calls always carry Origin on unsafe methods.
 *
 * This complements SameSite=Lax cookies: Lax already blocks cross-site POSTs
 * in modern browsers, the Origin check covers legacy/degenerate clients.
 */
@Injectable()
export class CsrfOriginGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      method?: string;
      headers: Record<string, string | string[] | undefined>;
      cookies?: Record<string, string>;
    }>();
    if (!req.method || !UNSAFE_METHODS.has(req.method)) return true;

    const hasCookies =
      (req.cookies && Object.keys(req.cookies).length > 0) ||
      (typeof req.headers.cookie === 'string' && req.headers.cookie.length > 0);
    if (!hasCookies) return true;

    const allowed = new URL(this.config.publicWebUrl).origin;
    const origin = this.requestOrigin(req.headers);
    if (!origin || origin !== allowed) {
      throw new HttpException(
        {
          code: 'FORBIDDEN' as const,
          message: 'CSRF check failed: missing or mismatching Origin',
          messageKey: 'errors.csrf',
        },
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }

  private requestOrigin(headers: Record<string, string | string[] | undefined>): string | null {
    const origin = headers.origin;
    if (typeof origin === 'string' && origin.length > 0) return origin;
    const referer = headers.referer;
    if (typeof referer === 'string' && referer.length > 0) {
      try {
        return new URL(referer).origin;
      } catch {
        return null;
      }
    }
    return null;
  }
}
