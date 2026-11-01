import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { WORKERS_SERVICE } from './queue.module.js';
// WorkersService is constructor-injected: Nest reads its type at runtime from
// emitDecoratorMetadata, so it must stay a value import (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorkersService, type QueueJob } from './workers.service.js';

/**
 * Shared maintenance-queue dispatcher (B1.14).
 *
 * WorkersService enforces ONE processor per queue, and several prompts need
 * repeatable jobs on `maintenance` (B1.7 otp cleanup, B1.14 ban expiry).
 * This dispatcher owns the single `maintenance` processor and routes each
 * job name to its registered handler. Domain modules register HANDLERS
 * (`registerMaintenanceHandler`) and REPEATABLES
 * (`scheduleMaintenanceJob`) — never call WorkersService.register() on
 * `maintenance` directly.
 */

type MaintenanceHandler = (job: QueueJob<unknown>) => Promise<void>;

/**
 * Handler registry — MODULE-level on purpose, and REPLACING on re-register:
 * test suites boot the AppModule many times inside one worker process while
 * this map outlives individual DI containers. Last boot wins, which matches
 * the per-boot WorkersService instances (whose registrations are fresh).
 */
const handlers = new Map<string, MaintenanceHandler>();

export function registerMaintenanceHandler(jobName: string, handler: MaintenanceHandler): void {
  handlers.set(jobName, handler);
}

export function scheduleMaintenanceJob(
  workers: WorkersService,
  jobName: string,
  everyMs: number,
): void {
  workers.registerRepeatable('maintenance', jobName, {}, everyMs);
}

@Injectable()
export class MaintenanceJobsInit implements OnModuleInit {
  private readonly logger = new Logger('MaintenanceJobs');

  constructor(@Inject(WORKERS_SERVICE) private readonly workers: WorkersService) {}

  onModuleInit(): void {
    this.workers.register('maintenance', async (job) => {
      const handler = handlers.get(job.name);
      if (!handler) return; // another prompt's repeatable; not ours to handle
      await handler(job);
    });
    this.logger.log('maintenance dispatcher registered');
  }
}
