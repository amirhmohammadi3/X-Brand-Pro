import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HEALTH_INDICATORS, type HealthIndicator } from './health-indicator.js';

/**
 * Modules that add a dependency contribute their HealthIndicator
 * implementations through `HealthModule.withIndicators(...)`:
 *
 *   HealthModule.withIndicators(PostgresHealthIndicator, SmtpHealthIndicator)
 *
 * The factory registers each indicator class and aggregates their instances
 * into the HEALTH_INDICATORS array token consumed by HealthController (Nest
 * does not merge providers sharing a token, so the aggregation has to happen
 * in one place). Importing HealthModule directly (no indicators) stays valid.
 */
@Module({
  controllers: [HealthController],
  providers: [{ provide: HEALTH_INDICATORS, useValue: [] }],
})
export class HealthModule {
  static withIndicators(...indicatorClasses: Type<HealthIndicator>[]): DynamicModule {
    return {
      module: HealthModule,
      providers: [
        ...indicatorClasses,
        {
          provide: HEALTH_INDICATORS,
          useFactory: (...instances: HealthIndicator[]) => instances,
          inject: [...indicatorClasses],
        },
      ],
    };
  }
}
