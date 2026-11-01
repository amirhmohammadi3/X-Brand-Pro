import { Module } from '@nestjs/common';
import { OtpModule } from '../otp/otp.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthCookieService } from './auth-cookie.service.js';
import { AuthController } from './auth.controller.js';
import { AuthOauthService } from './auth-oauth.service.js';
import { AuthOtpService } from './auth-otp.service.js';
import { AuthService } from './auth.service.js';
import { createGoogleJwks, GOOGLE_OIDC_JWKS, GoogleOauthService } from './google-oauth.service.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { OAUTH_ACCOUNTS_REPOSITORY, OauthAccountsRepository } from './oauth-accounts.repository.js';
import { PasswordService } from './password.service.js';
import { ProfileController } from './profile.controller.js';
import { ProfileService } from './profile.service.js';
import { SESSIONS_REPOSITORY, SessionsRepository } from './session.repository.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';

/**
 * Auth module (B1.3 + B1.7 + B1.8). The global guards (JwtAuthGuard,
 * CsrfOriginGuard) are registered in AppModule via APP_GUARD so their
 * dependency order in the guard chain is explicit. UsersService is consumed
 * through UsersModule's export; the OTP engine through OtpModule; SMS
 * delivery through SmsModule; email comes from the global EmailModule;
 * settings through SettingsModule (AGENTS.md 6 — no repository imports
 * across modules).
 */
@Module({
  imports: [UsersModule, OtpModule, SmsModule, SettingsModule],
  controllers: [AuthController, ProfileController],
  providers: [
    PasswordService,
    TokenService,
    { provide: SESSIONS_REPOSITORY, useClass: SessionsRepository },
    { provide: OAUTH_ACCOUNTS_REPOSITORY, useClass: OauthAccountsRepository },
    { provide: GOOGLE_OIDC_JWKS, useFactory: createGoogleJwks },
    GoogleOauthService,
    SessionService,
    AuthCookieService,
    LoginThrottleService,
    AuthService,
    AuthOtpService,
    AuthOauthService,
    ProfileService,
  ],
  exports: [TokenService, AuthService, SessionService],
})
export class AuthModule {}
