import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  AD_PLACEMENTS,
  type AdPlacement,
  type Campaign,
  type CampaignDailyRow,
  type CampaignStats,
  type CampaignStatsResult,
  type CampaignsResult,
  type CreateCampaignBody,
  type PaymentPurpose,
  type PaymentStatus,
  type CampaignStatus,
  type UpdateCampaignStatusBody,
} from '@app/contracts';
import {
  ADS_REPOSITORY,
  type AdsRepositoryLike,
  type AdCampaignRow,
} from './ads.repository.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** The impression cost (v1: zero — impressions are free, clicks cost the CPC). */
const IMPRESSION_COST = 0;

/**
 * AdsService (B8.3/B8.4) — campaign CRUD + the delivery pacing primitive.
 *
 * Campaign lifecycle: draft → pending_payment → active → paused → ended → archived.
 * The owner creates a `draft` campaign, the checkout flips it to
 * `pending_payment` (a payment intent is created with purpose='ads'),
 * `onPaymentVerified` flips it to `active` (the campaign is now eligible to
 * show). The owner can pause/resume/end/archive. The schedule + budget
 * remaining gate eligibility; the budget debit is atomic (a race never
 * over-spends).
 *
 * `recordImpression` + `recordClick` are the delivery primitives called by the
 * ad-injection path (B8.4 search/home/category). They debit the budget
 * atomically; a click costs the CPC, an impression is free (v1). When the
 * budget hits 0 the service auto-pauses the campaign.
 */
@Injectable()
export class AdsService {
  constructor(@Inject(ADS_REPOSITORY) private readonly repo: AdsRepositoryLike) {}

  // --- CRUD ---
  async create(body: CreateCampaignBody, ownerId: string): Promise<Campaign> {
    if (body.endsOn < body.startsOn) {
      throw new BadRequestException({ code: 'BAD_REQUEST', messageKey: 'errors.badRequest', message: 'endsOn must be on/after startsOn.' });
    }
    if (body.dailyCap > body.budgetTotal) {
      throw new BadRequestException({ code: 'BAD_REQUEST', messageKey: 'errors.badRequest', message: 'dailyCap cannot exceed budgetTotal.' });
    }
    const row = await this.repo.insert({
      businessId: body.businessId,
      name: body.name,
      placements: body.placements.join(','),
      budgetTotal: body.budgetTotal,
      budgetRemaining: body.budgetTotal,
      dailyCap: body.dailyCap,
      cpc: body.cpc,
      startsOn: body.startsOn,
      endsOn: body.endsOn,
      headline: body.headline ?? null,
      status: 'draft',
      paymentId: null,
      paymentStatus: null,
      impressions: 0,
      clicks: 0,
      // ownerId is not stored on the row (the business ownership check is the
      // gate) — kept on the body for the payment intent creation downstream.
    });
    void ownerId;
    return toCampaign(row);
  }

  async list(businessId: string, page: number, pageSize: number): Promise<CampaignsResult> {
    const limit = Math.min(pageSize || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const { items, total } = await this.repo.listByBusiness(businessId, {
      limit,
      offset: (page - 1) * limit,
    });
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return {
      items: items.map(toCampaign),
      meta: { page, pageSize: limit, total, totalPages },
    };
  }

  async getOne(campaignId: string): Promise<Campaign> {
    const row = await this.repo.findById(campaignId);
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', messageKey: 'errors.notFound' });
    return toCampaign(row);
  }

  async updateStatus(campaignId: string, body: UpdateCampaignStatusBody): Promise<Campaign> {
    const row = await this.repo.findById(campaignId);
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', messageKey: 'errors.notFound' });
    const updated = await this.repo.update(campaignId, { status: body.status });
    return toCampaign(updated ?? row);
  }

  // --- the checkout linkage ---
  /**
   * Prepare the payment intent for a draft campaign. Returns the payment
   * descriptor the controller passes to PaymentService.create (purpose='ads',
   * purposeId=campaignId, amount=budgetTotal). Flips the campaign to
   * `pending_payment`. Called by the F8.2 ad campaign checkout.
   */
  async preparePayment(campaignId: string): Promise<{
    amount: number;
    purpose: PaymentPurpose;
    purposeId: string;
    description: string;
  }> {
    const row = await this.repo.findById(campaignId);
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', messageKey: 'errors.notFound' });
    if (row.status !== 'draft' && row.status !== 'pending_payment') {
      throw new BadRequestException({ code: 'BAD_REQUEST', messageKey: 'errors.badRequest', message: 'Campaign is not in a payable state.' });
    }
    if (row.status === 'pending_payment') {
      // Already prepared — return the same descriptor (idempotent).
      return {
        amount: row.budgetTotal,
        purpose: 'ads',
        purposeId: row.id,
        description: `Ad campaign: ${row.name}`,
      };
    }
    await this.repo.update(campaignId, { status: 'pending_payment' });
    return {
      amount: row.budgetTotal,
      purpose: 'ads',
      purposeId: row.id,
      description: `Ad campaign: ${row.name}`,
    };
  }

  // --- the settle hook (called by PaymentService.onPaymentVerified) ---
  /**
   * Flip a campaign from `pending_payment` to `active` when its payment
   * verifies. Idempotent — re-activating an already-active campaign is a no-op.
   * Links the payment id + status to the campaign row (for the stats read).
   */
  async onPaymentVerified(campaignId: string, paymentId: string): Promise<void> {
    const row = await this.repo.findById(campaignId);
    if (!row) return; // not a campaign payment
    if (row.status === 'active') return; // idempotent
    if (row.status !== 'pending_payment') return; // not in a payable state
    await this.repo.update(campaignId, {
      status: 'active',
      paymentId,
      paymentStatus: 'verified' as PaymentStatus,
    });
  }

  // --- delivery (B8.4) ---
  /**
   * Record an impression on an active campaign. v1: impressions are free
   * (cost = 0); the budget is NOT debited. The counter still bumps so the
   * stats read shows the delivery. Returns false when the campaign is not
   * active / the budget is exhausted (the ad-injection path should not have
   * served it — a race between the eligibility read + the impression).
   */
  async recordImpression(campaignId: string): Promise<boolean> {
    return this.debit(campaignId, IMPRESSION_COST, 'impressions');
  }

  /**
   * Record a click on an active campaign. Debits the CPC from the budget;
   * when the budget hits 0 the campaign auto-pauses. Returns false when the
   * campaign is not active / the budget can't cover the CPC (a race — the
   * ad-injection path should skip this click).
   */
  async recordClick(campaignId: string): Promise<boolean> {
    const row = await this.repo.findById(campaignId);
    if (!row) return false;
    const ok = await this.debit(campaignId, row.cpc, 'clicks');
    if (ok) {
      // Auto-pause when the budget is exhausted (a follow-up job re-checks).
      const updated = await this.repo.findById(campaignId);
      if (updated && updated.budgetRemaining <= 0 && updated.status === 'active') {
        await this.repo.update(campaignId, { status: 'paused' });
      }
    }
    return ok;
  }

  /** The atomic budget debit (shared by impression + click). */
  private async debit(
    campaignId: string,
    cost: number,
    counter: 'impressions' | 'clicks',
  ): Promise<boolean> {
    const row = await this.repo.findById(campaignId);
    if (!row || row.status !== 'active') return false;
    if (cost === 0) {
      // Free impression — bump the counter without touching the budget.
      await this.repo.debitBudget(campaignId, 0, counter);
      return true;
    }
    const updated = await this.repo.debitBudget(campaignId, cost, counter);
    return updated !== null;
  }

  // --- stats (B8.3) ---
  async getStats(campaignId: string): Promise<CampaignStatsResult> {
    const row = await this.repo.findById(campaignId);
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', messageKey: 'errors.notFound' });
    const daily = await this.repo.findDailyStats(campaignId);
    const impressions = row.impressions;
    const clicks = row.clicks;
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const spent = row.budgetTotal - row.budgetRemaining;
    const stats: CampaignStats = {
      campaignId: row.id,
      impressions,
      clicks,
      ctr,
      spent,
      budgetRemaining: row.budgetRemaining,
      daysRun: this.daysBetween(row.startsOn, todayIso()),
      daysRemaining: Math.max(0, this.daysBetween(todayIso(), row.endsOn)),
    };
    return { stats, daily };
  }

  private daysBetween(fromIso: string, toIso: string): number {
    const from = new Date(`${fromIso}T00:00:00Z`);
    const to = new Date(`${toIso}T00:00:00Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
    return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function toCampaign(row: AdCampaignRow): Campaign {
  const placements = row.placements
    .split(',')
    .filter((p): p is AdPlacement => (AD_PLACEMENTS as readonly string[]).includes(p));
  return {
    id: row.id,
    businessId: row.businessId,
    name: row.name,
    placements,
    budgetTotal: row.budgetTotal,
    budgetRemaining: row.budgetRemaining,
    dailyCap: row.dailyCap,
    cpc: row.cpc,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    headline: row.headline,
    status: row.status as CampaignStatus,
    paymentId: row.paymentId,
    paymentStatus: row.paymentStatus as PaymentStatus | null,
    impressions: row.impressions,
    clicks: row.clicks,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type { CampaignDailyRow };
