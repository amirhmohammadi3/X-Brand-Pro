import { Inject, Injectable } from '@nestjs/common';
// SMTP_DRIVER is injected by symbol; the concrete type comes from the driver
// module (type-only, never instantiated here).
import { SMTP_DRIVER } from './email.service.js';
import type { SmtpDriver } from './drivers/smtp.driver.js';
import type { HealthIndicator } from '../health/health-indicator.js';

/**
 * Non-critical health indicator for the SMTP transport (B1.6): a down SMTP
 * server degrades the service (queued mail keeps retrying) but does not take
 * the API down. Backed by transport.verify(), cached 60 s inside the driver.
 */
@Injectable()
export class SmtpHealthIndicator implements HealthIndicator {
  readonly name = 'smtp';
  readonly critical = false;

  constructor(@Inject(SMTP_DRIVER) private readonly driver: SmtpDriver) {}

  async check(): Promise<'ok' | 'down'> {
    return (await this.driver.verify()) ? 'ok' : 'down';
  }
}
