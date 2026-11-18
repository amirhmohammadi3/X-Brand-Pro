import { describe, expect, it } from 'vitest';
import { AdsService } from '../src/modules/ads/ads.service.js';
import type { AdsRepositoryLike } from '../src/modules/ads/ads.repository.js';
import type { AdCampaignRow, NewAdCampaignRow } from '../src/modules/ads/ads.repository.js';
import type { CreateCampaignBody } from '@app/contracts';

/**
 * B8.3 AdsService — DB-free unit tests. Campaign create + validation, the
 * checkout flow (draft → pending_payment → active via onPaymentVerified),
 * the delivery pacing primitives (recordImpression is free, recordClick
 * debits the CPC + auto-pauses on budget exhaustion), and the stats read.
 */

const BIZ = '00000000-0000-4000-8000-0000000000b1';
const USER = '00000000-0000-4000-8000-0000000000u1';
const CAMP = '00000000-0000-4000-8000-0000000000c1';

type RepoStub = AdsRepositoryLike & {
  rows: Map<string, AdCampaignRow>;
  debits: number;
};

function makeCampaign(overrides: Partial<AdCampaignRow> = {}): AdCampaignRow {
  const now = new Date();
  return {
    id: CAMP,
    businessId: BIZ,
    name: 'Summer boost',
    placements: 'search_top,home_slot',
    budgetTotal: 500_000,
    budgetRemaining: 500_000,
    dailyCap: 50_000,
    cpc: 1_000,
    startsOn: '2026-11-01',
    endsOn: '2026-11-30',
    headline: null,
    status: 'draft',
    paymentId: null,
    paymentStatus: null,
    impressions: 0,
    clicks: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRepo(initial: AdCampaignRow[] = []): RepoStub {
  const rows = new Map<string, AdCampaignRow>();
  for (const c of initial) rows.set(c.id, c);
  const repo: RepoStub = {
    rows,
    debits: 0,
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async listByBusiness(businessId, opts) {
      const all = [...rows.values()]
        .filter((c) => c.businessId === businessId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return {
        items: all.slice(opts.offset, opts.offset + opts.limit),
        total: all.length,
      };
    },
    async insert(row: NewAdCampaignRow) {
      const inserted = makeCampaign({ ...row, id: `camp-${rows.size + 1}` });
      rows.set(inserted.id, inserted);
      return inserted;
    },
    async update(id, patch) {
      const existing = rows.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patch, updatedAt: new Date() };
      rows.set(id, updated);
      return updated;
    },
    async findEligibleForPlacement(placement, today) {
      return [...rows.values()].filter(
        (c) =>
          c.status === 'active' &&
          c.placements.includes(placement) &&
          c.startsOn <= today &&
          c.endsOn >= today &&
          c.budgetRemaining > 0,
      );
    },
    async debitBudget(campaignId, cost, counter) {
      repo.debits += 1;
      const existing = rows.get(campaignId);
      if (!existing) return null;
      if (existing.budgetRemaining < cost) return null; // overdraw guard
      const updated = {
        ...existing,
        budgetRemaining: existing.budgetRemaining - cost,
        impressions: counter === 'impressions' ? existing.impressions + 1 : existing.impressions,
        clicks: counter === 'clicks' ? existing.clicks + 1 : existing.clicks,
        updatedAt: new Date(),
      };
      rows.set(campaignId, updated);
      return updated;
    },
    async findDailyStats(campaignId) {
      const c = rows.get(campaignId);
      if (!c) return [];
      return [
        {
          date: new Date().toISOString().slice(0, 10),
          impressions: c.impressions,
          clicks: c.clicks,
          spent: c.budgetTotal - c.budgetRemaining,
        },
      ];
    },
  };
  return repo;
}

function makeBody(overrides: Partial<CreateCampaignBody> = {}): CreateCampaignBody {
  return {
    businessId: BIZ,
    name: 'Summer boost',
    placements: ['search_top', 'home_slot'],
    budgetTotal: 500_000,
    dailyCap: 50_000,
    cpc: 1_000,
    startsOn: '2026-11-01',
    endsOn: '2026-11-30',
    ...overrides,
  };
}

describe('AdsService.create (B8.3)', () => {
  it('creates a draft campaign with the full budget remaining', async () => {
    const repo = makeRepo();
    const svc = new AdsService(repo);
    const campaign = await svc.create(makeBody(), USER);
    expect(campaign.status).toBe('draft');
    expect(campaign.budgetRemaining).toBe(500_000);
    expect(campaign.placements).toEqual(['search_top', 'home_slot']);
    expect(campaign.impressions).toBe(0);
    expect(campaign.clicks).toBe(0);
  });

  it('throws when endsOn precedes startsOn', async () => {
    const repo = makeRepo();
    const svc = new AdsService(repo);
    await expect(
      svc.create(makeBody({ startsOn: '2026-11-30', endsOn: '2026-11-01' }), USER),
    ).rejects.toThrow();
  });

  it('throws when dailyCap exceeds budgetTotal', async () => {
    const repo = makeRepo();
    const svc = new AdsService(repo);
    await expect(
      svc.create(makeBody({ budgetTotal: 10_000, dailyCap: 50_000 }), USER),
    ).rejects.toThrow();
  });

  it('stores the optional headline', async () => {
    const repo = makeRepo();
    const svc = new AdsService(repo);
    const campaign = await svc.create(makeBody({ headline: 'Special offer!' }), USER);
    expect(campaign.headline).toBe('Special offer!');
  });
});

describe('AdsService.list + getOne (B8.3)', () => {
  it('lists the business campaigns paginated', async () => {
    const repo = makeRepo([makeCampaign({ id: 'c1', businessId: BIZ }), makeCampaign({ id: 'c2', businessId: BIZ })]);
    const svc = new AdsService(repo);
    const result = await svc.list(BIZ, 1, 10);
    expect(result.items).toHaveLength(2);
    expect(result.meta.total).toBe(2);
  });

  it('getOne 404s on a missing id', async () => {
    const repo = makeRepo();
    const svc = new AdsService(repo);
    await expect(svc.getOne('missing')).rejects.toThrow();
  });
});

describe('AdsService.updateStatus (B8.3)', () => {
  it('pauses an active campaign', async () => {
    const repo = makeRepo([makeCampaign({ id: CAMP, status: 'active' })]);
    const svc = new AdsService(repo);
    const result = await svc.updateStatus(CAMP, { status: 'paused' });
    expect(result.status).toBe('paused');
  });

  it('404s on a missing campaign', async () => {
    const repo = makeRepo();
    const svc = new AdsService(repo);
    await expect(svc.updateStatus('missing', { status: 'paused' })).rejects.toThrow();
  });
});

describe('AdsService.preparePayment + onPaymentVerified (B8.3 checkout)', () => {
  it('preparePayment flips draft → pending_payment + returns the descriptor', async () => {
    const repo = makeRepo([makeCampaign({ id: CAMP, status: 'draft' })]);
    const svc = new AdsService(repo);
    const result = await svc.preparePayment(CAMP);
    expect(result.amount).toBe(500_000);
    expect(result.purpose).toBe('ads');
    expect(result.purposeId).toBe(CAMP);
    expect(repo.rows.get(CAMP)?.status).toBe('pending_payment');
  });

  it('preparePayment is idempotent on pending_payment', async () => {
    const repo = makeRepo([makeCampaign({ id: CAMP, status: 'pending_payment' })]);
    const svc = new AdsService(repo);
    const result = await svc.preparePayment(CAMP);
    expect(result.amount).toBe(500_000);
    expect(repo.rows.get(CAMP)?.status).toBe('pending_payment');
  });

  it('preparePayment throws on an active campaign (not payable)', async () => {
    const repo = makeRepo([makeCampaign({ id: CAMP, status: 'active' })]);
    const svc = new AdsService(repo);
    await expect(svc.preparePayment(CAMP)).rejects.toThrow();
  });

  it('onPaymentVerified flips pending_payment → active + links the payment', async () => {
    const repo = makeRepo([makeCampaign({ id: CAMP, status: 'pending_payment' })]);
    const svc = new AdsService(repo);
    await svc.onPaymentVerified(CAMP, 'pay-1');
    const c = repo.rows.get(CAMP);
    expect(c?.status).toBe('active');
    expect(c?.paymentId).toBe('pay-1');
    expect(c?.paymentStatus).toBe('verified');
  });

  it('onPaymentVerified is idempotent (active stays active)', async () => {
    const repo = makeRepo([makeCampaign({ id: CAMP, status: 'active', paymentId: 'first' })]);
    const svc = new AdsService(repo);
    await svc.onPaymentVerified(CAMP, 'second');
    expect(repo.rows.get(CAMP)?.paymentId).toBe('first'); // unchanged
  });

  it('onPaymentVerified no-ops on a non-campaign id', async () => {
    const repo = makeRepo();
    const svc = new AdsService(repo);
    await expect(svc.onPaymentVerified('missing', 'pay-1')).resolves.toBeUndefined();
  });
});

describe('AdsService.recordImpression + recordClick (B8.4 delivery)', () => {
  it('recordImpression bumps the counter without debiting the budget (free)', async () => {
    const repo = makeRepo([makeCampaign({ id: CAMP, status: 'active', budgetRemaining: 500_000 })]);
    const svc = new AdsService(repo);
    const ok = await svc.recordImpression(CAMP);
    expect(ok).toBe(true);
    const c = repo.rows.get(CAMP);
    expect(c?.impressions).toBe(1);
    expect(c?.budgetRemaining).toBe(500_000); // unchanged
  });

  it('recordClick debits the CPC + bumps the clicks counter', async () => {
    const repo = makeRepo([makeCampaign({ id: CAMP, status: 'active', cpc: 1_000, budgetRemaining: 500_000 })]);
    const svc = new AdsService(repo);
    const ok = await svc.recordClick(CAMP);
    expect(ok).toBe(true);
    const c = repo.rows.get(CAMP);
    expect(c?.clicks).toBe(1);
    expect(c?.budgetRemaining).toBe(499_000);
  });

  it('recordClick auto-pauses when the budget is exhausted', async () => {
    const repo = makeRepo([
      makeCampaign({ id: CAMP, status: 'active', cpc: 500, budgetRemaining: 500 }),
    ]);
    const svc = new AdsService(repo);
    const ok = await svc.recordClick(CAMP);
    expect(ok).toBe(true);
    const c = repo.rows.get(CAMP);
    expect(c?.budgetRemaining).toBe(0);
    expect(c?.status).toBe('paused');
  });

  it('recordClick returns false when the budget can not cover the CPC (race guard)', async () => {
    const repo = makeRepo([
      makeCampaign({ id: CAMP, status: 'active', cpc: 1_000, budgetRemaining: 500 }),
    ]);
    const svc = new AdsService(repo);
    const ok = await svc.recordClick(CAMP);
    expect(ok).toBe(false);
    const c = repo.rows.get(CAMP);
    expect(c?.clicks).toBe(0); // the debit was rejected
    expect(c?.budgetRemaining).toBe(500); // unchanged
    expect(c?.status).toBe('active'); // not paused (no debit happened)
  });

  it('recordImpression returns false on a non-active campaign', async () => {
    const repo = makeRepo([makeCampaign({ id: CAMP, status: 'paused' })]);
    const svc = new AdsService(repo);
    const ok = await svc.recordImpression(CAMP);
    expect(ok).toBe(false);
  });

  it('recordClick returns false on a non-active campaign', async () => {
    const repo = makeRepo([makeCampaign({ id: CAMP, status: 'ended' })]);
    const svc = new AdsService(repo);
    const ok = await svc.recordClick(CAMP);
    expect(ok).toBe(false);
  });
});

describe('AdsService.getStats (B8.3)', () => {
  it('computes the CTR + spent + days from the campaign row', async () => {
    const repo = makeRepo([
      makeCampaign({
        id: CAMP,
        status: 'active',
        impressions: 100,
        clicks: 5,
        budgetTotal: 500_000,
        budgetRemaining: 495_000,
        startsOn: new Date().toISOString().slice(0, 10),
        endsOn: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
      }),
    ]);
    const svc = new AdsService(repo);
    const result = await svc.getStats(CAMP);
    expect(result.stats.impressions).toBe(100);
    expect(result.stats.clicks).toBe(5);
    expect(result.stats.ctr).toBeCloseTo(0.05, 5);
    expect(result.stats.spent).toBe(5_000);
    expect(result.stats.budgetRemaining).toBe(495_000);
    expect(result.stats.daysRun).toBe(0); // today
    expect(result.stats.daysRemaining).toBe(7);
  });

  it('404s on a missing campaign', async () => {
    const repo = makeRepo();
    const svc = new AdsService(repo);
    await expect(svc.getStats('missing')).rejects.toThrow();
  });
});
