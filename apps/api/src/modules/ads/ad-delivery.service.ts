import { Inject, Injectable } from '@nestjs/common';
import type { SearchHit } from '@app/contracts';
import { ADS_REPOSITORY, type AdsRepositoryLike, type AdCampaignRow } from './ads.repository.js';

/** Re-exported so the controller imports the row type from one place. */
export type { AdCampaignRow };

/**
 * AdDeliveryService (B8.4) — injects active sponsored campaigns into the
 * search/home/category results, and records the impression + click beacons.
 *
 * Sponsored hits render the «تبلیغ» (Sponsored) label — transparency, not
 * stealth. The hit's `isSponsored: true` + `sponsoredHeadline` carry the
 * signal; the web card renders the label when `isSponsored` is true.
 *
 * Injection shape (v1): the sponsored hits PREPEND to the natural results
 * (a `search_top` campaign buys the top slots). The total count stays the
 * natural count — sponsored hits are additive to the page, not to the total
 * (a business that buys placement doesn't inflate its natural ranking).
 *
 * The impression is recorded on injection (the card will render → it counts).
 * The click is recorded when the sponsored card is clicked (POST
 * /ads/campaigns/:id/click). Both debit the budget atomically via the
 * repository's `debitBudget` (a race never over-spends); the click also
 * auto-pauses the campaign when the budget hits 0.
 */
@Injectable()
export class AdDeliveryService {
  constructor(@Inject(ADS_REPOSITORY) private readonly repo: AdsRepositoryLike) {}

  /**
   * Inject up to `maxSlots` sponsored hits for a placement at the TOP of the
   * natural `items`. Records one impression per injected hit (the card will
   * render). Returns the merged list (sponsored first, then natural).
   *
   * Sponsored hits that can't be built (the business no longer exists, or the
   * impression debit failed — a race) are silently dropped; the natural
   * results are unaffected.
   */
  async injectSponsored(
    items: SearchHit[],
    placement: 'search_top' | 'home_slot' | 'category_top',
    opts: { maxSlots: number; today: string; resolveBusiness: (businessId: string) => Promise<SearchHit | null> },
  ): Promise<SearchHit[]> {
    if (opts.maxSlots <= 0) return items;
    const eligible = await this.repo.findEligibleForPlacement(placement, opts.today);
    if (eligible.length === 0) return items;
    // Deduplicate: a business already in the natural results is NOT duplicated
    // (its natural hit stays; the sponsored slot goes to the next campaign).
    const naturalIds = new Set(items.map((i) => i.id));
    const sponsored: SearchHit[] = [];
    for (const campaign of eligible) {
      if (sponsored.length >= opts.maxSlots) break;
      if (naturalIds.has(campaign.businessId)) continue;
      const hit = await opts.resolveBusiness(campaign.businessId);
      if (!hit) continue;
      // Record the impression (free in v1, but bumps the counter). A failure
      // (the campaign went inactive between the read + the debit) drops it.
      const ok = await this.recordImpression(campaign.id);
      if (!ok) continue;
      sponsored.push({
        ...hit,
        isSponsored: true,
        sponsoredHeadline: campaign.headline,
      });
    }
    if (sponsored.length === 0) return items;
    return [...sponsored, ...items];
  }

  /**
   * Record an impression (free in v1 — bumps the counter without debiting the
   * budget). Returns false when the campaign is not active (the eligibility
   * read raced with a pause/expiry).
   */
  async recordImpression(campaignId: string): Promise<boolean> {
    const row = await this.repo.findById(campaignId);
    if (!row || row.status !== 'active') return false;
    const updated = await this.repo.debitBudget(campaignId, 0, 'impressions');
    return updated !== null;
  }

  /**
   * Record a click — debits the CPC atomically + bumps the clicks counter +
   * auto-pauses when the budget hits 0. Returns false when the campaign is
   * not active / the budget can't cover the CPC (the race guard — the click
   * beacon's UI ignores the false silently).
   */
  async recordClick(campaignId: string): Promise<boolean> {
    const row = await this.repo.findById(campaignId);
    if (!row || row.status !== 'active') return false;
    const updated = await this.repo.debitBudget(campaignId, row.cpc, 'clicks');
    if (!updated) return false;
    if (updated.budgetRemaining <= 0) {
      await this.repo.update(campaignId, { status: 'paused' });
    }
    return true;
  }
}
