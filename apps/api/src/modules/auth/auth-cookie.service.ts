import { Inject, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.js';

export const ACCESS_COOKIE = 'at';
export const REFRESH_COOKIE = 'rt';

interface CookieOptionsLike {
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  domain?: string;
  path: string;
  maxAge: number;
}

/**
 * Auth cookie handling (B1.3).
 *
 * `at` (access JWT) and `rt` (opaque refresh token) are httpOnly,
 * SameSite=Lax, Secure per config, Domain per config. `rt` uses Path `/`
 * because the Next.js middleware (F1.8) must be able to refresh the session
 * on any page request. maxAge mirrors the token TTLs (ms).
 */
@Injectable()
export class AuthCookieService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private options(maxAgeMs: number): CookieOptionsLike {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.cookieSecure,
      ...(this.config.cookieDomain ? { domain: this.config.cookieDomain } : {}),
      path: '/',
      maxAge: maxAgeMs,
    };
  }

  set(res: Response, tokens: { accessToken: string; refreshToken: string }): void {
    res.cookie(ACCESS_COOKIE, tokens.accessToken, this.options(this.config.accessTtlSec * 1000));
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, this.options(this.config.refreshTtlSec * 1000));
  }

  clear(res: Response): void {
    const base = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.config.cookieSecure,
      ...(this.config.cookieDomain ? { domain: this.config.cookieDomain } : {}),
      path: '/',
    };
    res.clearCookie(ACCESS_COOKIE, base);
    res.clearCookie(REFRESH_COOKIE, base);
  }
}
