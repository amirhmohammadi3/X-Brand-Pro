import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
// Value import (not type-only): Nest reads constructor param types at runtime
// via emitDecoratorMetadata — type-only would break DI (B1.3 lesson).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import { normalizeDigits, type OauthAccount, type OauthAccountsResponse } from '@app/contracts';
import { randomInt } from 'node:crypto';
import type { Request, Response } from 'express';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.js';
import { UsersService } from '../users/users.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { UserRow } from '../../db/schema/users.js';
import { AUTH_SERVICE_EVENTS } from './auth.service.js';
import { AuthCookieService } from './auth-cookie.service.js';
import { GoogleOauthService, type GoogleProfile } from './google-oauth.service.js';
import {
  OAUTH_ACCOUNTS_REPOSITORY,
  type OauthAccountsRepositoryLike,
} from './oauth-accounts.repository.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';

export const OAUTH_STATE_COOKIE = 'oauth_state';
const OAUTH_STATE_COOKIE_PATH = '/api/v1/auth/google';
const OAUTH_STATE_TTL_MS = 5 * 60 * 1000;

/** Where the web app sends the user after a failed callback (B1.8). */
export function oauthFailureUrl(publicWebUrl: string): string {
  return `${publicWebUrl.replace(/\/+$/, '')}/login?error=oauth_failed`;
}

/**
 * Validates the `next` redirect target: a relative path starting with a
 * single `/`, not `//` (protocol-relative), no backslashes, no control
 * characters. Anything else falls back to `/`. Never throws.
 */
export function safeOauthNext(raw: string | undefined): string {
  if (!raw) return '/';
  const value = normalizeDigits(raw);
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  for (const ch of value) {
    if (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f) return '/';
  }
  return value;
}

/**
 * Username derived from a Google email local part: lowercased ASCII
 * [a-z0-9._-], truncated to 20 chars. Falls back to a throwaway
 * `user<rand>` when nothing usable remains (e.g. unicode-only local parts).
 */
export function deriveUsernameFromEmail(email: string): string {
  const local = normalizeDigits(email).split('@')[0]?.toLowerCase() ?? '';
  const cleaned = local
    .replace(/[^a-z0-9._-]+/g, '')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 20);
  if (cleaned.length < 3) return `user${randomInt(10_000, 100_000)}`;
  return cleaned;
}

/**
 * Google OAuth linking flows (B1.8): /start seals state+PKCE into a signed
 * cookie and 302s to Google; /callback verifies state, exchanges the code,
 * verifies the ID token, then logs in / links / registers. Every failure
 * redirects to `{PUBLIC_WEB_URL}/login?error=oauth_failed` WITHOUT details
 * (the reason is logged server-side only).
 */
@Injectable()
export class AuthOauthService {
  private readonly logger = new Logger(AuthOauthService.name);

  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(GoogleOauthService) private readonly google: GoogleOauthService,
    @Inject(OAUTH_ACCOUNTS_REPOSITORY) private readonly oauthRepo: OauthAccountsRepositoryLike,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuthCookieService) private readonly cookies: AuthCookieService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly events: EventEmitter2,
  ) {}

  private async googleConfig(): Promise<{
    enabled: boolean;
    clientId: string;
    clientSecret: string;
  }> {
    const [enabled, clientId, clientSecret] = await Promise.all([
      this.settings.get<boolean>('oauth.google.enabled').catch(() => false),
      this.settings.get<string>('oauth.google.clientId').catch(() => ''),
      this.settings.get<string>('oauth.google.clientSecret').catch(() => ''),
    ]);
    return {
      enabled: enabled === true,
      clientId: clientId ?? '',
      clientSecret: clientSecret ?? '',
    };
  }

  // -------------------------------------------------------------------------
  // GET /auth/google/start
  // -------------------------------------------------------------------------

  /**
   * 404 when the feature is disabled or unconfigured; otherwise seals
   * state+PKCE+next into the signed cookie and returns the 302 target.
   */
  async start(res: Response, next: string | undefined): Promise<string> {
    const cfg = await this.googleConfig();
    if (!cfg.enabled || !cfg.clientId || !cfg.clientSecret) {
      throw new NotFoundException('Google login is not available');
    }
    const state = this.google.createState();
    const { verifier, challenge } = this.google.createPkcePair();
    const sealed = await this.google.sealState({
      state,
      codeVerifier: verifier,
      next: safeOauthNext(next),
    });
    res.cookie(OAUTH_STATE_COOKIE, sealed, {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.config.cookieSecure,
      path: OAUTH_STATE_COOKIE_PATH,
      maxAge: OAUTH_STATE_TTL_MS,
    });
    return this.google.buildAuthorizationUrl({
      clientId: cfg.clientId,
      redirectUri: this.google.callbackUrl(),
      state,
      codeChallenge: challenge,
    });
  }

  // -------------------------------------------------------------------------
  // GET /auth/google/callback
  // -------------------------------------------------------------------------

  /**
   * Full callback flow. Returns the success redirect target; on ANY failure
   * returns the generic failure URL and clears the state cookie. The
   * controller performs the redirect (@RawResponse) — no error ever leaks.
   */
  async callback(params: {
    req: Request;
    res: Response;
    state: string | undefined;
    code: string | undefined;
  }): Promise<string> {
    const failure = oauthFailureUrl(this.config.publicWebUrl);
    try {
      const sealed = await this.google.unsealState(params.req.cookies?.[OAUTH_STATE_COOKIE]);
      params.res.clearCookie(OAUTH_STATE_COOKIE, {
        httpOnly: true,
        sameSite: 'lax' as const,
        secure: this.config.cookieSecure,
        path: OAUTH_STATE_COOKIE_PATH,
      });
      if (!sealed || !params.state || params.state !== sealed.state) {
        this.logger.warn('oauth callback rejected: state mismatch or missing cookie');
        return failure;
      }
      if (!params.code) {
        this.logger.warn('oauth callback rejected: missing code');
        return failure;
      }

      const cfg = await this.googleConfig();
      if (!cfg.enabled || !cfg.clientId || !cfg.clientSecret) {
        this.logger.warn('oauth callback rejected: feature disabled or not configured');
        return failure;
      }

      let profile: GoogleProfile;
      try {
        const exchanged = await this.google.exchangeCode({
          clientId: cfg.clientId,
          clientSecret: cfg.clientSecret,
          code: params.code,
          codeVerifier: sealed.codeVerifier,
          redirectUri: this.google.callbackUrl(),
        });
        profile = await this.google.verifyIdToken(exchanged.idToken, cfg.clientId);
      } catch (err) {
        this.logger.warn(
          `oauth token exchange/verify failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return failure;
      }

      const row = await this.resolveAndLink(profile);
      if (!row) return failure;

      await this.users.recordLogin(row.id);
      const issued = await this.sessions.create(row.id, {
        ip: params.req.ip ?? null,
        userAgent:
          typeof params.req.headers['user-agent'] === 'string'
            ? params.req.headers['user-agent']
            : null,
      });
      const accessToken = await this.tokens.signAccess({
        sub: row.id,
        sid: issued.sessionId,
        role: row.role,
      });
      this.cookies.set(params.res, { accessToken, refreshToken: issued.refreshToken });
      this.events.emit(AUTH_SERVICE_EVENTS.loginSucceeded, {
        userId: row.id,
        sessionId: issued.sessionId,
        ip: params.req.ip ?? null,
        method: 'google_oauth',
      });

      const next = safeOauthNext(sealed.next);
      return `${this.config.publicWebUrl.replace(/\/+$/, '')}${next}`;
    } catch (err) {
      this.logger.error(
        `oauth callback failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return failure;
    }
  }

  /** Find-or-create the user behind a verified Google profile; null = rejected. */
  private async resolveAndLink(profile: GoogleProfile): Promise<UserRow | null> {
    // 1. Existing link → log that user in (unless banned).
    const link = await this.oauthRepo.findByProviderUid('google', profile.sub);
    if (link) {
      const row = await this.users.getById(link.userId);
      if (!row || row.status === 'blocked' || this.users.isCurrentlyBanned(row)) {
        this.logger.warn(`oauth login rejected for banned user ${link.userId}`);
        return null;
      }
      return row;
    }

    // 2. Verified email matching an existing account → link it.
    if (profile.email && profile.emailVerified) {
      const byEmail = await this.users.getByEmail(profile.email);
      if (byEmail) {
        if (byEmail.status === 'blocked' || this.users.isCurrentlyBanned(byEmail)) {
          this.logger.warn(`oauth link rejected for banned user ${byEmail.id}`);
          return null;
        }
        await this.oauthRepo.insert({
          userId: byEmail.id,
          provider: 'google',
          providerUserId: profile.sub,
          email: profile.email,
        });
        return byEmail;
      }
    }

    // 3. New user. Email is stored ONLY when Google vouches for it
    // (email_verified true) — otherwise the account starts without email.
    const email = profile.email && profile.emailVerified ? profile.email : null;
    const row = await this.createOauthUser(profile, email);
    if (!row) return null;
    await this.oauthRepo.insert({
      userId: row.id,
      provider: 'google',
      providerUserId: profile.sub,
      email: profile.email,
    });
    this.events.emit(AUTH_SERVICE_EVENTS.registered, {
      userId: row.id,
      username: row.username,
      ip: null,
    });
    return row;
  }

  private async createOauthUser(
    profile: GoogleProfile,
    email: string | null,
  ): Promise<UserRow | null> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const base = profile.email ? deriveUsernameFromEmail(profile.email) : '';
      const username =
        attempt === 0 && base ? base : `${base || 'user'}-${randomInt(1000, 10_000)}`;
      try {
        return await this.users.create({
          username,
          email,
          phone: null,
          passwordHash: null,
          displayName: profile.name,
          emailVerified: email !== null,
          phoneVerified: false,
        });
      } catch (err) {
        lastError = err;
        if (err instanceof HttpException && err.getStatus() === HttpStatus.CONFLICT) continue;
        throw err;
      }
    }
    this.logger.error(
      `could not create oauth user: ${lastError instanceof Error ? lastError.message : ''}`,
    );
    return null;
  }

  // -------------------------------------------------------------------------
  // GET/DELETE /auth/oauth/accounts
  // -------------------------------------------------------------------------

  async listAccounts(userId: string): Promise<OauthAccountsResponse> {
    const rows = await this.oauthRepo.listForUser(userId);
    return { accounts: rows.map(toAccountView) };
  }

  /** 404 for foreign/unknown ids; 422 when it is the last login method. */
  async unlinkAccount(params: { userId: string; accountId: string }): Promise<void> {
    const row = await this.oauthRepo.findByIdForUser(params.accountId, params.userId);
    if (!row) {
      throw new NotFoundException('Linked account not found');
    }
    const user = await this.users.getById(params.userId);
    const hasAlternative =
      (user !== null &&
        (user.passwordHash !== null ||
          user.emailVerifiedAt !== null ||
          user.phoneVerifiedAt !== null)) ||
      (await this.oauthRepo.countForUser(params.userId)) > 1;
    if (!hasAlternative) {
      throw new HttpException(
        {
          code: 'LAST_LOGIN_METHOD' as const,
          message:
            'Set a password or verify an email/phone before unlinking your last login method',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    await this.oauthRepo.deleteByIdForUser(params.accountId, params.userId);
  }
}

function toAccountView(row: {
  id: string;
  provider: string;
  email: string | null;
  createdAt: Date;
}): OauthAccount {
  return {
    id: row.id,
    provider: 'google',
    email: row.email,
    createdAt: row.createdAt.toISOString(),
  };
}
