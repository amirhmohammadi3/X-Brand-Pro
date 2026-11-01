import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
// Reflector is constructor-injected: Nest reads its type at runtime via
// emitDecoratorMetadata, so it must stay a value import (like the
// RateLimitGuard — do not "fix" to type-only).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { Reflector } from '@nestjs/core';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.js';
import type { UserRole } from '@app/contracts';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';
import { REDIS, type RedisLike } from '../../redis/redis.client.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';
import { UsersService } from '../users/users.service.js';

export interface AuthenticatedHttpRequest {
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string>;
  ip?: string;
  user?: { id: string; role: UserRole; status: string; sessionId: string };
}

function unauthorized(code: 'UNAUTHENTICATED' | 'SESSION_REVOKED', message: string): HttpException {
  return new HttpException({ code, message }, HttpStatus.UNAUTHORIZED);
}

/**
 * Global JWT/session guard (B1.3). Order in the global guard chain:
 * RateLimit → JwtAuth → CsrfOrigin → Roles.
 *
 * - Skips @Public() routes.
 * - Reads the access token from `Authorization: Bearer` first, then the `at`
 *   cookie. Missing/invalid/expired → 401 UNAUTHENTICATED (clients refresh).
 * - Verifies the session is live via SessionService.isActive (Redis 60s
 *   cache, DB fallback). A revoked session stops working immediately.
 * - Loads user status (30s Redis cache) and rejects banned accounts (403
 *   ACCOUNT_BANNED).
 * - On success sets `request.user = { id, role, status, sessionId }` for
 *   RolesGuard and controllers.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(REDIS) private readonly redis: RedisLike,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedHttpRequest>();
    const authHeader = req.headers.authorization;
    const bearer =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : undefined;
    const token = bearer || req.cookies?.at;
    if (!token) throw unauthorized('UNAUTHENTICATED', 'Missing access token');

    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw unauthorized('UNAUTHENTICATED', 'Invalid or expired access token');

    const active = await this.sessions.isActive(claims.sid);
    if (!active) throw unauthorized('SESSION_REVOKED', 'Session is no longer active');

    const status = await this.loadStatus(claims.sub);
    if (status !== 'active') {
      throw new HttpException(
        { code: 'ACCOUNT_BANNED' as const, message: 'Account is banned' },
        HttpStatus.FORBIDDEN,
      );
    }

    req.user = { id: claims.sub, role: claims.role as UserRole, status, sessionId: claims.sid };
    return true;
  }

  /**
   * User status with a 30s Redis cache; DB is the fallback and the truth.
   * B1.14: the cache holds the EFFECTIVE status — an expired time-boxed ban
   * counts as active (the users:expire-bans job then lifts it for real).
   */
  private async loadStatus(userId: string): Promise<string> {
    const key = `auth:userstatus:${userId}`;
    try {
      const cached = await this.redis.get(key);
      if (cached) return cached;
    } catch {
      // fall through to the database
    }
    const row = await this.users.getById(userId);
    const effective = this.users.effectiveStatus(row);
    try {
      await this.redis.set(key, effective, 'EX', 30);
    } catch {
      // cache write failures are non-fatal
    }
    return effective;
  }
}
