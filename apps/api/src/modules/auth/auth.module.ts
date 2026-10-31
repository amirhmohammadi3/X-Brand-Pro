import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { AuthCookieService } from './auth-cookie.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { PasswordService } from './password.service.js';
import { SESSIONS_REPOSITORY, SessionsRepository } from './session.repository.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';

/**
 * Auth module (B1.3). The global guards (JwtAuthGuard, CsrfOriginGuard) are
 * registered in AppModule via APP_GUARD so their dependency order in the
 * guard chain is explicit. UsersService is consumed through UsersModule's
 * export (AGENTS.md 6 — no repository imports across modules).
 */
@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    PasswordService,
    TokenService,
    { provide: SESSIONS_REPOSITORY, useClass: SessionsRepository },
    SessionService,
    AuthCookieService,
    LoginThrottleService,
    AuthService,
  ],
  exports: [TokenService, AuthService, SessionService],
})
export class AuthModule {}
