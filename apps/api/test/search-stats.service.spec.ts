import { describe, expect, it, vi } from 'vitest';
import { SearchStatsService, HISTORY_LIMIT } from '../src/modules/search/search-stats.service.js';
import { NotFoundException } from '@nestjs/common';
import type { SearchRecordInput } from '@app/contracts';

/**
 * B3.5 search-stats service — the pieces testable without a live Postgres:
 * the query canonicalisation (Arabic variants collapse, empty no-op), the
 * record flow (popularity for everyone, history only for authenticated
 * users, prune called with HISTORY_LIMIT), the history/popular mapping
 * (Date → ISO string, cityName null coalescing) and the 404 on a foreign or
 * unknown history id. The repository SQL (NULLS NOT DISTINCT upserts, the
 * prune DELETE ... NOT IN, the popular ordering) is integration-tested
 * against Docker per the Follow-up.
 */
function makeRepo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    upsertPopular: vi.fn(async () => undefined),
    upsertHistory: vi.fn(async () => undefined),
    pruneHistory: vi.fn(async () => undefined),
    listHistory: vi.fn(async () => []),
    clearHistory: vi.fn(async () => 0),
    removeHistoryItem: vi.fn(async () => false),
    listPopular: vi.fn(async () => []),
    ...overrides,
  };
}

function makeService(repo: ReturnType<typeof makeRepo>) {
  return new SearchStatsService(repo as never);
}

const baseRecord: SearchRecordInput = {
  userId: null,
  text: 'کافه',
  cityId: null,
  resultCount: 3,
};

describe('SearchStatsService.record (B3.5)', () => {
  it('bumps popularity for anonymous searchers and skips history', async () => {
    const repo = makeRepo();
    const svc = makeService(repo);
    await svc.record({ ...baseRecord, userId: null });
    expect(repo.upsertPopular).toHaveBeenCalledTimes(1);
    expect(repo.upsertHistory).not.toHaveBeenCalled();
    expect(repo.pruneHistory).not.toHaveBeenCalled();
  });

  it('upserts history and prunes for authenticated searchers', async () => {
    const repo = makeRepo();
    const svc = makeService(repo);
    await svc.record({ ...baseRecord, userId: '11111111-1111-1111-1111-111111111111' });
    expect(repo.upsertHistory).toHaveBeenCalledTimes(1);
    expect(repo.pruneHistory).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      HISTORY_LIMIT,
    );
    expect(HISTORY_LIMIT).toBe(20);
  });

  it('normalizes Arabic spellings into the canonical row key', async () => {
    const repo = makeRepo();
    const svc = makeService(repo);
    // Arabic kaf+yeh + Persian digits — must land on the same normalized key
    // as the Persian-spelled, ASCII-digit form.
    await svc.record({ ...baseRecord, text: 'كافه رحيمي ۲' });
    await svc.record({ ...baseRecord, text: 'کافه رحیمی 2' });
    const first = repo.upsertPopular.mock.calls[0][0] as { normalizedText: string };
    const second = repo.upsertPopular.mock.calls[1][0] as { normalizedText: string };
    expect(first.normalizedText).toBe(second.normalizedText);
    expect(first.normalizedText).toContain('کافه');
    // display text keeps the caller's (trimmed) spelling
    expect((repo.upsertPopular.mock.calls[0][0] as { text: string }).text).toBe('كافه رحيمي ۲');
  });

  it('no-ops on empty/whitespace-only text without touching the repo', async () => {
    const repo = makeRepo();
    const svc = makeService(repo);
    await svc.record({ ...baseRecord, text: '   ' });
    expect(repo.upsertPopular).not.toHaveBeenCalled();
    expect(repo.upsertHistory).not.toHaveBeenCalled();
  });

  it('passes resultCount and cityId through to the popularity upsert', async () => {
    const repo = makeRepo();
    const svc = makeService(repo);
    await svc.record({
      ...baseRecord,
      cityId: '22222222-2222-2222-2222-222222222222',
      resultCount: 42,
    });
    expect(repo.upsertPopular).toHaveBeenCalledWith({
      normalizedText: expect.stringContaining('کافه'),
      text: 'کافه',
      cityId: '22222222-2222-2222-2222-222222222222',
      resultCount: 42,
    });
  });
});

describe('SearchStatsService.history / popular mapping (B3.5)', () => {
  it('maps history rows: Date → ISO, cityName null coalesced', async () => {
    const searchedAt = new Date('2026-11-09T10:00:00Z');
    const repo = makeRepo({
      listHistory: vi.fn(async () => [
        {
          id: '33333333-3333-3333-3333-333333333333',
          text: 'کافه',
          cityId: null,
          cityName: null,
          searchedAt,
        },
        {
          id: '44444444-4444-4444-4444-444444444444',
          text: 'رستوران',
          cityId: '22222222-2222-2222-2222-222222222222',
          cityName: { fa: 'تهران', en: 'Tehran' },
          searchedAt,
        },
      ]),
    });
    const svc = makeService(repo);
    const res = await svc.history('11111111-1111-1111-1111-111111111111', { limit: 10 });
    expect(res.items).toHaveLength(2);
    expect(res.items[0]).toEqual({
      id: '33333333-3333-3333-3333-333333333333',
      text: 'کافه',
      cityId: null,
      cityName: null,
      searchedAt: '2026-11-09T10:00:00.000Z',
    });
    expect(res.items[1]?.cityName).toEqual({ fa: 'تهران', en: 'Tehran' });
    expect(repo.listHistory).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111', 10);
  });

  it('maps popular rows with hits and the ISO timestamp', async () => {
    const repo = makeRepo({
      listPopular: vi.fn(async () => [
        {
          text: 'کافه',
          cityId: null,
          cityName: null,
          hits: 128,
          lastSearchedAt: new Date('2026-11-09T12:30:00Z'),
        },
      ]),
    });
    const svc = makeService(repo);
    const res = await svc.popular({ limit: 10 });
    expect(res.items[0]).toEqual({
      text: 'کافه',
      cityId: null,
      cityName: null,
      hits: 128,
      lastSearchedAt: '2026-11-09T12:30:00.000Z',
    });
    expect(repo.listPopular).toHaveBeenCalledWith(undefined, 10);
  });

  it('passes the cityId scope to the popular list', async () => {
    const repo = makeRepo();
    const svc = makeService(repo);
    await svc.popular({ cityId: '22222222-2222-2222-2222-222222222222', limit: 5 });
    expect(repo.listPopular).toHaveBeenCalledWith('22222222-2222-2222-2222-222222222222', 5);
  });
});

describe('SearchStatsService.clear / remove (B3.5)', () => {
  it('clear returns the deleted count from the repository', async () => {
    const repo = makeRepo({ clearHistory: vi.fn(async () => 7) });
    const svc = makeService(repo);
    expect(await svc.clear('11111111-1111-1111-1111-111111111111')).toEqual({ deleted: 7 });
  });

  it('remove resolves {deleted:1} when the row is owned by the user', async () => {
    const repo = makeRepo({ removeHistoryItem: vi.fn(async () => true) });
    const svc = makeService(repo);
    expect(
      await svc.remove(
        '11111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333333',
      ),
    ).toEqual({ deleted: 1 });
  });

  it('remove throws 404 NOT_FOUND for an unknown or foreign id', async () => {
    const repo = makeRepo({ removeHistoryItem: vi.fn(async () => false) });
    const svc = makeService(repo);
    await expect(
      svc.remove('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333'),
    ).rejects.toSatisfy((e: unknown) => {
      const err = e as { status?: number; response?: { code?: string } };
      return err instanceof NotFoundException && err.status === 404;
    });
  });
});
