import { describe, expect, it } from 'vitest';
import { BillingService, FREE_TIER_LIMITS } from '../src/modules/billing/billing.service.js';
import type { BillingRepositoryLike } from '../src/modules/billing/billing.repository.js';
import type { PlanRow, SubscriptionRow, InvoiceRow } from '../src/modules/billing/billing.repository.js';
import type { UpsertSubscriptionBody } from '@app/contracts';

/**
 * B8.2 BillingService — DB-free unit tests. The plan catalog read, the
 * subscription upsert (cancel-previous + insert-new + draft-invoice), the
 * free-tier fallback, the payment-settle hook (idempotent), and the
 * expiry job.
 */

const BIZ = '00000000-0000-4000-8000-0000000000b1';
const PLAN_STARTER = '00000000-0000-4000-8000-000000000002';
const PLAN_PRO = '00000000-0000-4000-8000-000000000003';

type RepoStub = BillingRepositoryLike & {
  plans: Map<string, PlanRow>;
  subs: Map<string, SubscriptionRow>;
  invoices: Map<string, InvoiceRow>;
  activeSub: Map<string, string>; // businessId → subId
  invoiceCounter: number;
};

function makePlan(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    id: PLAN_STARTER,
    tier: 'starter',
    nameKey: 'billing.plan.starter.name',
    priceMonthly: 49_000,
    priceYearly: 490_000,
    limits: JSON.stringify({ galleryPhotos: 30, menuItems: 100, videos: false, ai: false, ads: true, adCampaigns: 1 }),
    isActive: true,
    sortOrder: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSub(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  const now = new Date();
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + 30);
  return {
    id: 'sub-1',
    businessId: BIZ,
    planId: PLAN_STARTER,
    planTier: 'starter',
    status: 'active',
    interval: 'monthly',
    currentPeriodStart: now,
    currentPeriodEnd: end,
    autoRenew: true,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRepo(initialPlans: PlanRow[] = [], initialSubs: SubscriptionRow[] = []): RepoStub {
  const plans = new Map<string, PlanRow>();
  for (const p of initialPlans) plans.set(p.id, p);
  const subs = new Map<string, SubscriptionRow>();
  const activeSub = new Map<string, string>();
  for (const s of initialSubs) {
    subs.set(s.id, s);
    if (s.status === 'active' || s.status === 'past_due') activeSub.set(s.businessId, s.id);
  }
  const invoices = new Map<string, InvoiceRow>();
  const repo: RepoStub = {
    plans,
    subs,
    invoices,
    activeSub,
    invoiceCounter: 0,
    async listActivePlans() {
      return [...plans.values()].filter((p) => p.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
    },
    async findPlanById(id) {
      return plans.get(id) ?? null;
    },
    async findPlanByTier(tier) {
      return [...plans.values()].find((p) => p.tier === tier && p.isActive) ?? null;
    },
    async findActiveSubscription(businessId) {
      const id = activeSub.get(businessId);
      return id ? (subs.get(id) ?? null) : null;
    },
    async findSubscriptionById(id) {
      return subs.get(id) ?? null;
    },
    async insertSubscription(row) {
      const inserted = makeSub({ ...row, id: `sub-${subs.size + 1}` });
      subs.set(inserted.id, inserted);
      activeSub.set(inserted.businessId, inserted.id);
      return inserted;
    },
    async updateSubscription(id, patch) {
      const existing = subs.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patch, updatedAt: new Date() };
      subs.set(id, updated);
      // If the patch changed the status away from active/past_due, clear the
      // active pointer (an upgrade cancels the old → the new takes the slot).
      if (patch.status && patch.status !== 'active' && patch.status !== 'past_due') {
        for (const [biz, sid] of activeSub) {
          if (sid === id) activeSub.delete(biz);
        }
      }
      return updated;
    },
    async findExpiring(now) {
      return [...subs.values()].filter(
        (s) => (s.status === 'active' || s.status === 'past_due') && s.currentPeriodEnd <= now,
      );
    },
    async insertInvoice(row) {
      repo.invoiceCounter += 1;
      const inserted = {
        ...row,
        id: `inv-${repo.invoiceCounter}`,
        createdAt: new Date(),
      } as InvoiceRow;
      invoices.set(inserted.id, inserted);
      return inserted;
    },
    async findInvoiceById(id) {
      return invoices.get(id) ?? null;
    },
    async findInvoiceByNumber(number) {
      return [...invoices.values()].find((i) => i.number === number) ?? null;
    },
    async listInvoices(businessId, opts) {
      const all = [...invoices.values()]
        .filter((i) => i.businessId === businessId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return {
        items: all.slice(opts.offset, opts.offset + opts.limit),
        total: all.length,
      };
    },
    async nextInvoiceNumber() {
      const year = new Date().getUTCFullYear();
      return `INV-${year}-${String(repo.invoiceCounter + 1).padStart(4, '0')}`;
    },
    async settleInvoice(invoiceId, paymentId, paymentStatus) {
      const existing = invoices.get(invoiceId);
      if (!existing) return null;
      const updated = { ...existing, paymentId, paymentStatus };
      invoices.set(invoiceId, updated);
      return updated;
    },
    async revenueAggregates() {
      // The fake has no payment rows; return an empty report. The
      // revenue-report logic is exercised against the real Drizzle repo in
      // the integration suite (B8.6 follow-up).
      return { byPurpose: [], byPlan: [], total: { count: 0, amount: 0 } };
    },
  };
  return repo;
}

function makeBody(overrides: Partial<UpsertSubscriptionBody> = {}): UpsertSubscriptionBody {
  return {
    planId: PLAN_STARTER,
    interval: 'monthly',
    ...overrides,
  };
}

describe('BillingService.listPlans + getSubscription (B8.2)', () => {
  it('lists the active plans in sort order', async () => {
    const repo = makeRepo([
      makePlan({ id: PLAN_STARTER, tier: 'starter', sortOrder: 1 }),
      makePlan({ id: 'p-free', tier: 'free', sortOrder: 0, priceMonthly: 0 }),
      makePlan({ id: PLAN_PRO, tier: 'pro', sortOrder: 2 }),
    ]);
    const svc = new BillingService(repo);
    const result = await svc.listPlans();
    expect(result.items).toHaveLength(3);
    expect(result.items[0]!.tier).toBe('free');
    expect(result.items[1]!.tier).toBe('starter');
    expect(result.items[2]!.tier).toBe('pro');
  });

  it('getSubscription returns the free-tier fallback when no active sub exists', async () => {
    const repo = makeRepo();
    const svc = new BillingService(repo);
    const result = await svc.getSubscription(BIZ);
    expect(result.subscription).toBeNull();
    expect(result.limits).toEqual(FREE_TIER_LIMITS);
  });

  it('getSubscription returns the active sub + the plan limits', async () => {
    const plan = makePlan({ id: PLAN_STARTER, tier: 'starter' });
    const sub = makeSub({ id: 'sub-1', businessId: BIZ, planId: PLAN_STARTER, planTier: 'starter', status: 'active' });
    const repo = makeRepo([plan], [sub]);
    const svc = new BillingService(repo);
    const result = await svc.getSubscription(BIZ);
    expect(result.subscription).not.toBeNull();
    expect(result.subscription!.planTier).toBe('starter');
    expect(result.limits.ads).toBe(true);
    expect(result.limits.adCampaigns).toBe(1);
  });
});

describe('BillingService.upsertSubscription (B8.2)', () => {
  it('creates a fresh subscription + drafts an invoice (pending)', async () => {
    const plan = makePlan({ id: PLAN_STARTER, priceMonthly: 49_000 });
    const repo = makeRepo([plan]);
    const svc = new BillingService(repo);
    const result = await svc.upsertSubscription(BIZ, makeBody());
    expect(result.subscription.planTier).toBe('starter');
    expect(result.subscription.status).toBe('pending_payment');
    expect(result.invoice.amount).toBe(49_000);
    expect(result.invoice.paymentStatus).toBe('pending');
    expect(result.payment.amount).toBe(49_000);
    expect(result.payment.purpose).toBe('subscription');
    expect(result.payment.purposeId).toBe(result.invoice.id);
  });

  it('cancels an existing active subscription on upgrade', async () => {
    const planStarter = makePlan({ id: PLAN_STARTER, tier: 'starter' });
    const planPro = makePlan({ id: PLAN_PRO, tier: 'pro', priceMonthly: 149_000 });
    const existingSub = makeSub({ id: 'sub-old', businessId: BIZ, planId: PLAN_STARTER, status: 'active' });
    const repo = makeRepo([planStarter, planPro], [existingSub]);
    const svc = new BillingService(repo);
    const result = await svc.upsertSubscription(BIZ, makeBody({ planId: PLAN_PRO }));
    expect(result.subscription.planTier).toBe('pro');
    expect(result.invoice.amount).toBe(149_000);
    // The old subscription was flipped to cancelled.
    const old = repo.subs.get('sub-old');
    expect(old?.status).toBe('cancelled');
    expect(old?.cancelledAt).not.toBeNull();
  });

  it('uses the yearly price on a yearly interval', async () => {
    const plan = makePlan({ id: PLAN_STARTER, priceYearly: 490_000 });
    const repo = makeRepo([plan]);
    const svc = new BillingService(repo);
    const result = await svc.upsertSubscription(BIZ, makeBody({ interval: 'yearly' }));
    expect(result.invoice.amount).toBe(490_000);
    expect(result.subscription.interval).toBe('yearly');
  });

  it('throws on a non-existent / inactive plan', async () => {
    const repo = makeRepo();
    const svc = new BillingService(repo);
    await expect(svc.upsertSubscription(BIZ, makeBody({ planId: 'missing' }))).rejects.toThrow();
  });

  it('cancelSubscription flips the active sub to cancelled + returns it', async () => {
    const plan = makePlan({ id: PLAN_STARTER });
    const sub = makeSub({ id: 'sub-1', businessId: BIZ, planId: PLAN_STARTER, status: 'active', autoRenew: true });
    const repo = makeRepo([plan], [sub]);
    const svc = new BillingService(repo);
    const result = await svc.cancelSubscription(BIZ);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('cancelled');
    expect(result!.autoRenew).toBe(false);
  });

  it('cancelSubscription returns null when no active sub exists', async () => {
    const repo = makeRepo();
    const svc = new BillingService(repo);
    const result = await svc.cancelSubscription(BIZ);
    expect(result).toBeNull();
  });
});

describe('BillingService.listInvoices + getInvoice (B8.2)', () => {
  it('lists invoices paginated', async () => {
    const plan = makePlan({ id: PLAN_STARTER });
    const repo = makeRepo([plan]);
    const svc = new BillingService(repo);
    // Create 3 invoices via upsert (each creates one invoice).
    await svc.upsertSubscription(BIZ, makeBody());
    await svc.upsertSubscription(BIZ, makeBody({ interval: 'yearly' }));
    // Cancel + re-subscribe to get a 3rd invoice.
    await svc.cancelSubscription(BIZ);
    await svc.upsertSubscription(BIZ, makeBody());
    const result = await svc.listInvoices(BIZ, 1, 10);
    expect(result.items).toHaveLength(3);
    expect(result.meta.total).toBe(3);
  });

  it('getInvoice 404s on a missing id', async () => {
    const repo = makeRepo();
    const svc = new BillingService(repo);
    await expect(svc.getInvoice('missing')).rejects.toThrow();
  });
});

describe('BillingService.onPaymentVerified (B8.2 — the settle hook)', () => {
  it('settles the invoice + activates the subscription', async () => {
    const plan = makePlan({ id: PLAN_STARTER });
    const repo = makeRepo([plan]);
    const svc = new BillingService(repo);
    const { invoice, subscription } = await svc.upsertSubscription(BIZ, makeBody());
    expect(subscription.status).toBe('pending_payment');
    const paymentId = 'pay-1';
    await svc.onPaymentVerified(paymentId, invoice.id);
    const settled = repo.invoices.get(invoice.id);
    expect(settled?.paymentId).toBe(paymentId);
    expect(settled?.paymentStatus).toBe('verified');
    const sub = repo.subs.get(subscription.id);
    expect(sub?.status).toBe('active');
  });

  it('is idempotent — re-settling a verified invoice is a no-op', async () => {
    const plan = makePlan({ id: PLAN_STARTER });
    const repo = makeRepo([plan]);
    const svc = new BillingService(repo);
    const { invoice } = await svc.upsertSubscription(BIZ, makeBody());
    await svc.onPaymentVerified('pay-1', invoice.id);
    await svc.onPaymentVerified('pay-2', invoice.id); // idempotent
    const settled = repo.invoices.get(invoice.id);
    expect(settled?.paymentId).toBe('pay-1'); // unchanged
  });

  it('no-ops when the purposeId is not an invoice (e.g. an ad campaign payment)', async () => {
    const repo = makeRepo();
    const svc = new BillingService(repo);
    await expect(svc.onPaymentVerified('pay-1', 'not-an-invoice')).resolves.toBeUndefined();
  });
});

describe('BillingService.expirePastDue (B8.2 — the expiry job)', () => {
  it('flips an expired-period active sub to expired', async () => {
    const plan = makePlan({ id: PLAN_STARTER });
    const past = new Date(Date.now() - 86_400_000); // 1 day ago
    const sub = makeSub({ id: 'sub-1', businessId: BIZ, currentPeriodEnd: past, status: 'active', autoRenew: false });
    const repo = makeRepo([plan], [sub]);
    const svc = new BillingService(repo);
    const count = await svc.expirePastDue();
    expect(count).toBe(1);
    expect(repo.subs.get('sub-1')?.status).toBe('expired');
  });

  it('leaves a still-active sub alone', async () => {
    const plan = makePlan({ id: PLAN_STARTER });
    const future = new Date(Date.now() + 86_400_000); // 1 day ahead
    const sub = makeSub({ id: 'sub-1', businessId: BIZ, currentPeriodEnd: future, status: 'active' });
    const repo = makeRepo([plan], [sub]);
    const svc = new BillingService(repo);
    const count = await svc.expirePastDue();
    expect(count).toBe(0);
    expect(repo.subs.get('sub-1')?.status).toBe('active');
  });
});
