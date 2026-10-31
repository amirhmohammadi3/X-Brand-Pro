import { Injectable } from '@nestjs/common';
import type { SmsDriver, SmsMessage, SmsSendResult } from '../sms.driver.js';
import { SMS_FETCH_TIMEOUT_MS, SmsProviderError, toProviderFormat } from '../sms.driver.js';
// Value import (not type-only): Nest resolves the constructor parameter at
// runtime via emitDecoratorMetadata — type-only breaks DI (B1.3 lesson).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SmsCredentialsService } from '../sms-credentials.service.js';

/**
 * Kavenegar REST driver (B1.5). Contract from kavenegar.com/rest.html (docs
 * read 2026-11-01 — see DECISIONS.md): `https://api.kavenegar.com/v1/{API-KEY}/…`
 * with GET or POST, form/query params, and the envelope
 * `{ return: { status, message }, entries: [{ messageid, … }] }` — success iff
 * `return.status === 200`. HTTP 409 ("server busy, try later") and 5xx are
 * retryable; 400/401/402/403/404/405/411/412/413/414/417/418/419/422/426/607
 * (bad params, disabled/invalid account, insufficient credit 418, …) are not.
 * MUST be verified with a real Kavenegar account before production.
 */
const BASE = 'https://api.kavenegar.com/v1';

@Injectable()
export class KavenegarDriver implements SmsDriver {
  readonly name = 'kavenegar';

  constructor(private readonly credentials: SmsCredentialsService) {}

  async send(message: SmsMessage): Promise<SmsSendResult> {
    const creds = await this.credentials.kavenegar();
    if (!creds.apiKey) {
      throw new SmsProviderError(
        'kavenegar credentials are not configured (sms.kavenegar.apiKey)',
        false,
        'NOT_CONFIGURED',
      );
    }

    const receptor = toProviderFormat(message.to);
    const body = new URLSearchParams({ receptor });
    const path = message.template ? 'verify/lookup.json' : 'sms/send.json';
    if (message.template) {
      // verify/lookup: token/token2/token3 fill the template variables,
      // `template` names the configured lookup template.
      const tokens = message.template.tokens;
      body.set('token', tokens['token'] ?? Object.values(tokens)[0] ?? '');
      if (tokens['token2']) body.set('token2', tokens['token2']);
      if (tokens['token3']) body.set('token3', tokens['token3']);
      body.set('template', message.template.name || creds.otpTemplate);
    } else {
      body.set('message', message.text ?? '');
      if (creds.sender) body.set('sender', creds.sender);
    }

    let response: Response;
    try {
      response = await fetch(`${BASE}/${creds.apiKey}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(SMS_FETCH_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new SmsProviderError(`kavenegar request failed: ${String(cause)}`, true);
    }

    if (!response.ok && response.status !== 409) {
      // The envelope also carries the code, but the HTTP status is the
      // primary signal; 409 ("server busy") is retried via the envelope
      // branch below.
      throw new SmsProviderError(
        `kavenegar HTTP ${response.status}`,
        response.status >= 500,
        String(response.status),
      );
    }

    const payload = (await response.json()) as {
      return?: { status?: number; message?: string };
      entries?: Array<{ messageid?: number | string }>;
    };
    const status = payload.return?.status;
    if (status !== 200) {
      const retryable = status === 409; // "server unable to respond — try later"
      throw new SmsProviderError(
        `kavenegar send failed: status=${String(status)} message=${payload.return?.message ?? 'unknown'}`,
        retryable,
        status === undefined ? undefined : String(status),
      );
    }
    const first = payload.entries?.[0]?.messageid;
    return { providerMessageId: first === undefined ? undefined : String(first) };
  }
}
