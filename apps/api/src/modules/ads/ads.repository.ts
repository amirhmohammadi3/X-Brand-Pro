import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import {
  adCampaigns,
  type AdCampaignRow,
  type NewAdCampaignRow,
} from '../../db/schema/billing.js';
import type { AdPlacement, CampaignStatus, PaymentStatus } from '@app/contracts';

/** DI token for the ads repository (tests bind a fake). */
export const ADS_REPOSITORY = Symbol('ADS_REPOSITORY');

/**
 * The narrow fake-able surface for the ads domain: campaign CRUD, the
 * atomic budget debit (the pacing primitive), the impression/click counters,
 * and the delivery read (which campaigns are eligible to show right now).
 */
export interface AdsRepositoryLike {
  // --- campaign CRUD ---
  findById(id: string): Promise<AdCampaignRow | null>;
  listByBusiness(
    businessId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ items: AdCampaignRow[]; total: number }>;
  insert(row: NewAdCampaignRow): Promise<AdCampaignRow>;
  update(
    id: string,
    patch: Partial<{
      status: CampaignStatus;
      paymentId: string | null;
      paymentStatus: PaymentStatus | null;
      budgetRemaining: number;
    }>,
  ): Promise<AdCampaignRow | null>;

  // --- delivery (B8.4): which active campaigns are eligible right now? ---
  /**
   * Find active campaigns whose schedule covers `today` and whose placements
   * include `placement`. Used by the search/home/category ad injection.
   */
  findEligibleForPlacement(
    placement: AdPlacement,
    today: string,
  ): Promise<AdCampaignRow[]>;

  // --- pacing (B8.4): atomic budget debit ---
  /**
   * Atomically debit `cost` from the campaign's `budget_remaining` + bump the
   * `impressions`/`clicks` counter. Returns the updated row, or null when the
   * debit would overdraw the budget (the WHERE guard `budget_remaining >= cost`
   * rejects the UPDATE — a race never over-spends). The daily-cap enforcement
   * is the service's job (it reads today's spend before deciding to debit).
   */
  debitBudget(
    campaignId: string,
    cost: number,
    counter: 'impressions' | 'clicks',
  ): Promise<AdCampaignRow | null>;

  // --- stats (B8.3/B8.4): the per-day delivery breakdown ---
  /**
   * The daily spend rows for a campaign (one per campaign-day the ad ran).
   * The v1 schema stores only the aggregate counters on the campaign row; a
   * follow-up adds an `ad_campaign_daily` table for the per-day breakdown.
   * For now the stats API returns a synthesized single-row series.
   */
  findDailyStats(campaignId: string): Promise<Array<{ date: string; impressions: number; clicks: number; spent: number }>>;
}

@Injectable()
export class AdsRepository implements AdsRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async findById(id: string): Promise<AdCampaignRow | null> {
    const rows = await this.client.db
      .select()
      .from(adCampaigns)
      .where(eq(adCampaigns.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByBusiness(
    businessId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ items: AdCampaignRow[]; total: number }> {
    const items = await this.client.db
      .select()
      .from(adCampaigns)
      .where(eq(adCampaigns.businessId, businessId))
      .orderBy(desc(adCampaigns.createdAt))
      .limit(opts.limit)
      .offset(opts.offset);
    const countRows = await this.client.db
      .select({ count: adCampaigns.id })
      .from(adCampaigns)
      .where(eq(adCampaigns.businessId, businessId));
    return { items, total: countRows.length };
  }

  async insert(row: NewAdCampaignRow): Promise<AdCampaignRow> {
    const inserted = await this.client.db.insert(adCampaigns).values(row).returning();
    return inserted[0]!;
  }

  async update(
    id: string,
    patch: Partial<{
      status: CampaignStatus;
      paymentId: string | null;
      paymentStatus: PaymentStatus | null;
      budgetRemaining: number;
    }>,
  ): Promise<AdCampaignRow | null> {
    const updated = await this.client.db
      .update(adCampaigns)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(adCampaigns.id, id))
      .returning();
    return updated[0] ?? null;
  }

  async findEligibleForPlacement(
    placement: AdPlacement,
    today: string,
  ): Promise<AdCampaignRow[]> {
    // placements is a comma-separated string column; LIKE matches the placement
    // token (the ≤3-set is small enough that a substring match is unambiguous).
    return this.client.db
      .select()
      .from(adCampaigns)
      .where(
        and(
          eq(adCampaigns.status, 'active'),
          sql`${adCampaigns.placements} LIKE ${'%' + placement + '%'}`,
          lte(adCampaigns.startsOn, today),
          gte(adCampaigns.endsOn, today),
          sql`${adCampaigns.budgetRemaining} > 0`,
        ),
      )
      .orderBy(desc(adCampaigns.budgetRemaining))
      .limit(10);
  }

  async debitBudget(
    campaignId: string,
    cost: number,
    counter: 'impressions' | 'clicks',
  ): Promise<AdCampaignRow | null> {
    // Atomic: the WHERE guard `budget_remaining >= cost` rejects an overdraft.
    // A concurrent debit race never over-spends — the loser's UPDATE affects
    // 0 rows (returning → empty → null) and the service skips that impression.
    const updated = await this.client.db
      .update(adCampaigns)
      .set({
        budgetRemaining: sql`${adCampaigns.budgetRemaining} - ${cost}`,
        impressions:
          counter === 'impressions'
            ? sql`${adCampaigns.impressions} + 1`
            : adCampaigns.impressions,
        clicks:
          counter === 'clicks'
            ? sql`${adCampaigns.clicks} + 1`
            : adCampaigns.clicks,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(adCampaigns.id, campaignId),
          sql`${adCampaigns.budgetRemaining} >= ${cost}`,
        ),
      )
      .returning();
    return updated[0] ?? null;
  }

  async findDailyStats(
    campaignId: string,
  ): Promise<Array<{ date: string; impressions: number; clicks: number; spent: number }>> {
    // v1: the schema has no per-day table; return a synthesized single row
    // (the campaign's lifetime totals) until B8.4's follow-up adds the table.
    const rows = await this.client.db
      .select()
      .from(adCampaigns)
      .where(eq(adCampaigns.id, campaignId))
      .limit(1);
    const c = rows[0];
    if (!c) return [];
    const spent = c.budgetTotal - c.budgetRemaining;
    return [
      {
        date: todayIso(),
        impressions: c.impressions,
        clicks: c.clicks,
        spent,
      },
    ];
  }
}

/** Today's date as YYYY-MM-DD (UTC — the API resolves business-local at ingest). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export type { AdCampaignRow, NewAdCampaignRow };
