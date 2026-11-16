import { Injectable, Logger } from '@nestjs/common';
import type { PaymentGateway, PaymentGatewayRequestResult, PaymentGatewayVerifyResult } from './payment-gateway.interface.js';

/**
 * ZarinpalSandboxGateway (B8.1) — the real Zarinpal v4 sandbox client.
 *
 * Endpoints (sandbox):
 *   - POST https://sandbox.zarinpal.com/pg/v4/payment/request.json
 *   - POST https://sandbox.zarinpal.com/pg/v4/payment/verify.json
 *
 * Request body (both): `{ merchant_id, amount, description, callback_url }`
 * (verify adds `authority`). Amount is in Tomans (Zarinpal bills in Tomans
 * despite the docs sometimes saying "Rial"). The response carries
 * `data.authority` + `data.code` (100 = OK) on request, and
 * `data.ref_id` + `data.code` (100 = OK) on verify.
 *
 * The gateway URL the user is redirected to (after a successful request) is:
 *   https://sandbox.zarinpal.com/pg/StartPay/{authority}
 *
 * The merchant id is read from the settings registry at call time (NOT
 * constructor-time — an admin can change it without a restart). A missing
 * merchant id returns `{ ok: false, code: 'zarinpal_not_configured' }` so the
 * PaymentService can 503 with a friendly «درگاه فعال نیست» message.
 *
 * FAIL-SOFT: a network error / a non-200 / a non-JSON response never throws —
 * it returns `{ ok: false, code, message }`. The page must never break on a
 * gateway outage; the owner sees a friendly error and can retry.
 *
 * NOTE: this driver is NOT exercised against the real sandbox in this sandbox
 * (no network to sandbox.zarinpal.com from here). The request/verify shapes are
 * the documented v4 ones; a follow-up verifies them against the live sandbox.
 */
@Injectable()
export class ZarinpalSandboxGateway implements PaymentGateway {
  readonly name = 'zarinpal_sandbox' as const;
  private readonly logger = new Logger(ZarinpalSandboxGateway.name);
  private readonly baseUrl = 'https://sandbox.zarinpal.com/pg';
  private readonly startPayUrl = 'https://sandbox.zarinpal.com/pg/StartPay';

  constructor(private readonly merchantIdProvider: () => string | undefined) {}

  async request(args: {
    amount: number;
    description: string;
    callbackUrl: string;
  }): Promise<PaymentGatewayRequestResult> {
    const merchantId = this.merchantIdProvider();
    if (!merchantId) {
      return { ok: false, code: 'zarinpal_not_configured', message: 'Zarinpal merchant id is not set (configure it in the admin settings).' };
    }
    try {
      const res = await fetch(`${this.baseUrl}/v4/payment/request.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          merchant_id: merchantId,
          amount: args.amount,
          description: args.description,
          callback_url: args.callbackUrl,
        }),
      });
      if (!res.ok) {
        return { ok: false, code: 'zarinpal_http_error', message: `Zarinpal returned HTTP ${res.status}.` };
      }
      const json = (await res.json()) as ZarinpalResponse<ZarinpalRequestData>;
      if (!json?.data || json.data.code !== 100 || !json.data.authority) {
        return { ok: false, code: 'zarinpal_rejected', message: json?.errors?.[0]?.message ?? 'Zarinpal rejected the request.' };
      }
      const authority = json.data.authority;
      return { ok: true, authority, gatewayUrl: `${this.startPayUrl}/${authority}` };
    } catch (err) {
      this.logger.warn(`Zarinpal request failed: ${(err as Error).message}`);
      return { ok: false, code: 'zarinpal_network_error', message: 'Could not reach Zarinpal (network error).' };
    }
  }

  async verify(args: { authority: string; amount: number }): Promise<PaymentGatewayVerifyResult> {
    const merchantId = this.merchantIdProvider();
    if (!merchantId) {
      return { ok: false, code: 'zarinpal_not_configured', message: 'Zarinpal merchant id is not set.' };
    }
    try {
      const res = await fetch(`${this.baseUrl}/v4/payment/verify.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          merchant_id: merchantId,
          amount: args.amount,
          authority: args.authority,
        }),
      });
      if (!res.ok) {
        return { ok: false, code: 'zarinpal_http_error', message: `Zarinpal returned HTTP ${res.status}.` };
      }
      const json = (await res.json()) as ZarinpalResponse<ZarinpalVerifyData>;
      if (!json?.data || json.data.code !== 100 || !json.data.ref_id) {
        return { ok: false, code: 'zarinpal_verify_failed', message: json?.errors?.[0]?.message ?? 'Zarinpal verify failed.' };
      }
      return { ok: true, referenceId: String(json.data.ref_id) };
    } catch (err) {
      this.logger.warn(`Zarinpal verify failed: ${(err as Error).message}`);
      return { ok: false, code: 'zarinpal_network_error', message: 'Could not reach Zarinpal (network error).' };
    }
  }
}

interface ZarinpalResponse<T> {
  data?: T;
  errors?: ReadonlyArray<{ code: number; message: string }>;
}
interface ZarinpalRequestData {
  code: number; // 100 = OK
  authority: string;
  fee_type: string;
  fee: number;
}
interface ZarinpalVerifyData {
  code: number; // 100 = OK
  ref_id: number | string;
  fee_type: string;
  fee: number;
}
