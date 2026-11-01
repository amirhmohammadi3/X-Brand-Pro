import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DRIZZLE_POOL } from '../../db/drizzle.client.js';
import type { HealthIndicator } from './health-indicator.js';

/**
 * Critical health indicator for PostgreSQL (B0.2 requirement, wired with the
 * B1.6 health-indicator aggregation): runs `select 1` with a short timeout so
 * a hanging database fails the probe quickly instead of holding the HTTP
 * request for the full pool connection timeout.
 */
@Injectable()
export class PostgresHealthIndicator implements HealthIndicator {
  readonly name = 'postgres';
  readonly critical = true;

  /** Injected to keep tests fast; production default is 2 s. */
  private readonly probeTimeoutMs = 2_000;

  constructor(@Inject(DRIZZLE_POOL) private readonly pool: Pool) {}

  async check(): Promise<'ok' | 'down'> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('postgres probe timed out')), this.probeTimeoutMs);
    });
    try {
      // Promise.race attaches handlers to both promises, so the losing one
      // can never become an unhandled rejection.
      await Promise.race([this.pool.query('select 1'), timeout]);
      return 'ok';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
