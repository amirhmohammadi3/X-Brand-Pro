import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { CacheService } from './cache.service.js';
import { RateLimiterService } from './rate-limiter.service.js';
import { RedisService, REDIS } from './redis.client.js';

/**
 * Global infrastructure module for Redis-backed services (parallel to
 * src/db for Postgres). The connection is lazy and failure-tolerant:
 * booting the app without a running Redis is fine, cache reads miss and the
 * rate limiter fails open (logged) until Redis returns.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new RedisService(config.redisUrl),
    },
    CacheService,
    RateLimiterService,
  ],
  exports: [REDIS, CacheService, RateLimiterService],
})
export class RedisModule {}
