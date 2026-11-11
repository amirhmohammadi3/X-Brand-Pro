import {
  type INestApplication,
  Logger,
  RequestMethod,
  ValidationPipe as NestValidationPipe,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter.js';
import { ResponseEnvelopeInterceptor } from '../common/interceptors/response-envelope.interceptor.js';
import { requestIdMiddleware } from '../common/middleware/request-id.middleware.js';
import { RealtimeIoAdapter } from '../modules/realtime/realtime.io-adapter.js';

/**
 * Shared app configuration used by BOTH main.ts (production path) and the
 * test helpers (createTestApp, prompt Q0.1) so tests exercise exactly the
 * same global pipes/filters/interceptors/middleware as the real server.
 */
export function configureApp(app: NestExpressApplication): INestApplication {
  const config: AppConfig = app.get(APP_CONFIG);
  const logger = new Logger(configureApp.name);

  // Request id first, so pino-http and the exception filter can use req.id.
  app.use(requestIdMiddleware);

  // Trust proxy (nginx/caddy in production): number of hops, boolean, or
  // comma-separated ip/subnet list — validated in src/config/env.ts.
  app.set('trust proxy', config.trustProxy ?? (config.isProduction ? 1 : false));

  app.use(
    helmet({
      // A JSON API does not need CSP; the web app sets its own via Next.js.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(cookieParser());
  app.use(compression());

  // JSON body limit 1mb (multipart uploads are validated separately, B2.7).
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });

  // CORS: only the public web origin may call the API with credentials.
  // NOTE: origin must be a FUNCTION — the cors package sets
  // Access-Control-Allow-Origin unconditionally for a string origin, which
  // would echo the header even for foreign origins.
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || origin === config.publicWebUrl) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
  });

  // Global prefix — health lives under it too (per prompt B0.1). Media
  // serving (B1.9) is intentionally OUTSIDE the prefix: urls stay stable as
  // `/media/<key>`. Only GET routes are excluded — the upload/delete
  // controller keeps the normal /api/v1/media/* paths. path-to-regexp v8
  // needs a named wildcard (`*splat`) to cover nested keys.
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'media/{*splat}', method: RequestMethod.GET },
      { path: 'media', method: RequestMethod.GET },
    ],
  });

  // Pino HTTP logging is attached via LoggerModule.forRoot in app.module.ts.
  app.useLogger(app.get(PinoLogger));

  // Global interceptors / filters. Route-level input validation always goes
  // through ZodValidationPipe (per-route, schema-typed); Nest's builtin pipe
  // stays for framework DTOs only.
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter(config));
  app.useGlobalPipes(new NestValidationPipe({ transform: true, whitelist: false }));

  // Graceful shutdown — SIGTERM (docker stop / systemd) closes the HTTP
  // server and DI container cleanly.
  app.enableShutdownHooks();

  // Realtime (B5.5): custom Socket.IO adapter carrying the config-derived
  // CORS policy + the /api/v1/socket.io path. The `app` first argument is
  // load-bearing (AbstractWsAdapter resolves the http.Server from it — see
  // the adapter's docblock). Registered through configureApp so main.ts AND
  // the test helpers boot the identical WS server. The gateway itself is a
  // provider of RealtimeModule.
  app.useWebSocketAdapter(new RealtimeIoAdapter(app, config));

  // OpenAPI (Swagger UI + JSON) — dev/test only, or DEV_TOOLS=true.
  if (!config.isProduction || config.isDevToolsEnabled) {
    const doc = new DocumentBuilder()
      .setTitle('X-Brand-Pro API')
      .setDescription('Local-business discovery and review platform for Iran (Persian, RTL-first).')
      .setVersion('0.0.0')
      .addServer(`http://localhost:${config.apiPort}`)
      .build();
    const document = SwaggerModule.createDocument(app, doc);
    SwaggerModule.setup('api/docs', app, document);
  }

  logger.log(
    `App configured (env=${config.nodeEnv}, docs=${!config.isProduction || config.isDevToolsEnabled ? 'on' : 'off'})`,
  );
  return app;
}
