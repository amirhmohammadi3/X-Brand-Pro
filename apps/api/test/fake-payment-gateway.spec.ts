import { describe, expect, it } from 'vitest';
import { FakePaymentGateway } from '../src/modules/payment/fake-payment-gateway.js';

/**
 * B8.1 FakePaymentGateway — the test/dev driver. Succeeds on demand (fail
 * rate 0 by default), issues FAKE-<uuid> authorities + FAKE-REF-<uuid>
 * references, refuses to verify a non-FAKE authority.
 */
describe('FakePaymentGateway (B8.1)', () => {
  it('issues an authority + a gateway URL on request', async () => {
    const gw = new FakePaymentGateway();
    const result = await gw.request({ amount: 50_000, description: 'test', callbackUrl: 'https://x.test/cb' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.authority).toMatch(/^FAKE-/);
      expect(result.gatewayUrl).toBe('about:blank');
    }
  });

  it('verifies its own authority + returns a reference id', async () => {
    const gw = new FakePaymentGateway();
    const req = await gw.request({ amount: 50_000, description: 'test', callbackUrl: 'https://x.test/cb' });
    if (!req.ok) throw new Error('request should succeed');
    const verify = await gw.verify({ authority: req.authority, amount: 50_000 });
    expect(verify.ok).toBe(true);
    if (verify.ok) expect(verify.referenceId).toMatch(/^FAKE-REF-/);
  });

  it('refuses to verify a non-FAKE authority', async () => {
    const gw = new FakePaymentGateway();
    const result = await gw.verify({ authority: 'ZP-foreign', amount: 50_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('fake_unknown_authority');
  });

  it('honors a configured fail rate (env-driven)', async () => {
    const original = process.env['PAYMENT_FAKE_FAIL_RATE'];
    process.env['PAYMENT_FAKE_FAIL_RATE'] = '1'; // always fail
    try {
      const gw = new FakePaymentGateway();
      const result = await gw.request({ amount: 50_000, description: 'test', callbackUrl: 'https://x.test/cb' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('fake_random_fail');
    } finally {
      if (original === undefined) delete process.env['PAYMENT_FAKE_FAIL_RATE'];
      else process.env['PAYMENT_FAKE_FAIL_RATE'] = original;
    }
  });

  it('clamps an out-of-range fail rate to 0', async () => {
    const original = process.env['PAYMENT_FAKE_FAIL_RATE'];
    process.env['PAYMENT_FAKE_FAIL_RATE'] = 'not-a-number';
    try {
      const gw = new FakePaymentGateway();
      const result = await gw.request({ amount: 50_000, description: 'test', callbackUrl: 'https://x.test/cb' });
      expect(result.ok).toBe(true); // clamped to 0 → success
    } finally {
      if (original === undefined) delete process.env['PAYMENT_FAKE_FAIL_RATE'];
      else process.env['PAYMENT_FAKE_FAIL_RATE'] = original;
    }
  });
});
