import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  loginBodySchema,
  refreshBodySchema,
  registerBodySchema,
  sessionSchema,
  uuidSchema,
  type AuthResult,
  type LoginBody,
  type RefreshBody,
  type RegisterBody,
  type SessionView,
} from '@app/contracts';
import type { Request, Response } from 'express';
import { RawResponse } from '../../common/interceptors/response-envelope.interceptor.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthService, type AuthFlowResult } from './auth.service.js';
import { AuthCookieService } from './auth-cookie.service.js';
import { SessionService } from './session.service.js';
import type { AuthenticatedHttpRequest } from './jwt-auth.guard.js';

/**
 * Auth endpoints (B1.3), all under /api/v1/auth (global prefix).
 *
 * Guard chain (global, in order): RateLimit → JwtAuth → CsrfOrigin → Roles.
 * Public routes skip the JWT check; the CSRF guard still applies when the
 * request carries cookies (matching Origin or no cookies — CsrfOriginGuard).
 * Tokens travel in httpOnly cookies; no token is ever echoed in a body
 * except `refreshToken` for body-based refresh clients (DECISIONS B1.3).
 */
@Controller('auth')
export class AuthController {
  constructor(
    // Explicit @Inject tokens: the imports stay runtime values for DI while
    // satisfying consistent-type-imports (constructor params are type-only).
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuthCookieService) private readonly cookies: AuthCookieService,
  ) {}

  @Public()
  @RateLimit({ name: 'auth.register', limit: 5, windowSec: 3600, failClosed: true })
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerBodySchema)) body: RegisterBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult> {
    const flow = await this.auth.register(body, this.meta(req));
    this.issueCookies(res, flow);
    return flow.auth;
  }

  /**
   * Login rate limit is "10 per 10 minutes by ip+identifier" — enforced in
   * LoginThrottleService (the decorator cannot see the identifier).
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginBodySchema)) body: LoginBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult> {
    const flow = await this.auth.login(body, { ...this.meta(req), ip: req.ip ?? 'unknown' });
    this.issueCookies(res, flow);
    return flow.auth;
  }

  /** Refresh accepts the `rt` cookie (browsers) or `{ refreshToken }` body. */
  @Public()
  @RateLimit({ name: 'auth.refresh', limit: 60, windowSec: 60 })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() body: Partial<RefreshBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult> {
    const fromBody =
      body && typeof body === 'object' && typeof body.refreshToken === 'string'
        ? refreshBodySchema.parse(body).refreshToken
        : null;
    const token = fromBody ?? req.cookies?.rt;
    if (!token) {
      throw new HttpException(
        { code: 'UNAUTHENTICATED' as const, message: 'No refresh token presented' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const flow = await this.auth.refresh(token, {
      ...this.meta(req),
      ip: req.ip ?? 'unknown',
    });
    this.issueCookies(res, flow);
    return fromBody ? { ...flow.auth, refreshToken: flow.refreshToken } : flow.auth;
  }

  @HttpCode(204)
  @RawResponse()
  @Post('logout')
  async logout(
    @Req() req: Request & AuthenticatedHttpRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const user = this.requireUser(req);
    await this.auth.logout(user.sessionId, user.id);
    this.cookies.clear(res);
  }

  @HttpCode(204)
  @RawResponse()
  @Post('logout-all')
  async logoutAll(
    @Req() req: Request & AuthenticatedHttpRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const user = this.requireUser(req);
    // "All sessions" includes the current one — cookies are cleared below.
    await this.auth.logoutAll(user.id);
    this.cookies.clear(res);
  }

  @Get('me')
  async me(@Req() req: Request & AuthenticatedHttpRequest) {
    return this.auth.me(this.requireUser(req).id);
  }

  @Get('sessions')
  async listSessions(@Req() req: Request & AuthenticatedHttpRequest): Promise<SessionView[]> {
    const user = this.requireUser(req);
    const rows = await this.sessions.listForUser(user.id);
    return rows.map((row) =>
      sessionSchema.parse({
        id: row.id,
        userAgent: row.userAgent,
        ip: row.ip ? maskIp(row.ip) : null,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt.toISOString(),
        current: row.id === user.sessionId,
      }),
    );
  }

  @HttpCode(204)
  @RawResponse()
  @Delete('sessions/:id')
  async revokeSession(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Req() req: Request & AuthenticatedHttpRequest,
  ): Promise<void> {
    const user = this.requireUser(req);
    const rows = await this.sessions.listForUser(user.id);
    const target = rows.find((row) => row.id === id);
    // Do not leak other users' session ids: unknown or foreign → 404.
    if (!target) throw new NotFoundException('Session not found');
    await this.sessions.revoke(id, 'revoked_by_user');
  }

  private issueCookies(res: Response, flow: AuthFlowResult): void {
    this.cookies.set(res, {
      accessToken: flow.accessToken,
      refreshToken: flow.refreshToken,
    });
  }

  private requireUser(req: Request & AuthenticatedHttpRequest) {
    if (!req.user) throw new ForbiddenException('Authentication required');
    return req.user;
  }

  private meta(req: Request): { ip: string | null; userAgent: string | null } {
    return {
      ip: req.ip ?? null,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    };
  }
}

/** Privacy: mask the last octet(s) of an IP for session listings. */
function maskIp(ip: string): string {
  if (ip.includes(':')) return ip; // IPv6: keep as-is (rarely user-identifying here)
  const parts = ip.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
  return ip;
}
