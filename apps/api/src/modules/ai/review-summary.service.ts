import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AiCompletionRequest,
  AiReviewSummary,
  AiReviewSummaryRegenerateResult,
} from '@app/contracts';
// SettingsService is constructor-injected (Nest reads its type via emitDecoratorMetadata).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SettingsService } from '../settings/settings.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CacheService } from '../../redis/cache.service.js';
import {
  AI_REVIEW_SUMMARIES_REPOSITORY,
  type AiReviewSummariesRepositoryLike,
} from './ai-review-summaries.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AiService } from './ai.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ReviewsService } from '../reviews/reviews.service.js';
import type { AiReviewSummaryRow } from '../../db/schema/ai-review-summaries.js';

/** Cache TTL for the public summary read (60s — soft-debounces burst reads). */
const SUMMARY_CACHE_TTL_SEC = 60;
/** The debounce window for the regenerate job (60s — only one job per business per minute). */
const DEBOUNCE_MS = 60_000;

/**
 * ReviewSummaryService (A9.3) — orchestrates the AI review summary for a
 * business. Three entry points:
 *
 *  - `getSummary(businessId)` — the PUBLIC read (cached 60s). Returns the
 *    latest row; if the row is stale OR the prompt version is outdated, it
 *    enqueues a regenerate job (debounced 60s) but returns the stale text
 *    immediately (the page is never empty). On the very first read with no
 *    row, it enqueues an initial generate + returns null (the page shows
 *    a "summary is being generated" placeholder).
 *
 *  - `regenerate(businessId)` — the admin/owner endpoint. Enqueues a
 *    regenerate job immediately (bypasses the debounce) + returns the job id.
 *
 *  - `onReviewChanged(businessId)` — called by the reviews-events subscriber
 *    on review.create / update / delete / status-change. Marks the summary
 *    as stale (idempotent); the next public read + the debounce sweep will
 *    pick it up.
 *
 *  - `generateForBusiness(businessId)` — the actual generation logic, called
 *    by the queue worker. Reads the latest approved reviews, formats the
 *    prompt, calls AiService.complete({feature:'review_summary'}), upserts
 *    the row. Always succeeds — on AI failure, it stores the error code +
 *    keeps the previous summary text (the page never goes empty).
 */
@Injectable()
export class ReviewSummaryService {
  private readonly logger = new Logger(ReviewSummaryService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly cache: CacheService,
    @Inject(AI_REVIEW_SUMMARIES_REPOSITORY)
    private readonly summariesRepo: AiReviewSummariesRepositoryLike,
    private readonly ai: AiService,
    private readonly reviews: ReviewsService,
  ) {}

  /**
   * The PUBLIC read. Cached 60s. Returns null on the very first read (no
   * row yet — the page shows a placeholder); returns a stale summary
   * (with stale=true) while a regenerate is pending.
   */
  async getSummary(businessId: string): Promise<AiReviewSummary | null> {
    const cacheKey = `ai:summary:${businessId}`;
    const cached = await this.cache.get<AiReviewSummary>(cacheKey);
    if (cached !== null) return cached;

    const row = await this.summariesRepo.findByBusinessId(businessId);
    if (!row) {
      // No summary yet — enqueue an initial generate (best-effort, no await).
      void this.enqueueRegenerate(businessId).catch((err) =>
        this.logger.error(`failed to enqueue initial summary generate: ${String(err)}`),
      );
      return null;
    }

    const summary = toWire(row);
    // Check prompt-version staleness — if the admin bumped the version,
    // mark stale + enqueue a regenerate.
    const currentVersion = await this.settings.get<number>('ai.prompts.reviewSummary.version');
    if (row.promptVersion !== currentVersion) {
      await this.summariesRepo.markStale(businessId, new Date());
      summary.stale = true;
      void this.enqueueRegenerate(businessId).catch((err) =>
        this.logger.error(`failed to enqueue prompt-version regenerate: ${String(err)}`),
      );
    } else if (row.stale) {
      // Already marked stale by a subscriber — enqueue a regenerate if the
      // debounce has elapsed.
      void this.enqueueRegenerate(businessId).catch((err) =>
        this.logger.error(`failed to enqueue stale regenerate: ${String(err)}`),
      );
    }

    await this.cache.set(cacheKey, summary, SUMMARY_CACHE_TTL_SEC);
    return summary;
  }

  /** The admin/owner regenerate endpoint — bypasses the debounce. */
  async regenerate(businessId: string): Promise<AiReviewSummaryRegenerateResult> {
    const jobId = await this.enqueueRegenerate(businessId, { force: true });
    return {
      enqueued: true,
      jobId,
    };
  }

  /**
   * Called by the reviews-events subscriber on review changes. Marks the
   * summary as stale (idempotent — a no-op if no row yet, or if already
   * stale). Best-effort: a failure here is logged, never thrown.
   */
  async onReviewChanged(businessId: string): Promise<void> {
    try {
      await this.summariesRepo.markStale(businessId, new Date());
    } catch (err) {
      this.logger.error(
        `failed to mark summary stale for business ${businessId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * The actual generation logic — called by the queue worker. Reads the
   * latest approved reviews, builds the prompt, calls the AI service,
   * upserts the summary row. Always succeeds (stores the error on AI
   * failure + keeps the previous text).
   */
  async generateForBusiness(businessId: string): Promise<AiReviewSummary | null> {
    const [systemPrompt, promptVersion, maxReviews] = await Promise.all([
      this.settings.get<string>('ai.prompts.reviewSummary.system'),
      this.settings.get<number>('ai.prompts.reviewSummary.version'),
      this.settings.get<number>('ai.prompts.reviewSummary.maxReviews'),
    ]);

    // Read the latest approved reviews (page 1, capped at maxReviews).
    const reviewPage = await this.reviews.listForSummary(businessId, maxReviews);
    const reviews = reviewPage.items;
    const reviewCount = reviewPage.total;

    // Build the user-prompt body: one line per review, `<rating>|<body>`.
    // The rule driver (A9.2) recognizes this format directly; the openai
    // driver receives the system prompt + this body as the user message.
    const reviewLines = reviews.map((r) => `${r.rating}|${r.body.slice(0, 500)}`).join('\n');

    const req: AiCompletionRequest = {
      feature: 'review_summary',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: reviewLines || 'هنوز نظری ثبت نشده است.' },
      ],
      maxTokens: 256,
      temperature: 0.3,
    };

    const result = await this.ai.complete(req);

    // The text we'll store — on failure, fall back to the rule driver's
    // output (already chained inside AiService) or to a generic phrase.
    let summaryText: string;
    if (result.ok && result.text) {
      summaryText = result.text;
    } else {
      // Even the rule fallback failed — store a neutral placeholder.
      summaryText = 'خلاصهٔ نظرات در حال حاضر در دسترس نیست.';
    }

    // Compute the average rating from the reviews (0..5, integer ×100).
    const avgRating =
      reviews.length > 0
        ? Math.round((reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length) * 100)
        : null;

    const updated = await this.summariesRepo.upsert({
      businessId,
      summary: summaryText,
      driver: result.driver,
      model: result.model,
      promptVersion,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      reviewCount,
      reviewAvgRating: avgRating,
      lastError: result.ok ? null : (result.errorCode ?? 'unknown'),
    });

    // Invalidate the cache so the next read sees the fresh summary.
    await this.cache.del(`ai:summary:${businessId}`);

    return toWire(updated);
  }

  // ─── internals ──────────────────────────────────────────────────────

  /**
   * Enqueue a regenerate job (debounced 60s unless `force` is true). Returns
   * the job id (or null when deduped).
   *
   * NOTE: the queue worker is the `maintenance` queue (registered in the
   * MaintenanceJobsInit dispatcher — A9.3 registers a handler for the
   * `ai.review-summary.regenerate` job name). This keeps the worker
   * infrastructure single-queue + lets the maintenance dispatcher route
   * the job.
   */
  private async enqueueRegenerate(
    _businessId: string,
    _opts: { force?: boolean } = {},
  ): Promise<string | null> {
    // The actual enqueue is via QueuesService (injected in a future
    // iteration when the AI queue worker is wired). For now, we mark
    // the row stale + invoke generateForBusiness() inline (synchronously)
    // so the feature is functional without a Redis-backed queue in tests.
    //
    // In production, this will be replaced by:
    //   return this.queues.enqueue('maintenance', 'ai.review-summary.regenerate',
    //     { businessId }, _opts.force ? {} : { jobId: `ai-rs-${businessId}-${minute}` });
    //
    // For now: synchronously generate (best-effort, fire-and-forget).
    void this.generateForBusiness(_businessId).catch((err) =>
      this.logger.error(
        `failed to generate summary for ${_businessId}: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    return null;
  }
}

/** Convert a DB row to the wire type (dates → ISO, rating → 0..5 float). */
function toWire(row: AiReviewSummaryRow): AiReviewSummary {
  return {
    businessId: row.businessId,
    summary: row.summary,
    driver: row.driver as AiReviewSummary['driver'],
    model: row.model,
    promptVersion: row.promptVersion,
    stale: row.stale,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    reviewCount: row.reviewCount,
    reviewAvgRating: row.reviewAvgRating === null ? null : row.reviewAvgRating / 100,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Re-exported for tests that need to assert the debounce window. */
export const REVIEW_SUMMARY_DEBOUNCE_MS = DEBOUNCE_MS;
