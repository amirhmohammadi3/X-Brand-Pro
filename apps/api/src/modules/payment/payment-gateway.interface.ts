/**
 * Payment gateway interface (B8.1) — the abstraction the PaymentService talks
 * to. Two drivers ship in B8.1:
 *   - `FakePaymentGateway` — succeeds on demand (configurable fail rate),
 *     issues `FAKE-<uuid>` authorities + reference ids. Used in tests + when
 *     `payment.provider=fake` is set (the dev default).
 *   - `ZarinpalSandboxGateway` — the real Zarinpal v4 sandbox client
 *     (https://sandbox.zarinpal.com/pg/v4/payment/{request,verify}.json).
 *     Disabled (404) until an admin sets the merchant id.
 *
 * The interface is intentionally narrow: `request` issues a payment intent
 * (returns the authority + the gateway URL the user must be redirected to),
 * `verify` confirms a paid intent (returns the reference id), and `name`
 * identifies the driver for logging + the payment row's `provider` field.
 *
 * Every driver is FAIL-SOFT: a network error / a non-200 response never throws
 * to the caller — it returns a `{ ok: false, code, message }` result and the
 * PaymentService marks the payment `failed`. The page must never break on a
 * gateway outage; the owner sees a friendly error and can retry.
 */
export interface PaymentGateway {
  /** The driver identifier (matches the `payment_provider` enum). */
  readonly name: 'fake' | 'zarinpal_sandbox';

  /**
   * Request a payment intent from the gateway.
   * @param amount  Tomans (integer).
   * @param description  Shown on the gateway page.
   * @param callbackUrl  Where the gateway redirects after the user pays.
   * @returns The authority (gateway tracking code) + the redirect URL, or a
   *          fail-soft error.
   */
  request(args: {
    amount: number;
    description: string;
    callbackUrl: string;
  }): Promise<PaymentGatewayRequestResult>;

  /**
   * Verify a paid intent (idempotent — the gateway rejects a re-verify, so
   * the PaymentService re-checks the payment row's `status` before calling).
   * @returns The reference id on success, or a fail-soft error.
   */
  verify(args: { authority: string; amount: number }): Promise<PaymentGatewayVerifyResult>;
}

export type PaymentGatewayRequestResult =
  | { ok: true; authority: string; gatewayUrl: string }
  | { ok: false; code: string; message: string };

export type PaymentGatewayVerifyResult =
  | { ok: true; referenceId: string }
  | { ok: false; code: string; message: string };

/** The DI token for the active gateway (the PaymentModule binds one). */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
