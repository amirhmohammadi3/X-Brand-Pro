import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PaymentGateway, PaymentGatewayRequestResult, PaymentGatewayVerifyResult } from './payment-gateway.interface.js';

/**
 * FakePaymentGateway (B8.1) — the test/dev driver. Succeeds on demand; the
 * fail rate is configurable via the `PAYMENT_FAKE_FAIL_RATE` env (0..1, default
 * 0 — always succeeds). The authority is `FAKE-<uuid>`; the gateway URL is a
 * no-op `about:blank` (the fake never actually redirects — the test calls
 * verify directly). The reference id is `FAKE-REF-<uuid>`.
 *
 * The fake is deterministic enough for tests (no clock randomness beyond
 * Math.random for the fail rate, which tests set to 0) and side-effect-free
 * (no network, no disk — the authority lives only in the payment row).
 */
@Injectable()
export class FakePaymentGateway implements PaymentGateway {
  readonly name = 'fake' as const;

  private readonly failRate: number;
  constructor() {
    const raw = process.env['PAYMENT_FAKE_FAIL_RATE'];
    const parsed = raw !== undefined ? Number(raw) : 0;
    this.failRate = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
  }

  async request(args: {
    amount: number;
    description: string;
    callbackUrl: string;
  }): Promise<PaymentGatewayRequestResult> {
    if (Math.random() < this.failRate) {
      return { ok: false, code: 'fake_random_fail', message: 'The fake gateway randomly rejected the request (configure PAYMENT_FAKE_FAIL_RATE).' };
    }
    const authority = `FAKE-${randomUUID()}`;
    // The fake gateway never actually redirects — `about:blank` is a safe
    // placeholder the test ignores. The real drivers return a real URL.
    void args;
    return { ok: true, authority, gatewayUrl: 'about:blank' };
  }

  async verify(args: { authority: string; amount: number }): Promise<PaymentGatewayVerifyResult> {
    if (!args.authority.startsWith('FAKE-')) {
      return { ok: false, code: 'fake_unknown_authority', message: 'The fake gateway only verifies its own authorities.' };
    }
    if (Math.random() < this.failRate) {
      return { ok: false, code: 'fake_random_fail', message: 'The fake gateway randomly rejected the verify (configure PAYMENT_FAKE_FAIL_RATE).' };
    }
    void args.amount;
    return { ok: true, referenceId: `FAKE-REF-${randomUUID()}` };
  }
}
