import { describe, expect, it } from 'vitest';
import { AdDeliveryService } from '../src/modules/ads/ad-delivery.service.js';
import type { AdsRepositoryLike, AdCampaignRow } from '../src/modules/ads/ads.repository.js';
import type { SearchHit } from '@app/contracts';

/**
 * B8.4 AdDeliveryService — DB-free unit tests. The sponsored-hit injection
 * (prepend to natural results, dedupe a business already in natural, drop on
 * impression-failure/impression-injection), the impression recording (free +
 * non-active false), and the click recording (debit CPC + auto-pause on
 * exhaustion + race-guard false + non-active false).
 */

const BIZ_A = '00000000-0000-4000-8000-0000000000a1';
const BIZ_B = '00000000-0000-4000-8000-0000000000b1';
const CAMP_1 = '00000000-0000-4000-8000-0000000000c1';

function makeCampaign(overrides: Partial<AdCampaignRow> = {}): AdCampaignRow {
  const now = new Date();
  return {
    id: CAMP_1,
    businessId: BIZ_B,
    name: 'Boost',
    placements: 'search_top,home_slot',
    budgetTotal: 500_000,
    budgetRemaining: 500_000,
    dailyCap: 50_000,
    cpc: 1_000,
    startsOn: '2026-11-01',
    endsOn: '2026-11-30',
    headline: 'Special offer!',
    status: 'active',
    paymentId: null,
    paymentStatus: null,
    impressions: 0,
    clicks: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeHit(businessId: string): SearchHit {
  return {
    id: businessId,
    slug: `biz-${businessId.slice(-4)}`,
    name: 'Business',
    nameAlt: null,
    primaryCategoryId: '00000000-0000-4000-8000-0000000000p1',
    primaryCategorySlug: 'cat',
    primaryCategoryName: { fa: 'دسته', en: 'Category' },
    cityId: '00000000-0000-4000-8000-0000000000c1',
    citySlug: 'tehran',
    cityName: { fa: 'تهران', en: 'Tehran' },
    neighborhoodId: null,
    address: 'addr',
    location: { lat: 35.7, lng: 51.4 },
    priceLevel: null,
    avgRating: 4.5,
    reviewCount: 10,
    coverUrl: null,
    thumbUrl: null,
    isFeatured: false,
    isSponsored: false,
    sponsoredHeadline: null,
    distance: null,
    rank: 0,
  };
}

type RepoStub = AdsRepositoryLike & {
  rows: Map<string, AdCampaignRow>;
  debits: Array<{ id: string; cost: number; counter: 'impressions' | 'clicks' }>;
};

function makeRepo(initial: AdCampaignRow[] = []): RepoStub {
  const rows = new Map<string, AdCampaignRow>();
  for (const c of initial) rows.set(c.id, c);
  const debits: RepoStub['debits'] = [];
  const repo: RepoStub = {
    rows,
    debits,
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async listByBusiness() {
      return { items: [], total: 0 };
    },
    async insert(row) {
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
      debits.push({ id: campaignId, cost, counter });
      const existing = rows.get(campaignId);
      if (!existing) return null;
      if (existing.budgetRemaining < cost) return null;
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
    async findDailyStats() {
      return [];
    },
  };
  return repo;
}

describe('AdDeliveryService.injectSponsored (B8.4)', () => {
  it('prepends a sponsored hit to the natural results', async () => {
    const campaign = makeCampaign({ id: CAMP_1, businessId: BIZ_B });
    const repo = makeRepo([campaign]);
    const svc = new AdDeliveryService(repo);
    const natural = [makeHit(BIZ_A)];
    const result = await svc.injectSponsored(natural, 'search_top', {
      maxSlots: 2,
      today: '2026-11-15',
      resolveBusiness: async (id) => makeHit(id),
    });
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe(BIZ_B);
    expect(result[0]!.isSponsored).toBe(true);
    expect(result[0]!.sponsoredHeadline).toBe('Special offer!');
    expect(result[1]!.id).toBe(BIZ_A);
    expect(result[1]!.isSponsored).toBe(false);
    // The impression was recorded (free, but the counter bumped).
    expect(repo.rows.get(CAMP_1)?.impressions).toBe(1);
  });

  it('does not duplicate a business already in the natural results', async () => {
    const campaign = makeCampaign({ id: CAMP_1, businessId: BIZ_A }); // same biz as the natural hit
    const repo = makeRepo([campaign]);
    const svc = new AdDeliveryService(repo);
    const natural = [makeHit(BIZ_A)];
    const result = await svc.injectSponsored(natural, 'search_top', {
      maxSlots: 2,
      today: '2026-11-15',
      resolveBusiness: async (id) => makeHit(id),
    });
    expect(result).toHaveLength(1); // not duplicated
    expect(result[0]!.isSponsored).toBe(false); // the natural hit stays
    // No impression recorded (the campaign was skipped).
    expect(repo.rows.get(CAMP_1)?.impressions).toBe(0);
  });

  it('respects the maxSlots cap', async () => {
    const repo = makeRepo([
      makeCampaign({ id: 'c1', businessId: BIZ_B }),
      makeCampaign({ id: 'c2', businessId: '00000000-0000-4000-8000-0000000000b2' }),
      makeCampaign({ id: 'c3', businessId: '00000000-0000-4000-8000-0000000000b3' }),
    ]);
    const svc = new AdDeliveryService(repo);
    const result = await svc.injectSponsored([], 'search_top', {
      maxSlots: 2,
      today: '2026-11-15',
      resolveBusiness: async (id) => makeHit(id),
    });
    expect(result).toHaveLength(2); // capped at 2
  });

  it('drops a sponsored hit when the business resolves to null', async () => {
    const campaign = makeCampaign({ id: CAMP_1, businessId: BIZ_B });
    const repo = makeRepo([campaign]);
    const svc = new AdDeliveryService(repo);
    const result = await svc.injectSponsored([], 'search_top', {
      maxSlots: 2,
      today: '2026-11-15',
      resolveBusiness: async () => null, // business gone
    });
    expect(result).toHaveLength(0);
  });

  it('returns the natural results unchanged when no eligible campaigns', async () => {
    const repo = makeRepo();
    const svc = new AdDeliveryService(repo);
    const natural = [makeHit(BIZ_A)];
    const result = await svc.injectSponsored(natural, 'search_top', {
      maxSlots: 2,
      today: '2026-11-15',
      resolveBusiness: async (id) => makeHit(id),
    });
    expect(result).toBe(natural);
  });

  it('returns the natural results unchanged when maxSlots is 0', async () => {
    const repo = makeRepo([makeCampaign()]);
    const svc = new AdDeliveryService(repo);
    const natural = [makeHit(BIZ_A)];
    const result = await svc.injectSponsored(natural, 'search_top', {
      maxSlots: 0,
      today: '2026-11-15',
      resolveBusiness: async (id) => makeHit(id),
    });
    expect(result).toBe(natural);
  });
});

describe('AdDeliveryService.recordImpression (B8.4)', () => {
  it('bumps the impression counter on an active campaign', async () => {
    const repo = makeRepo([makeCampaign({ id: CAMP_1, status: 'active' })]);
    const svc = new AdDeliveryService(repo);
    const ok = await svc.recordImpression(CAMP_1);
    expect(ok).toBe(true);
    expect(repo.rows.get(CAMP_1)?.impressions).toBe(1);
    expect(repo.rows.get(CAMP_1)?.budgetRemaining).toBe(500_000); // free
  });

  it('returns false on a non-active campaign', async () => {
    const repo = makeRepo([makeCampaign({ id: CAMP_1, status: 'paused' })]);
    const svc = new AdDeliveryService(repo);
    const ok = await svc.recordImpression(CAMP_1);
    expect(ok).toBe(false);
    expect(repo.rows.get(CAMP_1)?.impressions).toBe(0);
  });
});

describe('AdDeliveryService.recordClick (B8.4)', () => {
  it('debits the CPC + bumps the clicks counter', async () => {
    const repo = makeRepo([makeCampaign({ id: CAMP_1, status: 'active', cpc: 1_000, budgetRemaining: 500_000 })]);
    const svc = new AdDeliveryService(repo);
    const ok = await svc.recordClick(CAMP_1);
    expect(ok).toBe(true);
    expect(repo.rows.get(CAMP_1)?.clicks).toBe(1);
    expect(repo.rows.get(CAMP_1)?.budgetRemaining).toBe(499_000);
  });

  it('auto-pauses when the budget hits 0', async () => {
    const repo = makeRepo([makeCampaign({ id: CAMP_1, status: 'active', cpc: 500, budgetRemaining: 500 })]);
    const svc = new AdDeliveryService(repo);
    const ok = await svc.recordClick(CAMP_1);
    expect(ok).toBe(true);
    expect(repo.rows.get(CAMP_1)?.budgetRemaining).toBe(0);
    expect(repo.rows.get(CAMP_1)?.status).toBe('paused');
  });

  it('returns false when the budget can not cover the CPC (race guard)', async () => {
    const repo = makeRepo([makeCampaign({ id: CAMP_1, status: 'active', cpc: 1_000, budgetRemaining: 500 })]);
    const svc = new AdDeliveryService(repo);
    const ok = await svc.recordClick(CAMP_1);
    expect(ok).toBe(false);
    expect(repo.rows.get(CAMP_1)?.clicks).toBe(0);
    expect(repo.rows.get(CAMP_1)?.budgetRemaining).toBe(500);
    expect(repo.rows.get(CAMP_1)?.status).toBe('active'); // not paused
  });

  it('returns false on a non-active campaign', async () => {
    const repo = makeRepo([makeCampaign({ id: CAMP_1, status: 'ended' })]);
    const svc = new AdDeliveryService(repo);
    const ok = await svc.recordClick(CAMP_1);
    expect(ok).toBe(false);
  });
});
