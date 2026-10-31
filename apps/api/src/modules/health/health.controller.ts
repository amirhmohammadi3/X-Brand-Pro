import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { VERSION } from './version.js';
import { HEALTH_INDICATORS, type HealthIndicator } from './health-indicator.js';

export interface HealthPayload {
  status: 'ok' | 'degraded' | 'down';
  uptimeSec: number;
  version: string;
  checks: Record<string, 'ok' | 'degraded' | 'down'>;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(HEALTH_INDICATORS) private readonly indicators: HealthIndicator[]) {}

  @Public() // liveness probes must never require auth (global JwtAuthGuard, B1.3)
  @Get()
  @ApiOperation({ summary: 'Liveness/readiness probe. 503 when a critical indicator is down.' })
  @ApiOkResponse({ description: 'Aggregated health of the API and its dependencies.' })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthPayload> {
    const checks: Record<string, 'ok' | 'degraded' | 'down'> = {};

    await Promise.all(
      this.indicators.map(async (ind) => {
        try {
          checks[ind.name] = await ind.check();
        } catch {
          checks[ind.name] = 'down';
        }
      }),
    );

    const criticalDown = this.indicators.some((ind) => ind.critical && checks[ind.name] === 'down');
    const anyDown = Object.values(checks).includes('down');
    const anyDegraded = Object.values(checks).includes('degraded');

    const status = criticalDown ? 'down' : anyDown || anyDegraded ? 'degraded' : 'ok';

    // passthrough lets the global ResponseEnvelopeInterceptor wrap this into
    // { ok: true, data } while still allowing an explicit 503 status code.
    res.status(criticalDown ? 503 : 200);
    return { status, uptimeSec: Math.floor(process.uptime()), version: VERSION, checks };
  }
}
