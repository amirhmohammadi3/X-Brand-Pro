import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HEALTH_INDICATORS } from './health-indicator.js';

/**
 * Modules that add a dependency (db, redis, worker, …) extend the providers
 * list with their own HealthIndicator implementations:
 *
 *   { provide: HEALTH_INDICATORS, useClass: DatabaseHealthIndicator }
 *   { provide: HEALTH_INDICATORS, useClass: RedisHealthIndicator }
 */
@Module({
  controllers: [HealthController],
  providers: [{ provide: HEALTH_INDICATORS, useValue: [] }],
})
export class HealthModule {}
