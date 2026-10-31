import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { QueuesService } from './queues.service.js';
import { WorkersService } from './workers.service.js';

export const QUEUES_SERVICE = Symbol('QUEUES_SERVICE');
export const WORKERS_SERVICE = Symbol('WORKERS_SERVICE');

/**
 * Global queue infrastructure. `QueuesService` (enqueue) is used by the API
 * process; `WorkersService` (consume) is started ONLY by `src/worker.ts` via
 * `startAll()`. Both share REDIS_URL with the cache — BullMQ keys are
 * prefixed `bull:` by the library itself, and our RedisService prefix
 * (`xbrand:`) is NOT applied to BullMQ connections, which is intentional:
 * BullMQ manages its own key space.
 */
@Global()
@Module({
  providers: [
    {
      provide: QUEUES_SERVICE,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => new QueuesService(c.redisUrl),
    },
    {
      provide: WORKERS_SERVICE,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => new WorkersService(c.redisUrl),
    },
  ],
  exports: [QUEUES_SERVICE, WORKERS_SERVICE],
})
export class QueueModule {}
