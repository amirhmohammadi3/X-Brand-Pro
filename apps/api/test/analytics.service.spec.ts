import { describe, expect, it } from 'vitest';
import {
  AnalyticsService,
  addDaysIso,
  todayIso,
} from '../src/modules/analytics/analytics.service.js';
import type {
  AnalyticsRepositoryLike,
  BufferedEvent,
} from '../src/modules/analytics/analytics.repository.js';

/**
 * B7.1/B7.2 AnalyticsService — DB-free. The privacy promise (aggregate-only
 * ingest: no identity in the payload, the ip exists only inside the salted
 * hour-bucket hash), the one-view-per-visitor-hour dedup, the fail-soft
 * buffer push, the flush slicing (read → insert → trim), the idempotent
 * rollup and the owner-gated stats with defaults and totals.
 */

const BIZ = '00000000-0000-0000-0000-0000000000c1';
const OWNER = '00000000-0000-0000-0000-0000000000o1';
const SECRET = 'test-otp-hmac-secret-0123456789abcdef';

type RepoStub = AnalyticsRepositoryLike & {
  buffer: string[];
  dedupKeys: string[];
  dedupResult: boolean;
  pushed: boolean;
  flushInserts: number;
  flushResult: number;
  rollupBuckets: number;
  pruned: string | null;
  statsRows: Array<{ date: string; type: string; count: number }>;
};

function makeRepo(): RepoStub {
  const repo: RepoStub = {
    buffer: [],
    dedupKeys: [],
    dedupResult: true,
    pushed: true,
    flushInserts: 0,
    flushResult: 0,
    rollupBuckets: 0,
    pruned: null,
    statsRows: [],
    async bufferPush(events: BufferedEvent[]) {
      if (!repo.pushed) throw new Error('redis down');
      for (const event of events) repo.buffer.push(JSON.stringify(event));
    },
    async bufferLength() {
      return repo.buffer.length;
    },
    async flushBatch(batch: number) {
      if (repo.buffer.length === 0) return 0;
      const take = Math.min(batch, repo.buffer.length);
      repo.buffer.splice(0, take);
      repo.flushInserts += take;
      return repo.flushResult || take;
    },
    async claimDedup(key: string) {
      if (repo.dedupKeys.includes(key)) return false;
      repo.dedupKeys.push(key);
      return repo.dedupResult;
    },
    async rollupRange() {
      return repo.rollupBuckets;
    },
    async pruneRaw(olderThan: string) {
      repo.pruned = olderThan;
      return 0;
    },
    async statsRange() {
      return repo.statsRows;
    },
  } as unknown as RepoStub;
  return repo;
}

function makeService(repo: AnalyticsRepositoryLike) {
  return new AnalyticsService(repo, businessesRepo(), { otpHmacSecret: SECRET } as never);
}

function businessesRepo() {
  return {
    findById(id: string) {
      if (id === BIZ) {
        return Promise.resolve({
          id: BIZ,
          ownerId: OWNER,
          status: 'active',
          deletedAt: null,
          slug: 'cafe',
          name: 'کافه',
        });
      }
      return Promise.resolve(null);
    },
  } as never;
}

describe('ingest — B7.1', () => {
  it('buffers accepted events with the server-stamped instant and local date', async () => {
    const repo = makeRepo();
    const service = makeService(repo);
    const accepted = await service.ingest(
      {
        events: [
          { businessId: BIZ, type: 'call_click' },
          { businessId: BIZ, type: 'business_view' },
        ],
      },
      '1.2.3.4',
    );
    expect(accepted).toBe(2);
    expect(repo.buffer).toHaveLength(2);
    // LPUSH puts the newest at head — index 0 is the LAST ingested event.
    const head = JSON.parse(repo.buffer[0] as string) as BufferedEvent;
    const tail = JSON.parse(repo.buffer[1] as string) as BufferedEvent;
    expect(head.type).toBe('call_click');
    expect(tail.type).toBe('business_view');
    expect(tail.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(tail.occurredAt).toBeTruthy();
  });

  it('dedups one business_view per (ip, business) hour bucket', async () => {
    const repo = makeRepo();
    const service = makeService(repo);
    const first = await service.ingest(
      { events: [{ businessId: BIZ, type: 'business_view' }] },
      '1.2.3.4',
    );
    const second = await service.ingest(
      { events: [{ businessId: BIZ, type: 'business_view' }] },
      '1.2.3.4',
    );
    expect(first).toBe(1);
    expect(second).toBe(0); // the same hour-bucket is a repeat view
    expect(repo.buffer).toHaveLength(1);
  });

  it('click events are never deduped (each tap counts)', async () => {
    const repo = makeRepo();
    const service = makeService(repo);
    const body = { events: [{ businessId: BIZ, type: 'call_click' as const }] };
    const first = await service.ingest(body, '1.2.3.4');
    const second = await service.ingest(body, '1.2.3.4');
    expect(first).toBe(1);
    expect(second).toBe(1);
  });

  it('fails soft when Redis is down (accepted 0, no throw)', async () => {
    const repo = makeRepo();
    repo.pushed = false;
    const service = makeService(repo);
    const accepted = await service.ingest(
      { events: [{ businessId: BIZ, type: 'impression' }] },
      '1.2.3.4',
    );
    expect(accepted).toBe(0);
  });
});

describe('flush + rollup — B7.1/B7.2', () => {
  it('flush drains slices until the buffer is empty', async () => {
    const repo = makeRepo();
    const service = makeService(repo);
    await service.ingest(
      {
        events: Array.from({ length: 7 }, () => ({
          businessId: BIZ,
          type: 'call_click' as const,
        })),
      },
      null,
    );
    expect(repo.buffer).toHaveLength(7);
    const landed = await service.flush();
    expect(landed).toBe(7);
    expect(repo.buffer).toHaveLength(0);
    expect(await service.flush()).toBe(0);
  });

  it('rollup aggregates into buckets and prunes past retention', async () => {
    const repo = makeRepo();
    repo.rollupBuckets = 12;
    const service = makeService(repo);
    const buckets = await service.rollup();
    expect(buckets).toBe(12);
    expect(repo.pruned).toBe(addDaysIso(todayIso(), -90));
  });
});

describe('stats — B7.2', () => {
  it('answers to the owner with series + totals, defaults to 30 days', async () => {
    const repo = makeRepo();
    repo.statsRows = [
      { date: '2026-11-10', type: 'business_view', count: 5 },
      { date: '2026-11-10', type: 'call_click', count: 2 },
    ];
    const service = makeService(repo);
    const result = await service.stats(BIZ, { id: OWNER, role: 'user' }, {});
    expect(result.businessId).toBe(BIZ);
    expect(result.series).toHaveLength(2);
    expect(result.totals.business_view).toBe(5);
    expect(result.totals.call_click).toBe(2);
    expect(result.totals.impression).toBe(0);
    expect(result.to).toBe(todayIso());
    expect(result.from).toBe(addDaysIso(todayIso(), -29));
  });

  it('honors the explicit range', async () => {
    const repo = makeRepo();
    const service = makeService(repo);
    const result = await service.stats(
      BIZ,
      { id: OWNER, role: 'user' },
      { from: '2026-01-01', to: '2026-01-31' },
    );
    expect(result.from).toBe('2026-01-01');
    expect(result.to).toBe('2026-01-31');
  });

  it('404 for a missing business, 403 for a stranger, 422 for an inverted range', async () => {
    const service = makeService(makeRepo());
    await expect(
      service.stats('00000000-0000-0000-0000-000000000099', { id: OWNER, role: 'user' }, {}),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.stats(BIZ, { id: '00000000-0000-0000-0000-000000000099', role: 'user' }, {}),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.stats(BIZ, { id: OWNER, role: 'user' }, { from: '2026-02-01', to: '2026-01-01' }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
