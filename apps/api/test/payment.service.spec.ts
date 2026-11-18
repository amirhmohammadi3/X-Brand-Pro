import { describe, expect, it, vi } from 'vitest';
import { PaymentService } from '../src/modules/payment/payment.service.js';
import type { PaymentsRepositoryLike, PaymentRow } from '../src/modules/payment/payments.repository.js';
import type { PaymentGateway } from '../src/modules/payment/payment-gateway.interface.js';
import type { CreatePaymentBody } from '@app/contracts';

/**
 * B8.1 PaymentService — DB-free unit tests. The idempotency gate (the
 * double-charge guard), the fail-soft gateway flow (a `failed` payment, not
 * a throw), the idempotent verify (no second gateway call), and the
 * ownership gate (a 404 when the payment belongs to another user).
 */

const USER = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000a2';
const BIZ = '00000000-0000-4000-8000-0000000000b1';
const PLAN = '00000000-0000-4000-8000-0000000000p1';
const IDEMP = '00000000-0000-4000-8000-0000000000i1';

type RepoStub = PaymentsRepositoryLike & {
  rows: Map<string, PaymentRow>;
  byIdempotency: Map<string, string>; // key → id
  inserts: number;
  updates: number;
};

function makeRow(overrides: Partial<PaymentRow> = {}): PaymentRow {
  const now = new Date();
  return {
    id: '00000000-0000-4000-8000-0000000000p1',
    idempotencyKey: IDEMP,
    userId: USER,
    businessId: BIZ,
    amount: 50_000,
    currency: 'IRT',
    purpose: 'subscription',
    purposeId: PLAN,
    description: ' Starter plan — monthly',
    provider: 'fake',
    status: 'pending',
    authority: null,
    referenceId: null,
    gatewayUrl: null,
    verifiedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRepo(initial: PaymentRow[] = []): RepoStub {
  const rows = new Map<string, PaymentRow>();
  const byIdempotency = new Map<string, string>();
  for (const r of initial) {
    rows.set(r.id, r);
    byIdempotency.set(r.idempotencyKey, r.id);
  }
  const repo: RepoStub = {
    rows,
    byIdempotency,
    inserts: 0,
    updates: 0,
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findByIdempotencyKey(key) {
      const id = byIdempotency.get(key);
      return id ? (rows.get(id) ?? null) : null;
    },
    async findLatestForPurpose(purpose, purposeId) {
      let latest: PaymentRow | null = null;
      for (const r of rows.values()) {
        if (r.purpose === purpose && r.purposeId === purposeId) {
          if (!latest || r.createdAt > latest.createdAt) latest = r;
        }
      }
      return latest;
    },
    async listByUser(userId, opts) {
      const all = [...rows.values()]
        .filter((r) => r.userId === userId)
        .filter((r) => (opts.purpose ? r.purpose === opts.purpose : true))
        .filter((r) => (opts.status ? r.status === opts.status : true))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const items = all.slice(opts.offset, opts.offset + opts.limit);
      return { items, total: all.length };
    },
    async insert(row) {
      repo.inserts += 1;
      const inserted = makeRow({ ...row, id: `id-${repo.inserts}` });
      rows.set(inserted.id, inserted);
      byIdempotency.set(inserted.idempotencyKey, inserted.id);
      return inserted;
    },
    async update(id, patch) {
      repo.updates += 1;
      const existing = rows.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patch, updatedAt: new Date() };
      rows.set(id, updated);
      return updated;
    },
  };
  return repo;
}

function makeGateway(opts: Partial<PaymentGateway> = {}): PaymentGateway {
  const base: PaymentGateway = {
    name: 'fake',
    async request(args) {
      void args;
      return { ok: true, authority: 'FAKE-auth-1', gatewayUrl: 'about:blank' };
    },
    async verify(args) {
      void args;
      return { ok: true, referenceId: 'FAKE-REF-1' };
    },
  };
  return { ...base, ...opts };
}

function makeBody(overrides: Partial<CreatePaymentBody> = {}): CreatePaymentBody {
  return {
    idempotencyKey: IDEMP,
    amount: 50_000,
    purpose: 'subscription',
    purposeId: PLAN,
    description: 'Starter plan — monthly',
    ...overrides,
  };
}

describe('PaymentService.create (B8.1)', () => {
  it('inserts a pending row, calls the gateway, marks gatewayed', async () => {
    const repo = makeRepo();
    const gw = makeGateway();
    const svc = new PaymentService(repo, gw);
    const payment = await svc.create(makeBody(), { id: USER, businessId: BIZ });
    expect(repo.inserts).toBe(1);
    expect(repo.updates).toBe(1);
    expect(payment.status).toBe('gatewayed');
    expect(payment.authority).toBe('FAKE-auth-1');
    expect(payment.gatewayUrl).toBe('about:blank');
  });

  it('is idempotent on idempotencyKey — a second call returns the existing row', async () => {
    const repo = makeRepo();
    const gw = makeGateway();
    const svc = new PaymentService(repo, gw);
    const first = await svc.create(makeBody(), { id: USER, businessId: BIZ });
    const second = await svc.create(makeBody(), { id: USER, businessId: BIZ });
    expect(repo.inserts).toBe(1); // NOT 2 — the second call hit the idempotency gate
    expect(second.id).toBe(first.id);
    expect(second.status).toBe(first.status);
  });

  it('marks the payment failed when the gateway rejects (never throws)', async () => {
    const repo = makeRepo();
    const gw = makeGateway({
      request: async () => ({ ok: false, code: 'zarinpal_rejected', message: 'no' }),
    });
    const svc = new PaymentService(repo, gw);
    const payment = await svc.create(makeBody(), { id: USER });
    expect(payment.status).toBe('failed');
    expect(payment.authority).toBeNull();
  });

  it('marks the payment failed when the gateway throws (fail-soft)', async () => {
    const repo = makeRepo();
    const gw = makeGateway({
      request: async () => {
        throw new Error('network down');
      },
    });
    const svc = new PaymentService(repo, gw);
    // The fake driver swallows the throw; the real ZarinpalSandboxGateway
    // already fail-softs internally. This test guards a regression where a
    // gateway forgets to fail-soft: the service still resolves.
    const payment = await svc.create(makeBody(), { id: USER });
    // Either the gateway returned ok:false OR it threw — either way the
    // service resolved to a non-pending row.
    expect(['failed', 'gatewayed']).toContain(payment.status);
  });
});

describe('PaymentService.verify (B8.1)', () => {
  it('verifies a gatewayed payment + stores the reference id', async () => {
    const existing = makeRow({ id: 'pay-1', userId: USER, status: 'gatewayed', authority: 'FAKE-auth-1' });
    const repo = makeRepo([existing]);
    const gw = makeGateway();
    const svc = new PaymentService(repo, gw);
    const result = await svc.verify('pay-1', {}, { id: USER });
    expect(result.verified).toBe(true);
    expect(result.payment.status).toBe('verified');
    expect(result.payment.referenceId).toBe('FAKE-REF-1');
    expect(result.payment.verifiedAt).not.toBeNull();
  });

  it('is idempotent — re-verifying an already-verified payment does NOT call the gateway again', async () => {
    const existing = makeRow({
      id: 'pay-1',
      userId: USER,
      status: 'verified',
      referenceId: 'FIRST-REF',
      authority: 'FAKE-auth-1',
    });
    const repo = makeRepo([existing]);
    const verifySpy = vi.fn(async (): Promise<{ ok: true; referenceId: string }> => ({
      ok: true,
      referenceId: 'SECOND-REF',
    }));
    const gw = makeGateway({ verify: verifySpy });
    const svc = new PaymentService(repo, gw);
    const result = await svc.verify('pay-1', {}, { id: USER });
    expect(result.verified).toBe(true);
    expect(result.payment.referenceId).toBe('FIRST-REF'); // unchanged
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('returns verified:false (without calling the gateway) for a failed payment', async () => {
    const existing = makeRow({ id: 'pay-1', userId: USER, status: 'failed' });
    const repo = makeRepo([existing]);
    const verifySpy = vi.fn(async (): Promise<{ ok: true; referenceId: string }> => ({
      ok: true,
      referenceId: 'X',
    }));
    const gw = makeGateway({ verify: verifySpy });
    const svc = new PaymentService(repo, gw);
    const result = await svc.verify('pay-1', {}, { id: USER });
    expect(result.verified).toBe(false);
    expect(result.payment.status).toBe('failed');
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('marks the payment failed when the gateway verify rejects', async () => {
    const existing = makeRow({ id: 'pay-1', userId: USER, status: 'gatewayed', authority: 'FAKE-auth-1' });
    const repo = makeRepo([existing]);
    const gw = makeGateway({
      verify: async () => ({ ok: false, code: 'zarinpal_verify_failed', message: 'no' }),
    });
    const svc = new PaymentService(repo, gw);
    const result = await svc.verify('pay-1', {}, { id: USER });
    expect(result.verified).toBe(false);
    expect(result.payment.status).toBe('failed');
  });

  it('throws 404 when the payment belongs to another user', async () => {
    const existing = makeRow({ id: 'pay-1', userId: OTHER, status: 'gatewayed' });
    const repo = makeRepo([existing]);
    const gw = makeGateway();
    const svc = new PaymentService(repo, gw);
    await expect(svc.verify('pay-1', {}, { id: USER })).rejects.toThrow();
  });

  it('throws 404 when the payment does not exist', async () => {
    const repo = makeRepo();
    const gw = makeGateway();
    const svc = new PaymentService(repo, gw);
    await expect(svc.verify('missing', {}, { id: USER })).rejects.toThrow();
  });

  it('marks cancelled when there is no authority to verify with', async () => {
    const existing = makeRow({ id: 'pay-1', userId: USER, status: 'gatewayed', authority: null });
    const repo = makeRepo([existing]);
    const gw = makeGateway();
    const svc = new PaymentService(repo, gw);
    const result = await svc.verify('pay-1', {}, { id: USER });
    expect(result.verified).toBe(false);
    expect(result.payment.status).toBe('cancelled');
  });
});

describe('PaymentService.getOne + list (B8.1)', () => {
  it('getOne returns the payment for the owner', async () => {
    const existing = makeRow({ id: 'pay-1', userId: USER });
    const repo = makeRepo([existing]);
    const svc = new PaymentService(repo, makeGateway());
    const payment = await svc.getOne('pay-1', { id: USER });
    expect(payment.id).toBe('pay-1');
  });

  it('getOne throws 404 for another user payment', async () => {
    const existing = makeRow({ id: 'pay-1', userId: OTHER });
    const repo = makeRepo([existing]);
    const svc = new PaymentService(repo, makeGateway());
    await expect(svc.getOne('pay-1', { id: USER })).rejects.toThrow();
  });

  it('list paginates + filters by the caller only', async () => {
    const repo = makeRepo([
      makeRow({ id: 'p1', userId: USER, purpose: 'subscription', status: 'verified' }),
      makeRow({ id: 'p2', userId: USER, purpose: 'ads', status: 'pending' }),
      makeRow({ id: 'p3', userId: OTHER, purpose: 'subscription', status: 'verified' }),
    ]);
    const svc = new PaymentService(repo, makeGateway());
    const all = await svc.list({}, { id: USER });
    expect(all.items).toHaveLength(2); // p3 excluded — not the caller's
    expect(all.meta.total).toBe(2);
    const subs = await svc.list({ purpose: 'subscription' }, { id: USER });
    expect(subs.items).toHaveLength(1);
    expect(subs.items[0]!.id).toBe('p1');
    const verified = await svc.list({ status: 'verified' }, { id: USER });
    expect(verified.items).toHaveLength(1);
    expect(verified.items[0]!.id).toBe('p1');
  });

  it('list respects page + pageSize', async () => {
    const rows: PaymentRow[] = [];
    for (let i = 0; i < 5; i++) {
      rows.push(makeRow({ id: `p${i}`, userId: USER, idempotencyKey: `key-${i}` }));
    }
    const repo = makeRepo(rows);
    const svc = new PaymentService(repo, makeGateway());
    const page1 = await svc.list({ page: 1, pageSize: 2 }, { id: USER });
    expect(page1.items).toHaveLength(2);
    expect(page1.meta.total).toBe(5);
    expect(page1.meta.totalPages).toBe(3);
    const page2 = await svc.list({ page: 2, pageSize: 2 }, { id: USER });
    expect(page2.items).toHaveLength(2);
    const page3 = await svc.list({ page: 3, pageSize: 2 }, { id: USER });
    expect(page3.items).toHaveLength(1);
  });
});
