import { Injectable } from '@nestjs/common';
import type { SmsDriver, SmsMessage, SmsSendResult } from '../sms.driver.js';
import { SMS_FETCH_TIMEOUT_MS, SmsProviderError, toProviderFormat } from '../sms.driver.js';
// Value import (not type-only): Nest resolves the constructor parameter at
// runtime via emitDecoratorMetadata — type-only breaks DI (B1.3 lesson).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SmsCredentialsService } from '../sms-credentials.service.js';

/**
 * Melipayamak REST driver (B1.5). Endpoints and field names follow the
 * provider's own REST samples (docs read 2026-11-01 — see DECISIONS.md):
 *  - plain send:  POST {BASE}/SendSMS  (username, password, to, from, text, isFlash)
 *  - OTP by base service number: POST {BASE}/BaseServiceNumber
 *    (username, password, to, bodyId, text = tokens joined with `;`)
 *  - response envelope: { Value, RetStatus, StrRetStatus } — success iff
 *    StrRetStatus === 'Ok' (RetStatus 1). Everything else is a permanent
 *    failure (bad credentials / number / credit) and must not be retried.
 * MUST be verified with a real Melipayamak account before production.
 */
const BASE = 'https://rest.payamak-panel.com/api/SendSMS';

@Injectable()
export class MelipayamakDriver implements SmsDriver {
  readonly name = 'melipayamak';

  constructor(private readonly credentials: SmsCredentialsService) {}

  async send(message: SmsMessage): Promise<SmsSendResult> {
    const creds = await this.credentials.melipayamak();
    if (!creds.username || !creds.password) {
      throw new SmsProviderError(
        'melipayamak credentials are not configured (sms.melipayamak.username/password)',
        false,
        'NOT_CONFIGURED',
      );
    }

    const to = toProviderFormat(message.to);
    const body = new URLSearchParams({
      username: creds.username,
      password: creds.password,
      to,
    });
    if (message.template) {
      // BaseServiceNumber: the template's variable slots are filled in order,
      // joined with `;` (provider contract for OTP bodies).
      body.set('text', Object.values(message.template.tokens).join(';'));
      body.set('bodyId', creds.otpBodyId);
    } else {
      body.set('text', message.text ?? '');
      body.set('from', creds.sender);
      body.set('isFlash', 'false');
    }

    const url = message.template ? `${BASE}/BaseServiceNumber` : `${BASE}/SendSMS`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(SMS_FETCH_TIMEOUT_MS),
      });
    } catch (cause) {
      // Timeout / DNS / connection errors — worth a retry.
      throw new SmsProviderError(`melipayamak request failed: ${String(cause)}`, true);
    }

    if (!response.ok) {
      // HTTP-level failure: 5xx may recover, everything else is permanent.
      throw new SmsProviderError(
        `melipayamak HTTP ${response.status}`,
        response.status >= 500,
        String(response.status),
      );
    }

    const payload = (await response.json()) as {
      Value?: string | number;
      RetStatus?: string | number;
      StrRetStatus?: string;
    };
    if (payload.StrRetStatus !== 'Ok') {
      throw new SmsProviderError(
        `melipayamak send failed: StrRetStatus=${String(payload.StrRetStatus)} RetStatus=${String(payload.RetStatus)}`,
        false,
        payload.RetStatus === undefined ? undefined : String(payload.RetStatus),
      );
    }
    return { providerMessageId: payload.Value === undefined ? undefined : String(payload.Value) };
  }
}
