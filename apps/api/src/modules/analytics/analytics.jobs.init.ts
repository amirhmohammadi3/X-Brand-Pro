import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { WORKERS_SERVICE } from '../../queue/queue.module.js';
import type { WorkersService } from '../../queue/workers.service.js';
// Value import (not type-only): Nest reads the constructor parameter type at
// runtime via emitDecoratorMetadata — type-only would break DI (B1.3).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AnalyticsService } from './analytics.service.js';
import { registerAnalyticsJobs } from './analytics.jobs.js';

/** Registers the flush + rollup repeatables (worker-only, B1.4 pattern). */
@Injectable()
export class AnalyticsJobsInit implements OnModuleInit {
  constructor(
    private readonly analytics: AnalyticsService,
    @Inject(WORKERS_SERVICE) private readonly workers: WorkersService,
  ) {}

  onModuleInit(): void {
    registerAnalyticsJobs(this.workers, this.analytics);
  }
}
