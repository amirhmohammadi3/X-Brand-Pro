import { z } from 'zod';
import { emailSchema } from './primitives.js';

/**
 * Email domain contracts (B1.6). Mirrors sms.ts: the admin test endpoint
 * validates its body and shapes its response here so the web admin panel can
 * reuse the types without duplicating them.
 */

/** Body of POST /admin/email/test — a single recipient address. */
export const emailTestBodySchema = z
  .object({
    to: emailSchema,
  })
  .strict();
export type EmailTestBody = z.infer<typeof emailTestBodySchema>;

/** Response of POST /admin/email/test — synchronous send through the SMTP driver. */
export const emailTestResultSchema = z.object({
  ok: z.boolean(),
  providerMessageId: z.string().optional(),
  errorCode: z.string().optional(),
});
export type EmailTestResult = z.infer<typeof emailTestResultSchema>;
