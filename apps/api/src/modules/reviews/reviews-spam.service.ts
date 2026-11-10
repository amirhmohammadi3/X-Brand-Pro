import { Inject, Injectable, Optional } from '@nestjs/common';
import { normalizePersianText } from '@app/contracts';
// Value import: Nest reads SettingsService's type at runtime via
// emitDecoratorMetadata (constructor DI) — type-only would break injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SettingsService } from '../settings/settings.service.js';
// Value import: the REDIS token is read at runtime by @Inject below.
 
import { REDIS, type RedisLike } from '../../redis/redis.client.js';
import { REVIEWS_REPOSITORY, type ReviewsRepositoryLike } from './reviews.repository.js';
import type { BusinessActor } from '../business/business-access.js';

/**
 * B4.5 — the automatic spam/fraud filter. FOUR signals, any hit demotes the
 * review to `pending` (the B4.4 moderation queue takes it from there):
 *
 * 1. BLOCKED WORDS — `moderation.spam.blockedWords` (admin-managed settings
 *    key), matched against the NORMALIZED body (normalizePersianText, B3.1:
 *    Arabic yeh/kaf folded, diacritics stripped, digits + ZWNJ unified), so
 *    «تبلیغ» catches «التبليغ», «تَبلیغ» and every spelling variant.
 * 2. DUPLICATE — the same normalized body the user already posted (any
 *    business): copy-paste blasts are the classic review fraud.
 * 3. VELOCITY — more than `moderation.spam.maxReviewsPerHour` reviews by
 *    this user inside the current hour bucket (Redis INCR counters).
 * 4. WAVE — more than `moderation.spam.maxReviewsPerBusinessPerHour`
 *    reviews for ONE business inside the current hour bucket (coordinated
 *    waves, the same counter scheme with a business key).
 *
 * FAILURE POLICY: every external read (settings, Redis) is fail-OPEN — a
 * settings DB hiccup or a downed Redis must never break review creation;
 * the filter just skips that signal. The WORD + DUPLICATE checks never
 * touch Redis at all. Counters increment AFTER a successful insert (flagged
 * or not — the moderation queue must see the full pattern, and the excess
 * count includes demoted rows).
 */

/** The narrow fake-able surface ReviewsService consumes. */
export const REVIEWS_SPAM_EVALUATOR = Symbol('REVIEWS_SPAM_EVALUATOR');

export interface SpamEvaluation {
  flagged: boolean;
  reasons: string[];
}

export interface ReviewsSpamEvaluator {
  evaluate(input: {
    user: BusinessActor;
    businessId: string;
    body: string;
  }): Promise<SpamEvaluation>;
  /** Post-insert counter bump — never throws (see recordPosted). */
  recordPosted(userId: string, businessId: string): Promise<void>;
}

/** Hour-bucket keys — INCR'd after insert, TTL'd 2h (one bucket + slack). */
function hourBucketKey(scope: 'user' | 'biz', id: string, now: number): string {
  return `spam:cnt:${scope}:${id}:${Math.floor(now / 3_600_000)}`;
}

@Injectable()
export class ReviewsSpamService implements ReviewsSpamEvaluator {
  /** A user's recent reviews scanned for duplicates (bounded — see the repo). */
  private static readonly DUPLICATE_SCAN_LIMIT = 50;
  private static readonly COUNTER_TTL_SEC = 7_200;

  constructor(
    @Inject(REVIEWS_REPOSITORY) private readonly repo: ReviewsRepositoryLike,
    private readonly settings: SettingsService,
    @Optional() @Inject(REDIS) private readonly redis?: RedisLike,
  ) {}

  async evaluate(input: {
    user: BusinessActor;
    businessId: string;
    body: string;
  }): Promise<SpamEvaluation> {
    const reasons: string[] = [];
    const normalized = normalizePersianText(input.body).toLowerCase();

    // 1. Blocked words — the admin-managed list, fail-open on settings errors.
    try {
      const words = await this.settings.get<string[]>('moderation.spam.blockedWords');
      const hit = (Array.isArray(words) ? words : []).find((word) => {
        const w = normalizePersianText(word).toLowerCase();
        return w.length > 0 && normalized.includes(w);
      });
      if (hit) reasons.push(`blocked_word:${hit}`);
    } catch {
      // settings unavailable → skip the word signal (fail-open)
    }

    // 2. Duplicate — same normalized body the user already posted anywhere.
    try {
      const recent = await this.repo.findRecentByUser(
        input.user.id,
        ReviewsSpamService.DUPLICATE_SCAN_LIMIT,
      );
      const duplicate = recent.some(
        (r) => normalizePersianText(r.body).toLowerCase() === normalized,
      );
      if (duplicate) reasons.push('duplicate_text');
    } catch {
      // repo unavailable → skip the duplicate signal (fail-open)
    }

    if (this.redis) {
      const now = Date.now();
      // 3. Velocity — the user's count in the CURRENT hour bucket.
      // 4. Wave — the business's count in the same bucket.
      try {
        const [userCount, bizCount] = await Promise.all([
          this.redis.get(hourBucketKey('user', input.user.id, now)),
          this.redis.get(hourBucketKey('biz', input.businessId, now)),
        ]);
        if (userCount !== null) {
          const max = await this.settings.get<number>('moderation.spam.maxReviewsPerHour');
          if (typeof max === 'number' && Number(userCount) >= max) reasons.push('velocity');
        }
        if (bizCount !== null) {
          const max = await this.settings.get<number>(
            'moderation.spam.maxReviewsPerBusinessPerHour',
          );
          if (typeof max === 'number' && Number(bizCount) >= max) reasons.push('wave');
        }
      } catch {
        // Redis or the thresholds unavailable → skip the velocity signals
      }
    }

    return { flagged: reasons.length > 0, reasons };
  }

  /**
   * Post-insert counter bump (ReviewsService calls this AFTER a successful
   * create, flagged or not). Fire-and-forget semantics for the CALLER: the
   * service awaits internally but never throws — a Redis outage must not
   * fail a review that was already written.
   */
  async recordPosted(userId: string, businessId: string): Promise<void> {
    if (!this.redis) return;
    const now = Date.now();
    for (const key of [hourBucketKey('user', userId, now), hourBucketKey('biz', businessId, now)]) {
      try {
        const next = await this.redis.incr(key);
        if (next === 1) {
          await this.redis.expire(key, ReviewsSpamService.COUNTER_TTL_SEC, 'NX');
        }
      } catch {
        return; // counters are best-effort abuse signals, never a failure
      }
    }
  }
}
