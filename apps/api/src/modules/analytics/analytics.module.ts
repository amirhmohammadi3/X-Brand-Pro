import { Module } from '@nestjs/common';
import { BusinessModule } from '../business/businesses.module.js';
import { ANALYTICS_REPOSITORY, AnalyticsRepository } from './analytics.repository.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsJobsInit } from './analytics.jobs.init.js';

/**
 * Analytics (B7.1/B7.2): the aggregate-only ingest (Redis buffer + flush
 * job), the daily rollup job and the owner-only stats API. RedisModule is
 * @Global (the repository injects REDIS directly); BusinessModule supplies
 * BUSINESSES_REPOSITORY for the owner gate — importing it creates no cycle
 * (BusinessModule imports Reviews/Qa/Audit/Media only).
 */
@Module({
  imports: [BusinessModule],
  controllers: [AnalyticsController],
  providers: [
    { provide: ANALYTICS_REPOSITORY, useClass: AnalyticsRepository },
    AnalyticsService,
    AnalyticsJobsInit,
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
