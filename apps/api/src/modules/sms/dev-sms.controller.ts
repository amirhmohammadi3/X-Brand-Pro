import { Controller, Get, Inject } from '@nestjs/common';
import { devSmsOutboxItemSchema, type DevSmsOutboxItem } from '@app/contracts';
import { Public } from '../../common/decorators/public.decorator.js';
import { REDIS, type RedisLike } from '../../redis/redis.client.js';
import { DEV_SMS_OUTBOX_KEY, DEV_SMS_OUTBOX_MAX } from './drivers/fake.driver.js';

/**
 * Dev-only SMS outbox (B1.5). Registered ONLY when DEV_TOOLS is true and
 * NODE_ENV is not production (see app.module.ts); `loadEnv` additionally
 * rejects that combination in production. Public by design: it exposes
 * nothing user-identifying beyond masked targets and test texts.
 */
@Controller('dev/sms-outbox')
export class DevSmsController {
  constructor(@Inject(REDIS) private readonly redis: RedisLike) {}

  @Public()
  @Get()
  async outbox(): Promise<DevSmsOutboxItem[]> {
    const raw = await this.redis.lrange(DEV_SMS_OUTBOX_KEY, 0, DEV_SMS_OUTBOX_MAX - 1);
    return raw
      .map((item) => {
        try {
          return devSmsOutboxItemSchema.parse(JSON.parse(item) as unknown);
        } catch {
          return null;
        }
      })
      .filter((item): item is DevSmsOutboxItem => item !== null);
  }
}

/**
 * Registration predicate (exported for tests): the dev outbox controller is
 * part of the module tree only when dev tools are on outside production.
 */
export function devSmsEnabled(nodeEnv: string | undefined, devTools: boolean | undefined): boolean {
  return devTools === true && nodeEnv !== 'production';
}
