import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { LoggerModule } from 'nestjs-pino';
import { RateLimitGuard } from './common/guards/rate-limit.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { ConfigModule } from './config/config.module.js';
import { DrizzleModule } from './db/drizzle.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CsrfOriginGuard } from './modules/auth/csrf-origin.guard.js';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard.js';
import { EmailModule } from './modules/email/email.module.js';
import { SmtpHealthIndicator } from './modules/email/smtp.health.js';
import { GeoModule } from './modules/geo/geo.module.js';
import { CatalogModule } from './modules/catalog/categories/categories.module.js';
import { AmenitiesModule } from './modules/catalog/amenities/amenities.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { PostgresHealthIndicator } from './modules/health/postgres.health.js';
import { I18nModule } from './modules/i18n/i18n.module.js';
import { MediaModule } from './modules/media/media.module.js';
import { OtpModule } from './modules/otp/otp.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { ThemeModule } from './modules/theme/theme.module.js';
import { DevSmsModule, SmsModule } from './modules/sms/sms.module.js';
import { devSmsEnabled } from './modules/sms/dev-sms.controller.js';
import { UsersModule } from './modules/users/users.module.js';
import { MaintenanceJobsInit } from './queue/maintenance.jobs.js';
import { QueueModule } from './queue/queue.module.js';
import { RedisModule } from './redis/redis.module.js';

/**
 * Root module. pino-http options live here (not in configureApp) because they
 * need the validated config and are DI-owned. ConfigModule.forRoot() validates
 * process.env once at boot (or at module import in tests).
 */
@Module({
  imports: [
    ConfigModule.forRoot(),
    DrizzleModule,
    RedisModule,
    QueueModule,
    AuditModule,
    // In-process domain events (AGENTS.md 6): subscribers live in the
    // module that reacts to an event, not here.
    EventEmitterModule.forRoot({ wildcard: true, ignoreErrors: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        genReqId: (req) => (req as unknown as { id?: string }).id ?? '',
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            'req.body.password',
            'req.body.token',
            'req.body.secret',
            'req.body.code',
          ],
          censor: '[REDACTED]',
        },
        transport:
          process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined, // JSON in production AND test (pretty logs are a dev-only feature)
        autoLogging: true,
      },
    }),
    HealthModule.withIndicators(PostgresHealthIndicator, SmtpHealthIndicator),
    SettingsModule,
    ThemeModule,
    I18nModule,
    UsersModule,
    AuthModule,
    OtpModule,
    SmsModule,
    EmailModule,
    MediaModule,
    GeoModule,
    CatalogModule,
    AmenitiesModule,
    // Dev-only raw outbox (B1.5): never registered in production — loadEnv
    // additionally rejects DEV_TOOLS=true with NODE_ENV=production at boot.
    ...(devSmsEnabled(process.env.NODE_ENV, process.env.DEV_TOOLS === 'true')
      ? [DevSmsModule]
      : []),
  ],
  providers: [
    // B1.14: the single `maintenance` queue processor (routes job names to
    // per-prompt handlers; see src/queue/maintenance.jobs.ts).
    MaintenanceJobsInit,
    // Global opt-in rate limiting: routes annotated with @RateLimit are
    // enforced with the Redis limiter; everything else passes through.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    // Identity (B1.3): verifies the access token (bearer or cookie), the
    // session's liveness and the user's status; sets request.user.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // CSRF origin check for cookie-bearing unsafe requests (B1.3).
    { provide: APP_GUARD, useClass: CsrfOriginGuard },
    // RBAC metadata enforcement (B1.2) — depends on request.user from above.
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
