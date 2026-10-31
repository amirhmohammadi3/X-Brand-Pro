/**
 * Health indicators are contributed by modules through multi-provider
 * registration on the HEALTH_INDICATORS token (see health.module.ts).
 * Later prompts (db, redis, worker) add their own indicators.
 */
export interface HealthIndicator {
  /** Short name shown in the checks map, e.g. "db", "redis", "worker". */
  name: string;
  /** true when a "down" result should turn the whole health check into 503. */
  critical: boolean;
  check(): Promise<'ok' | 'degraded' | 'down'>;
}

export const HEALTH_INDICATORS = Symbol('HEALTH_INDICATORS');
