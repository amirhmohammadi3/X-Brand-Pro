import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module.js';
import { HealthModule } from './modules/health/health.module.js';

/**
 * Root module. pino-http options live here (not in configureApp) because they
 * need the validated config and are DI-owned. ConfigModule.forRoot() validates
 * process.env once at boot (or at module import in tests).
 */
@Module({
  imports: [
    ConfigModule.forRoot(),
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
    HealthModule,
  ],
})
export class AppModule {}
