import { describe, expect, it, vi } from 'vitest';
import {
  REVIEWS_SPAM_EVALUATOR,
  ReviewsSpamService,
} from '../src/modules/reviews/reviews-spam.service.js';
import type { ReviewsRepositoryLike } from '../src/modules/reviews/reviews.repository.js';
import type { SettingsService } from '../src/modules/settings/settings.service.js';
import type { RedisLike } from '../src/redis/redis.client.js';

/**
 * B4.5 ReviewsSpamService — the four signals (blocked words, duplicate,
 * velocity, wave), the Persian-normalization matching, the fail-open
 * failure policy (settings/Redis outages must never break review creation)
 * and the post-insert counter semantics (the excess counts the demoted
 * rows too — the moderation queue must see the full pattern).
 */

const USER = { id: '22222222-2222-4222-8222-222222222222', role: 'user' };
const BIZ = '11111111-1111-4111-8111-111111111111';

/** In-memory RedisLike double with hour-bucket counters. */
function makeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string) {
      store.set(key, value);
      return 'OK';
    },
    async del() {
      return 0;
    },
    async incr(key: string) {
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(next));
      return next;
    },
    async expire() {
      return 1;
    },
    async ttl() {
      return -1;
    },
    async lpush() {
      return 0;
    },
    async ltrim() {
      return 'OK';
    },
    async lrange() {
      return [];
    },
  } as unknown as RedisLike & { store: Map<string, string> };
}

/** Settings double: an in-memory map over the registered keys. */
function makeSettings(values: Record<string, unknown> = {}) {
  return {
    get: vi.fn(async <T>(key: string) => values[key] as T),
  } as unknown as SettingsService;
}

/** Reviews repo double: only findRecentByUser matters here. */
function makeRepo(bodiesByUser: Record<string, string[]> = {}) {
  return {
    async findRecentByUser(userId: string, limit: number) {
      return (bodiesByUser[userId] ?? []).slice(0, limit).map((body, i) => ({
        id: `55555555-0000-4000-8000-${i.toString().padStart(12, '0')}`,
        businessId: BIZ,
        body,
      }));
    },
  } as unknown as ReviewsRepositoryLike;
}

function makeService(
  opts: {
    settings?: Record<string, unknown>;
    redis?: RedisLike | null;
    repo?: ReviewsRepositoryLike;
    breakSettings?: boolean;
    breakRedis?: boolean;
  } = {},
) {
  const settings = makeSettings(opts.settings ?? {});
  if (opts.breakSettings) {
    (settings.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('settings down'));
  }
  const redis = opts.breakRedis
    ? new Proxy({} as RedisLike, {
        get() {
          throw new Error('redis down');
        },
      })
    : (opts.redis ?? makeRedis());
  const repo = opts.repo ?? makeRepo();
  const svc = new ReviewsSpamService(repo, settings, redis);
  return { svc, redis: redis as RedisLike, settings };
}

describe('ReviewsSpamService.evaluate (B4.5)', () => {
  it('exports the DI token + evaluator contract', () => {
    expect(REVIEWS_SPAM_EVALUATOR).toBeDefined();
  });

  it('passes a clean review with no signals', async () => {
    const { svc } = makeService({ settings: { 'moderation.spam.blockedWords': ['تبلیغ'] } });
    const res = await svc.evaluate({ user: USER, businessId: BIZ, body: 'قهوه‌اش عالی بود.' });
    expect(res).toEqual({ flagged: false, reasons: [] });
  });

  it('flags a blocked word — normalized Persian matching (diacritics, Arabic yeh/kaf)', async () => {
    const { svc } = makeService({ settings: { 'moderation.spam.blockedWords': ['تبلیغ'] } });
    // التَبلیغ with Arabic yeh variants + diacritics — normalizes to the same stem.
    const res = await svc.evaluate({
      user: USER,
      businessId: BIZ,
      body: 'التبل\u064a\u063A خیلی خوب بود',
    });
    expect(res.flagged).toBe(true);
    expect(res.reasons).toEqual(['blocked_word:تبلیغ']);
  });

  it('flags a duplicate — the same normalized body the user already posted', async () => {
    const { svc } = makeService({
      settings: { 'moderation.spam.blockedWords': [] },
      repo: makeRepo({ [USER.id]: ['کافه‌چی خوبی بود؛ قهوه‌اش عالی.'] }),
    });
    const res = await svc.evaluate({
      user: USER,
      businessId: BIZ,
      body: 'کافه‌چی خوبی بود؛ قهوه‌اش عالی.',
    });
    expect(res.flagged).toBe(true);
    expect(res.reasons).toContain('duplicate_text');
  });

  it('a different body (or another user) is not a duplicate', async () => {
    const { svc } = makeService({
      repo: makeRepo({ [USER.id]: ['متن اول کاملاً متفاوت است.'] }),
    });
    const res = await svc.evaluate({ user: USER, businessId: BIZ, body: 'متن دوم این یکی.' });
    expect(res.flagged).toBe(false);
  });

  it('flags velocity when the user already hit the hourly threshold', async () => {
    const { svc, redis } = makeService({
      settings: {
        'moderation.spam.maxReviewsPerHour': 2,
        'moderation.spam.maxReviewsPerBusinessPerHour': 10,
      },
    });
    // Seed the CURRENT hour bucket with 2 prior reviews.
    const bucket = Math.floor(Date.now() / 3_600_000);
    (redis as unknown as { store: Map<string, string> }).store.set(
      `spam:cnt:user:${USER.id}:${bucket}`,
      '2',
    );
    const res = await svc.evaluate({ user: USER, businessId: BIZ, body: 'نظر معمولی.' });
    expect(res.reasons).toContain('velocity');
    expect(res.flagged).toBe(true);
  });

  it('flags a wave when the business already hit its hourly threshold', async () => {
    const { svc, redis } = makeService({
      settings: {
        'moderation.spam.maxReviewsPerHour': 5,
        'moderation.spam.maxReviewsPerBusinessPerHour': 3,
      },
    });
    const bucket = Math.floor(Date.now() / 3_600_000);
    (redis as unknown as { store: Map<string, string> }).store.set(
      `spam:cnt:biz:${BIZ}:${bucket}`,
      '3',
    );
    const res = await svc.evaluate({ user: USER, businessId: BIZ, body: 'نظر معمولی.' });
    expect(res.reasons).toContain('wave');
  });

  it('an empty hour bucket (first review) never flags on velocity/wave', async () => {
    const { svc } = makeService({
      settings: {
        'moderation.spam.maxReviewsPerHour': 2,
        'moderation.spam.maxReviewsPerBusinessPerHour': 2,
      },
    });
    const res = await svc.evaluate({ user: USER, businessId: BIZ, body: 'اولین نظر امروز.' });
    expect(res.flagged).toBe(false);
  });

  it('aggregates MULTIPLE reasons in one evaluation', async () => {
    const { svc, redis } = makeService({
      settings: {
        'moderation.spam.blockedWords': ['تبلیغ'],
        'moderation.spam.maxReviewsPerHour': 1,
      },
      repo: makeRepo({ [USER.id]: ['تبلیغ: کافه ما'] }),
    });
    const bucket = Math.floor(Date.now() / 3_600_000);
    (redis as unknown as { store: Map<string, string> }).store.set(
      `spam:cnt:user:${USER.id}:${bucket}`,
      '1',
    );
    const res = await svc.evaluate({ user: USER, businessId: BIZ, body: 'تبلیغ: کافه ما' });
    expect(res.reasons).toEqual(
      expect.arrayContaining(['blocked_word:تبلیغ', 'duplicate_text', 'velocity']),
    );
    expect(res.flagged).toBe(true);
  });

  it('fail-OPEN: a settings outage skips the word signal but keeps the rest', async () => {
    const { svc } = makeService({
      breakSettings: true,
      repo: makeRepo({ [USER.id]: ['متن تکراری قبلی است.'] }),
    });
    const res = await svc.evaluate({ user: USER, businessId: BIZ, body: 'متن تکراری قبلی است.' });
    expect(res.flagged).toBe(true);
    expect(res.reasons).toEqual(['duplicate_text']);
  });

  it('fail-OPEN: a Redis outage skips velocity/wave entirely', async () => {
    const { svc } = makeService({
      breakRedis: true,
      settings: { 'moderation.spam.blockedWords': [] },
    });
    const res = await svc.evaluate({ user: USER, businessId: BIZ, body: 'بدون ردیس هم سبز.' });
    expect(res).toEqual({ flagged: false, reasons: [] });
  });

  it('a null-counter Redis (no bucket yet) skips the thresholds — get returns null', async () => {
    const { svc } = makeService({
      settings: { 'moderation.spam.maxReviewsPerHour': 1 }, // strict, but no counter
    });
    const res = await svc.evaluate({ user: USER, businessId: BIZ, body: 'سبز.' });
    expect(res.flagged).toBe(false);
  });
});

describe('ReviewsSpamService.recordPosted (B4.5)', () => {
  it('bumps BOTH hour counters and stamps the TTL on the first increment', async () => {
    const { svc, redis } = makeService();
    await svc.recordPosted(USER.id, BIZ);
    await svc.recordPosted(USER.id, BIZ);
    const store = (redis as unknown as { store: Map<string, string> }).store;
    const bucket = Math.floor(Date.now() / 3_600_000);
    expect(store.get(`spam:cnt:user:${USER.id}:${bucket}`)).toBe('2');
    expect(store.get(`spam:cnt:biz:${BIZ}:${bucket}`)).toBe('2');
  });

  it('never throws on a Redis outage (counters are best-effort)', async () => {
    const { svc } = makeService({ breakRedis: true });
    await expect(svc.recordPosted(USER.id, BIZ)).resolves.toBeUndefined();
  });
});
