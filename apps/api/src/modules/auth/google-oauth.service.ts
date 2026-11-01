import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose'; // value import: DI + runtime crypto
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.js';

/** jose's remote-JWKS handle (createRemoteJWKSet result). */
export type GoogleJwks = ReturnType<typeof createRemoteJWKSet>;

/**
 * Injectable JWKS handle so tests can bind a locally generated keypair
 * (Google endpoints are unreachable from this environment and from Iranian
 * servers in general — DECISIONS B1.8). Production binding is the default
 * provider below; it caches Google's keys for one hour (jose remote JWKS).
 */
export const GOOGLE_OIDC_JWKS = Symbol('GOOGLE_OIDC_JWKS');
export const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_ISSUER = 'https://accounts.google.com';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/** ID token claims this feature relies on (OpenID Connect `sub` is stable). */
export interface GoogleProfile {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

/** Verified OAuth state, carried in the signed 5-minute cookie (B1.8). */
export interface OauthStatePayload {
  state: string;
  codeVerifier: string;
  next: string;
}

export function createGoogleJwks(): GoogleJwks {
  return createRemoteJWKSet(new URL(GOOGLE_JWKS_URL), {
    // prompt B1.8: cache Google's keys for one hour (jose v6 option name).
    cacheMaxAge: 60 * 60 * 1000,
  });
}

function base64urlSha256(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

/**
 * Google OAuth 2.0 driver (B1.8): authorization URL with PKCE (S256), code
 * exchange with an 8s timeout, and ID token verification (issuer, audience,
 * expiry, signature via the injectable JWKS). Pure driver — no users/db
 * access; linking lives in AuthOauthService.
 */
@Injectable()
export class GoogleOauthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(GOOGLE_OIDC_JWKS) private readonly jwks: GoogleJwks,
  ) {}

  /** Signed, 5-minute state cookie contents (state + PKCE verifier + next). */
  async sealState(payload: OauthStatePayload): Promise<string> {
    return new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('xbrand:oauth')
      .setAudience('oauth-state')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(this.config.jwtRefreshSecret));
  }

  /** Verify + unseal the state cookie; returns null when invalid or expired. */
  async unsealState(cookieValue: string | undefined): Promise<OauthStatePayload | null> {
    if (!cookieValue) return null;
    try {
      const { payload } = await jwtVerify(
        cookieValue,
        new TextEncoder().encode(this.config.jwtRefreshSecret),
        {
          issuer: 'xbrand:oauth',
          audience: 'oauth-state',
        },
      );
      const { state, codeVerifier, next } = payload as Record<string, unknown>;
      if (
        typeof state !== 'string' ||
        typeof codeVerifier !== 'string' ||
        typeof next !== 'string'
      ) {
        return null;
      }
      return { state, codeVerifier, next };
    } catch {
      return null; // expired, tampered, or wrong key — one generic outcome
    }
  }

  buildAuthorizationUrl(params: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }): string {
    const url = new URL(GOOGLE_AUTHORIZATION_URL);
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', params.state);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  callbackUrl(): string {
    return `${this.config.oauthRedirectBase.replace(/\/+$/, '')}/api/v1/auth/google/callback`;
  }

  /**
   * Exchange the authorization code for tokens (server-side, PKCE verifier).
   * 8 second timeout; network failures throw a plain Error the caller maps
   * to the generic failure redirect.
   */
  async exchangeCode(params: {
    clientId: string;
    clientSecret: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<{ idToken: string }> {
    const body = new URLSearchParams({
      code: params.code,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code_verifier: params.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: params.redirectUri,
    });
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      throw new Error(`google token endpoint returned ${res.status}`);
    }
    const data = (await res.json()) as { id_token?: unknown };
    if (typeof data.id_token !== 'string' || data.id_token.length === 0) {
      throw new Error('google token response contained no id_token');
    }
    return { idToken: data.id_token };
  }

  /** Verify signature (JWKS), issuer, audience and expiry; extract the profile. */
  async verifyIdToken(idToken: string, clientId: string): Promise<GoogleProfile> {
    const { payload } = await jwtVerify(idToken, this.jwks, {
      issuer: GOOGLE_ISSUER,
      audience: clientId,
    });
    const sub = payload.sub;
    if (typeof sub !== 'string' || sub.length === 0) {
      throw new Error('id_token has no sub claim');
    }
    const email =
      typeof payload.email === 'string' && payload.email.length > 0 ? payload.email : null;
    const emailVerified = payload.email_verified === true;
    const name = typeof payload.name === 'string' && payload.name.length > 0 ? payload.name : null;
    return { sub, email, emailVerified, name };
  }

  /** PKCE pair for /start: verifier travels in the sealed state cookie. */
  createPkcePair(): { verifier: string; challenge: string } {
    const verifier = randomBytes(48).toString('base64url');
    return { verifier, challenge: base64urlSha256(verifier) };
  }

  createState(): string {
    return randomBytes(32).toString('base64url');
  }
}
