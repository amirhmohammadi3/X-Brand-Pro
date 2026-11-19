import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AiCompletionRequest,
  AiFraudScore,
  AiFraudScoreQueueItem,
  AiFraudScoreQueueQuery,
  AiFraudScoreQueueResult,
  AiFraudScoreRegenerateResult,
} from '@app/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SettingsService } from '../settings/settings.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CacheService } from '../../redis/cache.service.js';
import {
  AI_FRAUD_SCORES_REPOSITORY,
  type AiFraudScoresRepositoryLike,
} from './ai-fraud-scores.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AiService } from './ai.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ReviewsService } from '../reviews/reviews.service.js';
import type { AiFraudScoreRow } from '../../db/schema/ai-fraud-scores.js';

const DEFAULT_QUEUE_PAGE_SIZE = 20;
const MAX_QUEUE_PAGE_SIZE = 100;
const DEFAULT_MIN_SCORE = 0.5;

/**
 * FraudScoreService (A9.6) — orchestrates the AI fraud/toxicity score for a
 * review. Three entry points:
 *
 *  - `getScore(reviewId)` — the moderator reads the current score (null on
 *    the very first read while the job runs). On stale/missing, enqueues a
 *    regenerate (debounced 60s, fire-and-forget).
 *
 *  - `listQueue(query)` — the moderation queue: scores >= minScore, sorted
 *    by score DESC. Returns the joined review + business + user rows.
 *
 *  - `regenerate(reviewId)` — admin forces a regenerate (bypasses the
 *    debounce).
 *
 *  - `onReviewChanged(reviewId)` — the subscriber hook on review.created /
 *    review.updated. Marks stale (or enqueues an initial generate).
 *
 *  - `generateForReview(reviewId)` — the actual generation logic, called by
 *    the queue worker. Reads the review body, calls
 *    AiService.complete({feature:'fraud_toxicity'}), parses the JSON score,
 *    upserts the row. Always succeeds — on AI failure, stores the error
 *    code + keeps the previous score (or 0 on the very first read).
 */
@Injectable()
export class FraudScoreService {
  private readonly logger = new Logger(FraudScoreService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly cache: CacheService,
    @Inject(AI_FRAUD_SCORES_REPOSITORY)
    private readonly scoresRepo: AiFraudScoresRepositoryLike,
    private readonly ai: AiService,
    private readonly reviews: ReviewsService,
  ) {}

  /** The moderator reads the current score (null on the very first read). */
  async getScore(reviewId: string): Promise<AiFraudScore | null> {
    const row = await this.scoresRepo.findByReviewId(reviewId);
    if (!row) {
      // No score yet — enqueue an initial generate.
      void this.generateForReview(reviewId).catch((err) =>
        this.logger.error(
          `failed to enqueue initial fraud score for ${reviewId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return null;
    }

    const score = toWire(row);
    const currentVersion = await this.settings.get<number>('ai.prompts.fraudToxicity.version');
    if (row.promptVersion !== currentVersion) {
      await this.scoresRepo.markStale(reviewId, new Date());
      score.stale = true;
      void this.generateForReview(reviewId).catch((err) =>
        this.logger.error(
          `failed to enqueue prompt-version fraud regenerate for ${reviewId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    } else if (row.stale) {
      void this.generateForReview(reviewId).catch((err) =>
        this.logger.error(
          `failed to enqueue stale fraud regenerate for ${reviewId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
    return score;
  }

  /** The moderation queue: scores >= minScore, sorted DESC. */
  async listQueue(query: AiFraudScoreQueueQuery): Promise<AiFraudScoreQueueResult> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? DEFAULT_QUEUE_PAGE_SIZE, MAX_QUEUE_PAGE_SIZE);
    const minScore = query.minScore ?? DEFAULT_MIN_SCORE;
    const offset = (page - 1) * pageSize;
    const { rows, total } = await this.scoresRepo.listQueue(minScore, pageSize, offset);
    return {
      items: rows.map(toQueueItem),
      page,
      pageSize,
      total,
    };
  }

  /** Admin forces a regenerate. */
  async regenerate(reviewId: string): Promise<AiFraudScoreRegenerateResult> {
    void this.generateForReview(reviewId).catch((err) =>
      this.logger.error(
        `failed to regenerate fraud score for ${reviewId}: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    return { enqueued: true, jobId: null };
  }

  /** The subscriber hook on review.created / review.updated. */
  async onReviewChanged(reviewId: string): Promise<void> {
    const row = await this.scoresRepo.findByReviewId(reviewId);
    if (!row) {
      // No score yet — enqueue an initial generate.
      void this.generateForReview(reviewId).catch((err) =>
        this.logger.error(
          `failed to enqueue initial fraud score for ${reviewId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return;
    }
    try {
      await this.scoresRepo.markStale(reviewId, new Date());
    } catch (err) {
      this.logger.error(
        `failed to mark fraud score stale for ${reviewId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** The actual generation logic. Always succeeds (stores the error on failure). */
  async generateForReview(reviewId: string): Promise<AiFraudScore | null> {
    const [systemPrompt, promptVersion] = await Promise.all([
      this.settings.get<string>('ai.prompts.fraudToxicity.system'),
      this.settings.get<number>('ai.prompts.fraudToxicity.version'),
    ]);

    // Read the review body via the reviews service (so we don't duplicate
    // the access logic).
    const review = await this.reviews.findByIdForAi(reviewId);
    if (!review) {
      this.logger.warn(`review ${reviewId} not found; skipping fraud score`);
      return null;
    }

    const req: AiCompletionRequest = {
      feature: 'fraud_toxicity',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: review.body },
      ],
      maxTokens: 100,
      temperature: 0.1,
    };

    const result = await this.ai.complete(req);

    let score: number;
    let signals: string | null;
    if (result.ok && result.text) {
      // The LLM driver returns JSON `{"score": 0.0, "signals": [...]}`;
      // the rule driver returns the same JSON shape. Parse defensively.
      const parsed = parseScoreJson(result.text);
      score = parsed.score;
      signals = parsed.signals;
    } else {
      // On AI failure, default to 0 (benign) so the review stays visible.
      score = 0;
      signals = null;
    }

    const updated = await this.scoresRepo.upsert({
      reviewId,
      score,
      driver: result.driver,
      model: result.model,
      promptVersion,
      signals,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      lastError: result.ok ? null : (result.errorCode ?? 'unknown'),
    });

    return toWire(updated);
  }
}

/** Convert a DB row to the wire type. */
function toWire(row: AiFraudScoreRow): AiFraudScore {
  return {
    reviewId: row.reviewId,
    score: row.score,
    driver: row.driver as AiFraudScore['driver'],
    model: row.model,
    promptVersion: row.promptVersion,
    stale: row.stale,
    signals: row.signals,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Convert a queue row to the wire type. */
function toQueueItem(row: {
  reviewId: string;
  businessId: string;
  businessName: string;
  userId: string;
  userUsername: string;
  rating: number;
  body: string;
  reviewStatus: string;
  score: number;
  signals: string | null;
  scoreUpdatedAt: Date;
  reviewCreatedAt: Date;
}): AiFraudScoreQueueItem {
  return {
    reviewId: row.reviewId,
    businessId: row.businessId,
    businessName: row.businessName,
    userId: row.userId,
    userUsername: row.userUsername,
    rating: row.rating,
    body: row.body,
    reviewStatus: row.reviewStatus as AiFraudScoreQueueItem['reviewStatus'],
    score: row.score,
    signals: row.signals,
    scoreUpdatedAt: row.scoreUpdatedAt.toISOString(),
    reviewCreatedAt: row.reviewCreatedAt.toISOString(),
  };
}

/**
 * Parse a JSON `{"score": 0.0, "signals": [...]}` response defensively.
 * Returns `{ score: 0, signals: null }` on any parse error (fail-safe — a
 * malformed response defaults to benign).
 */
function parseScoreJson(text: string): { score: number; signals: string | null } {
  try {
    // The LLM may wrap the JSON in markdown fences or extra text; extract
    // the first {...} block.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { score: 0, signals: null };
    const parsed = JSON.parse(match[0]) as { score?: unknown; signals?: unknown };
    const scoreNum = typeof parsed.score === 'number' ? parsed.score : Number(parsed.score);
    if (!Number.isFinite(scoreNum) || scoreNum < 0 || scoreNum > 1) {
      return { score: 0, signals: null };
    }
    const signalsArr = Array.isArray(parsed.signals)
      ? parsed.signals.filter((s): s is string => typeof s === 'string')
      : [];
    const signalsStr = signalsArr.length > 0 ? signalsArr.join(',') : null;
    return { score: scoreNum, signals: signalsStr };
  } catch {
    return { score: 0, signals: null };
  }
}
