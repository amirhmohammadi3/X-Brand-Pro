import { Injectable, Logger } from '@nestjs/common';
import { maskTarget } from '@app/contracts';
import type { RedisLike } from '../../../redis/redis.client.js';
import type { SmsDriver, SmsMessage, SmsSendResult } from '../sms.driver.js';

export const DEV_SMS_OUTBOX_KEY = 'dev:sms:outbox';
export const DEV_SMS_OUTBOX_MAX = 50;

/**
 * Fake driver (B1.5): the default provider. Never touches the network —
 * logs the message (masked, non-production only) and pushes it to the
 * `dev:sms:outbox` Redis list (newest first, trimmed to 50) so the dev
 * endpoint and integration tests can observe deliveries.
 */
@Injectable()
export class FakeSmsDriver implements SmsDriver {
  readonly name = 'fake';
  private readonly logger = new Logger('FakeSmsDriver');

  constructor(private readonly redis: RedisLike) {}

  async send(message: SmsMessage): Promise<SmsSendResult> {
    const text = message.text ?? (message.template ? '[template]' : '');
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`[fake-sms] to=${maskTarget(message.to)} text=${text}`);
    }
    await this.redis.lpush(
      DEV_SMS_OUTBOX_KEY,
      JSON.stringify({ to: message.to, text, at: new Date().toISOString() }),
    );
    await this.redis.ltrim(DEV_SMS_OUTBOX_KEY, 0, DEV_SMS_OUTBOX_MAX - 1);
    return {};
  }
}
