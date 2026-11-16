import { z } from 'zod';
import { uuidSchema } from './primitives.js';

/**
 * Payment contracts (B8.1). The gateway abstraction (interface + the fake +
 * Zarinpal-sandbox drivers live in the API; the contract is the wire shape
 * the API + the web app agree on). Every monetary amount is an integer in
 * Iranian Tomans (the smallest practical unit for a directory product —
 * rial would be 10× noise; the providers themselves bill in Tomans).
 *
 * Idempotency: a `Payment` row carries the `idempotency_key` the client
 * generated; the API refuses a second `request` with the same key + returns
 * the in-flight payment (so a double-click or a retry never charges twice).
 * `verify` is itself idempotent — re-verifying an already-verified payment
 * returns the same `{ verified: true }` without re-calling the gateway.
 */

/** The gateway providers (B8.1 ships fake + zarinpal-sandbox). */
export const PAYMENT_PROVIDERS = ['fake', 'zarinpal_sandbox'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

/** The lifecycle of a Payment row. */
export const PAYMENT_STATUSES = [
  'pending', // created, awaiting the user to land on the gateway
  'gatewayed', // the user was redirected to the gateway (authority issued)
  'verified', // the gateway confirmed the payment (success)
  'failed', // the gateway rejected / the verify failed
  'cancelled', // the user backed out before verify
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** What a payment is FOR (the invoice / subscription / ad-campaign linkage). */
export const PAYMENT_PURPOSES = ['subscription', 'ads', 'topup'] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

/** Create a payment intent (the request body to POST /payments). */
export const createPaymentBodySchema = z
  .object({
    /** Client-generated UUID v4 — guards against a double-charge on retry. */
    idempotencyKey: uuidSchema,
    /** Amount in Tomans (integer; 1,000 = 1,000 Tomans ≈ 100k IRR). */
    amount: z.number().int().min(1000).max(1_000_000_000),
    /** What this payment buys (drives the invoice/subscription linkage). */
    purpose: z.enum(PAYMENT_PURPOSES),
    /** The resource id this payment is for (a plan_id, a campaign_id…). */
    purposeId: uuidSchema,
    /** A human-readable description shown on the invoice + the gateway. */
    description: z.string().min(1).max(200),
  })
  .strict();
export type CreatePaymentBody = z.infer<typeof createPaymentBodySchema>;

/** The Payment resource (the response to GET /payments/:id + create). */
export const paymentSchema = z
  .object({
    id: uuidSchema,
    idempotencyKey: uuidSchema,
    amount: z.number().int().min(0),
    currency: z.literal('IRT'), // Iranian Toman
    purpose: z.enum(PAYMENT_PURPOSES),
    purposeId: uuidSchema,
    description: z.string(),
    provider: z.enum(PAYMENT_PROVIDERS),
    status: z.enum(PAYMENT_STATUSES),
    /** The gateway's tracking code (Zarinpal `authority`, fake's `FAKE-…`). */
    authority: z.string().nullable(),
    /** The gateway's verification reference (set on verify). */
    referenceId: z.string().nullable(),
    /** Where the user must be redirected to actually pay. */
    gatewayUrl: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    verifiedAt: z.string().datetime().nullable(),
  })
  .strict();
export type Payment = z.infer<typeof paymentSchema>;

/** POST /payments/:id/verify — re-verify a payment after the callback. */
export const verifyPaymentParamsSchema = z
  .object({
    /** The gateway's query-string param echoed back (Zarinpal `Authority`). */
    authority: z.string().min(1).max(200).optional(),
    /** The gateway's success flag (Zarinpal `Status` = 'OK'). */
    status: z.string().min(1).max(20).optional(),
  })
  .strict();
export type VerifyPaymentParams = z.infer<typeof verifyPaymentParamsSchema>;

/** The verify response — `{ verified, payment }` regardless of outcome. */
export const verifyPaymentResultSchema = z
  .object({
    verified: z.boolean(),
    payment: paymentSchema,
  })
  .strict();
export type VerifyPaymentResult = z.infer<typeof verifyPaymentResultSchema>;

/** The list query for an owner's payments (GET /payments?purpose=&status=). */
export const listPaymentsQuerySchema = z
  .object({
    purpose: z.enum(PAYMENT_PURPOSES).optional(),
    status: z.enum(PAYMENT_STATUSES).optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;
