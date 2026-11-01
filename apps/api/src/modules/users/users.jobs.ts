import { Logger, Injectable, Inject } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { REDIS, type RedisLike } from '../../redis/redis.client.js';
import { WORKERS_SERVICE } from '../../queue/queue.module.js';
import type { WorkersService } from '../../queue/workers.service.js';
import {
  registerMaintenanceHandler,
  scheduleMaintenanceJob,
} from '../../queue/maintenance.jobs.js';
// UsersService is constructor-injected: Nest reads its type at runtime from
// emitDecoratorMetadata, so it must stay a value import (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { UsersService } from './users.service.js';

/** Lifts expired time-boxed bans every 5 minutes (B1.14). */
export const USERS_EXPIRE_BANS_JOB = 'users:expire-bans';
export const USERS_EXPIRE_BANS_EVERY_MS = 5 * 60 * 1000;

const logger = new Logger('UsersJobs');

/**
 * The expire-bans repeatable on the shared maintenance queue (dispatcher:
 * src/queue/maintenance.jobs.ts). The API process registers it (inert —
 * startAll() runs in the worker only); the worker consumes it. Guard/login
 * already treat an expired ban as not banned (UsersService.effectiveStatus),
 * so this job is the durable cleanup that restores `status = active` and
 * clears the ban fields.
 */
export function registerUsersJobs(
  workers: WorkersService,
  users: UsersService,
  redis: RedisLike,
): void {
  registerMaintenanceHandler(USERS_EXPIRE_BANS_JOB, async () => {
    const lifted = await users.expireBans(new Date());
    for (const userId of lifted) {
      // The guard caches effective status for 30 s — drop it immediately.
      redis.del(`auth:userstatus:${userId}`).catch(() => {});
    }
    if (lifted.length > 0) {
      logger.log(`users:expire-bans lifted ${lifted.length} expired ban(s)`);
    }
  });
  scheduleMaintenanceJob(workers, USERS_EXPIRE_BANS_JOB, USERS_EXPIRE_BANS_EVERY_MS);
}

@Injectable()
export class UsersJobsInit implements OnModuleInit {
  constructor(
    private readonly users: UsersService,
    @Inject(WORKERS_SERVICE) private readonly workers: WorkersService,
    @Inject(REDIS) private readonly redis: RedisLike,
  ) {}

  onModuleInit(): void {
    registerUsersJobs(this.workers, this.users, this.redis);
  }
}
