import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreatePaymentBody,
  type ListPaymentsQuery,
  type Payment,
  type PaymentProvider,
  type PaymentStatus,
  type VerifyPaymentParams,
  type VerifyPaymentResult,
  type PageMeta,
  type PaymentPurpose,
} from '@app/contracts';
import {
  PAYMENTS_REPOSITORY,
  type PaymentsRepositoryLike,
  type PaymentRow,
} from './payments.repository.js';
import { PAYMENT_GATEWAY, type PaymentGateway } from './payment-gateway.interface.js';

/** The default page size for the list endpoint (matches the rest of the API). */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * PaymentService (B8.1) — the idempotent create + verify flow.
 *
 * `create(body, actor)`:
 *   1. look up the idempotency key — if a payment exists, return it (the
 *      double-click / retry never charges twice);
 *   2. insert a fresh `pending` row;
 *   3. ask the gateway for an authority + gatewayUrl;
 *   4. on success, mark the row `gatewayed` + store the authority/URL;
 *      on failure, mark the row `failed` (the owner sees a friendly error);
 *   5. return the payment row (never throws — a gateway outage is a `failed`
 *      payment, not a 500).
 *
 * `verify(id, params, actor)`:
 *   1. load the payment (404 if absent / not the caller's);
 *   2. if already `verified`, return `{ verified: true, payment }` without
 *      re-calling the gateway (idempotent verify);
 *   3. if `failed`/`cancelled`, return `{ verified: false, payment }`;
 *   4. otherwise call the gateway; on success mark `verified` + store the
 *      reference id; on failure mark `failed`.
 *
 * `list(query, actor)` — the caller's payments, paginated.
 *
 * Fail-soft is the rule: a gateway error never throws to the caller; it
 * resolves to a `failed` payment the owner can retry. A 500 here would break
 * the checkout page, which is the one place it must never break.
 */
@Injectable()
export class PaymentService {
  constructor(
    @Inject(PAYMENTS_REPOSITORY) private readonly repo: PaymentsRepositoryLike,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  /**
   * Create a payment intent. Idempotent on `idempotencyKey` — a second call
   * with the same key returns the existing payment (whether pending,
   * gatewayed, verified or failed). The owner can safely retry on a timeout.
   */
  async create(body: CreatePaymentBody, actor: { id: string; businessId?: string }): Promise<Payment> {
    // 1. Idempotency: a payment with this key already exists → return it.
    const existing = await this.repo.findByIdempotencyKey(body.idempotencyKey);
    if (existing) {
      return toPayment(existing);
    }
    // 2. Insert a fresh `pending` row (the gateway call happens after, so a
    //    gateway outage leaves a `pending` row the owner can retry from).
    const provider = this.gateway.name;
    const inserted = await this.repo.insert({
      idempotencyKey: body.idempotencyKey,
      userId: actor.id,
      businessId: actor.businessId ?? null,
      amount: body.amount,
      currency: 'IRT',
      purpose: body.purpose,
      purposeId: body.purposeId,
      description: body.description,
      provider,
      status: 'pending',
      authority: null,
      referenceId: null,
      gatewayUrl: null,
      verifiedAt: null,
    });
    // 3. Ask the gateway for an authority + redirect URL. The gateway is
    //    fail-soft by contract, but a buggy driver could still throw — wrap
    //    it so a gateway error never breaks the checkout (a `failed` payment
    //    is the retry signal, never a 500).
    const callbackUrl = this.buildCallbackUrl(inserted.id);
    let result;
    try {
      result = await this.gateway.request({
        amount: body.amount,
        description: body.description,
        callbackUrl,
      });
    } catch {
      const failed = await this.repo.update(inserted.id, { status: 'failed' });
      return toPayment(failed ?? inserted);
    }
    // 4. On success, mark `gatewayed` + store the authority/URL; on failure,
    //    mark `failed` (never throw — a `failed` payment is the retry signal).
    if (result.ok) {
      const updated = await this.repo.update(inserted.id, {
        status: 'gatewayed',
        authority: result.authority,
        gatewayUrl: result.gatewayUrl,
      });
      return toPayment(updated ?? inserted);
    }
    const failed = await this.repo.update(inserted.id, { status: 'failed' });
    return toPayment(failed ?? inserted);
  }

  /**
   * Verify a payment after the gateway callback. Idempotent — re-verifying an
   * already-verified payment returns the same result without re-calling the
   * gateway (the gateway would reject the second verify anyway).
   */
  async verify(
    id: string,
    params: VerifyPaymentParams,
    actor: { id: string },
  ): Promise<VerifyPaymentResult> {
    const row = await this.repo.findById(id);
    if (!row || row.userId !== actor.id) {
      throw new NotFoundException({ code: 'NOT_FOUND', messageKey: 'errors.notFound' });
    }
    // Already verified — idempotent return (no second gateway call).
    if (row.status === 'verified') {
      return { verified: true, payment: toPayment(row) };
    }
    // Already failed/cancelled — not verifiable.
    if (row.status === 'failed' || row.status === 'cancelled') {
      return { verified: false, payment: toPayment(row) };
    }
    // The callback may carry the authority (Zarinpal) — use the row's if absent.
    const authority = params.authority ?? row.authority;
    if (!authority) {
      // No authority to verify with — mark cancelled (the user backed out).
      const cancelled = await this.repo.update(id, { status: 'cancelled' });
      return { verified: false, payment: toPayment(cancelled ?? row) };
    }
    // The gateway is fail-soft by contract; a buggy driver that still throws
    // resolves to a `failed` payment (never breaks the verify page).
    let result;
    try {
      result = await this.gateway.verify({ authority, amount: row.amount });
    } catch {
      const failed = await this.repo.update(id, { status: 'failed' });
      return { verified: false, payment: toPayment(failed ?? row) };
    }
    if (result.ok) {
      const verified = await this.repo.update(id, {
        status: 'verified',
        referenceId: result.referenceId,
        verifiedAt: new Date(),
      });
      return { verified: true, payment: toPayment(verified ?? row) };
    }
    const failed = await this.repo.update(id, { status: 'failed' });
    return { verified: false, payment: toPayment(failed ?? row) };
  }
  async getOne(id: string, actor: { id: string }): Promise<Payment> {
    const row = await this.repo.findById(id);
    if (!row || row.userId !== actor.id) {
      throw new NotFoundException({ code: 'NOT_FOUND', messageKey: 'errors.notFound' });
    }
    return toPayment(row);
  }

  /** List the caller's payments, paginated + optionally filtered. */
  async list(query: ListPaymentsQuery, actor: { id: string }): Promise<{
    items: Payment[];
    meta: PageMeta;
  }> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const { items, total } = await this.repo.listByUser(actor.id, {
      purpose: query.purpose,
      status: query.status,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return {
      items: items.map(toPayment),
      meta: { page, pageSize, total, totalPages },
    };
  }

  /**
   * The callback URL the gateway redirects the user to after payment. v1 uses
   * the web app's `/[locale]/payments/callback?id=…` route (the F8.1 page that
   * calls POST /payments/:id/verify). The locale is implicit — the web app
   * resolves it server-side; the API returns a locale-neutral path.
   */
  private buildCallbackUrl(paymentId: string): string {
    const base = process.env['PAYMENT_CALLBACK_URL'] ?? process.env['NEXT_PUBLIC_WEB_URL'] ?? '';
    return `${base}/payments/callback?id=${paymentId}`;
  }
}

/** Map a DB row to the contract Payment (Date → ISO string, null-safe). */
function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    amount: row.amount,
    currency: row.currency as 'IRT',
    purpose: row.purpose as PaymentPurpose,
    purposeId: row.purposeId,
    description: row.description,
    provider: row.provider as PaymentProvider,
    status: row.status as PaymentStatus,
    authority: row.authority,
    referenceId: row.referenceId,
    gatewayUrl: row.gatewayUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
  };
}
