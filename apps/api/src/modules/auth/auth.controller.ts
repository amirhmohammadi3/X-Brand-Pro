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
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  forgotPasswordBodySchema,
  loginBodySchema,
  otpRequestBodySchema,
  otpVerifyBodySchema,
  refreshBodySchema,
  registerBodySchema,
  resetPasswordBodySchema,
  sessionSchema,
  uuidSchema,
  verifyConfirmBodySchema,
  verifyRequestBodySchema,
  type AuthResult,
  type ForgotPasswordBody,
  type LoginBody,
  type OtpRequestBody,
  type OtpRequestResult,
  type OtpVerifyBody,
  type RefreshBody,
  type RegisterBody,
  type ResetPasswordBody,
  type SessionView,
  type VerifyConfirmBody,
  type VerifyRequestBody,
} from '@app/contracts';
import type { Request, Response } from 'express';
import { RawResponse } from '../../common/interceptors/response-envelope.interceptor.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthService, type AuthFlowResult } from './auth.service.js';
import { AuthOtpService } from './auth-otp.service.js';
import { AuthOauthService } from './auth-oauth.service.js';
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
    @Inject(AuthOtpService) private readonly authOtp: AuthOtpService,
    @Inject(AuthOauthService) private readonly oauth: AuthOauthService,
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

  // ---------------------------------------------------------------------------
  // OTP-based flows (B1.7)
  // ---------------------------------------------------------------------------

  /** Public code request. Per-target caps live in OtpService (5/h + 1/60s). */
  @Public()
  @RateLimit({
    name: 'auth.otp.request',
    limit: 10,
    windowSec: 3600,
    scope: 'ip',
    failClosed: true,
  })
  @Post('otp/request')
  async otpRequest(
    @Body(new ZodValidationPipe(otpRequestBodySchema)) body: OtpRequestBody,
    @Req() req: Request,
  ): Promise<OtpRequestResult> {
    return this.authOtp.requestLoginOtp({
      channel: body.channel,
      target: body.target,
      ip: req.ip ?? null,
      locale: this.localeHint(req),
    });
  }

  @Public()
  @RateLimit({ name: 'auth.otp.verify', limit: 20, windowSec: 3600, scope: 'ip', failClosed: true })
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async otpVerify(
    @Body(new ZodValidationPipe(otpVerifyBodySchema)) body: OtpVerifyBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult> {
    const flow = await this.authOtp.verifyLoginOtp({
      channel: body.channel,
      target: body.target,
      code: body.code,
      meta: { ...this.meta(req), ip: req.ip ?? 'unknown' },
      localeHint: this.localeHint(req),
    });
    this.issueCookies(res, flow);
    return flow.auth;
  }

  @RateLimit({
    name: 'auth.verify.request',
    limit: 5,
    windowSec: 3600,
    scope: 'user',
    failClosed: true,
  })
  @Post('verify/request')
  async verifyRequest(
    @Body(new ZodValidationPipe(verifyRequestBodySchema)) body: VerifyRequestBody,
    @Req() req: Request & AuthenticatedHttpRequest,
  ): Promise<OtpRequestResult> {
    const user = this.requireUser(req);
    return this.authOtp.requestVerification({
      userId: user.id,
      channel: body.channel,
      target: body.target,
      ip: req.ip ?? null,
      locale: this.localeHint(req),
    });
  }

  @RateLimit({
    name: 'auth.verify.confirm',
    limit: 20,
    windowSec: 3600,
    scope: 'user',
    failClosed: true,
  })
  @Post('verify/confirm')
  @HttpCode(HttpStatus.OK)
  async verifyConfirm(
    @Body(new ZodValidationPipe(verifyConfirmBodySchema)) body: VerifyConfirmBody,
    @Req() req: Request & AuthenticatedHttpRequest,
  ) {
    const user = this.requireUser(req);
    return this.authOtp.confirmVerification({
      userId: user.id,
      channel: body.channel,
      target: body.target,
      code: body.code,
    });
  }

  /** Per-identifier cap (3/h) lives in AuthOtpService — the decorator sees only ip. */
  @Public()
  @RateLimit({
    name: 'auth.password.forgot',
    limit: 5,
    windowSec: 3600,
    scope: 'ip',
    failClosed: true,
  })
  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  async passwordForgot(
    @Body(new ZodValidationPipe(forgotPasswordBodySchema)) body: ForgotPasswordBody,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    return this.authOtp.forgotPassword({
      identifier: body.identifier,
      ip: req.ip ?? null,
      locale: this.localeHint(req),
    });
  }

  @Public()
  @RateLimit({
    name: 'auth.password.reset',
    limit: 10,
    windowSec: 3600,
    scope: 'ip',
    failClosed: true,
  })
  @Post('password/reset')
  @HttpCode(204)
  @RawResponse()
  async passwordReset(
    @Body(new ZodValidationPipe(resetPasswordBodySchema)) body: ResetPasswordBody,
    @Req() req: Request,
  ): Promise<void> {
    await this.authOtp.resetPassword({
      identifier: body.identifier,
      code: body.code,
      newPassword: body.newPassword,
      meta: { ...this.meta(req), ip: req.ip ?? 'unknown' },
    });
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

  // ---------------------------------------------------------------------------
  // Google OAuth (B1.8)
  // ---------------------------------------------------------------------------

  /** 404 unless an admin enabled Google login; otherwise 302 to accounts.google.com. */
  @Public()
  @RateLimit({ name: 'auth.google.start', limit: 20, windowSec: 600, scope: 'ip' })
  @RawResponse()
  @Get('google/start')
  async googleStart(@Query('next') next: string | undefined, @Res() res: Response): Promise<void> {
    const url = await this.oauth.start(res, next);
    res.redirect(HttpStatus.FOUND, url);
  }

  /** State/PKCE verification + code exchange; always 302s to the web app. */
  @Public()
  @RawResponse()
  @Get('google/callback')
  async googleCallback(
    @Query('state') state: string | undefined,
    @Query('code') code: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const target = await this.oauth.callback({ req, res, state, code });
    res.redirect(HttpStatus.FOUND, target);
  }

  /** Linked external identities of the caller (B1.8). */
  @Get('oauth/accounts')
  async oauthAccounts(@Req() req: Request & AuthenticatedHttpRequest) {
    return this.oauth.listAccounts(this.requireUser(req).id);
  }

  /** Unlink; 422 LAST_LOGIN_METHOD when it is the only way in (B1.8). */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('oauth/accounts/:id')
  async unlinkOauthAccount(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Req() req: Request & AuthenticatedHttpRequest,
  ): Promise<void> {
    await this.oauth.unlinkAccount({ userId: this.requireUser(req).id, accountId: id });
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

  /** First Accept-Language tag when it is fa/en; otherwise undefined (site default). */
  private localeHint(req: Request): string | undefined {
    const header = req.headers['accept-language'];
    if (typeof header !== 'string') return undefined;
    const first = header.split(',')[0]?.trim().toLowerCase() ?? '';
    if (first.startsWith('fa')) return 'fa';
    if (first.startsWith('en')) return 'en';
    return undefined;
  }
}

/** Privacy: mask the last octet(s) of an IP for session listings. */
function maskIp(ip: string): string {
  if (ip.includes(':')) return ip; // IPv6: keep as-is (rarely user-identifying here)
  const parts = ip.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
  return ip;
}
