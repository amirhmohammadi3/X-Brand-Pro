import { z } from 'zod';
import { iranMobileSchema } from './primitives.js';

/**
 * SMS domain contracts (B1.5). The admin test endpoint validates its body
 * here; the dev outbox items the fake driver writes are described as well so
 * the web admin can render them later without duplicating the shape.
 */

/** Body of POST /admin/sms/test — a single Iranian mobile target. */
export const smsTestBodySchema = z
  .object({
    to: iranMobileSchema,
  })
  .strict();
export type SmsTestBody = z.infer<typeof smsTestBodySchema>;

/**
 * One entry of the dev outbox list (`dev:sms:outbox`), as written by the
 * fake driver. `to` is masked (the raw number never leaves the API).
 */
export const devSmsOutboxItemSchema = z.object({
  to: z.string(),
  text: z.string(),
  at: z.string(),
});
export type DevSmsOutboxItem = z.infer<typeof devSmsOutboxItemSchema>;

/** Response of POST /admin/sms/test — synchronous send through the current driver. */
export const smsTestResultSchema = z.object({
  driver: z.string(),
  ok: z.boolean(),
  providerMessageId: z.string().optional(),
  errorCode: z.string().optional(),
});
export type SmsTestResult = z.infer<typeof smsTestResultSchema>;
