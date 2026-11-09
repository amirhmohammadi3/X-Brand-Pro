import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { SESSIONS_REPOSITORY } from '../src/modules/auth/session.repository.js';
import { USERS_REPOSITORY } from '../src/modules/users/users.service.js';
import { REDIS } from '../src/redis/redis.client.js';
import { QUEUES_SERVICE } from '../src/queue/queue.module.js';
import { SearchStatsRepository } from '../src/modules/search/search-stats.repository.js';
import { SearchService } from '../src/modules/search/search.service.js';
import { FakeRedis } from './fake-redis.js';
import {
  createUser,
  loginAs,
  makeMemorySessionRepo,
  makeMemoryUserRepo,
  type LoginSession,
} from './auth.utils.js';

/**
 * HTTP-level search-stats tests (B3.5) WITHOUT live services: Redis is
 * FakeRedis, the user/session repositories are in-memory fakes, the
 * SearchStatsRepository is an in-memory fake (the real SQL needs
 * Postgres+PostGIS — Docker follow-up). The SearchService is overridden with
 * a canned result so the recording flow (controller → stats.record) is
 * exercised end-to-end on the real search route: popularity for everyone,
 * history only when a valid access token rides along.
 *
 * The real controllers, guards (RateLimit → JwtAuth → CsrfOrigin → Roles),
 * envelope and exception filter all run for real here.
 */
let app: INestApplication;
let redis: FakeRedis;
let user: LoginSession;
let other: LoginSession;

/** In-memory SearchStatsRepository mirroring the real one's surface. */
function makeMemoryStatsRepo() {
  const history = new Map<string, { userId: string; text: string; searchedAt: string }>();
  let seq = 0;
  const repo = {
    history,
    calls: { upsertPopular: 0, upsertHistory: 0, pruneHistory: 0 },
    async upsertPopular(input: { normalizedText: string }) {
      void input;
      this.calls.upsertPopular += 1;
    },
    async upsertHistory(input: { userId: string; text: string }) {
      this.calls.upsertHistory += 1;
      // hex-only id — the contract's uuidSchema rejects anything else
      const id = `${(seq += 1).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
      history.set(id, {
        userId: input.userId,
        text: input.text,
        searchedAt: new Date().toISOString(),
      });
    },
    async pruneHistory() {
      this.calls.pruneHistory += 1;
    },
    async listHistory(userId: string, limit: number) {
      return [...history.entries()]
        .filter(([, row]) => row.userId === userId)
        .sort((a, b) => (a[1].searchedAt < b[1].searchedAt ? 1 : -1))
        .slice(0, limit)
        .map(([id, row]) => ({
          id,
          text: row.text,
          cityId: null,
          cityName: null,
          searchedAt: new Date(row.searchedAt),
        }));
    },
    async clearHistory(userId: string) {
      let deleted = 0;
      for (const [id, row] of [...history.entries()]) {
        if (row.userId === userId) {
          history.delete(id);
          deleted += 1;
        }
      }
      return deleted;
    },
    async removeHistoryItem(userId: string, id: string) {
      const row = history.get(id);
      if (!row || row.userId !== userId) return false;
      history.delete(id);
      return true;
    },
    async listPopular() {
      return [];
    },
  };
  return repo as unknown as SearchStatsRepository & typeof repo;
}

let statsRepo: ReturnType<typeof makeMemoryStatsRepo>;

beforeAll(async () => {
  redis = new FakeRedis();
  statsRepo = makeMemoryStatsRepo();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(SESSIONS_REPOSITORY)
    .useValue(makeMemorySessionRepo())
    .overrideProvider(USERS_REPOSITORY)
    .useValue(makeMemoryUserRepo())
    .overrideProvider(QUEUES_SERVICE)
    .useValue({ enqueue: vi.fn(async () => 'job-1') })
    .overrideProvider(SearchStatsRepository)
    .useValue(statsRepo)
    .overrideProvider(SearchService)
    .useValue({
      search: vi.fn(async () => ({
        items: [],
        meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      })),
    })
    .compile();

  const expressApp = moduleRef.createNestApplication<NestExpressApplication>();
  app = expressApp as unknown as INestApplication;
  configureApp(expressApp);
  await app.init();

  await createUser(app, { username: 'statsuser', password: 'Sup3rSecret!2026' });
  await createUser(app, { username: 'statsother', password: 'Sup3rSecret!2026' });
  user = await loginAs(app, 'statsuser', 'Sup3rSecret!2026');
  other = await loginAs(app, 'statsother', 'Sup3rSecret!2026');
});

afterAll(async () => {
  await app?.close();
});

const history = (bearer?: string) =>
  request(app.getHttpServer())
    .get('/api/v1/search/history')
    .set(bearer ? { Authorization: bearer } : {});

const clearHistory = (bearer?: string) =>
  request(app.getHttpServer())
    .delete('/api/v1/search/history')
    .set(bearer ? { Authorization: bearer } : {});

const removeItem = (bearer: string, id: string) =>
  request(app.getHttpServer())
    .delete(`/api/v1/search/history/${id}`)
    .set({ Authorization: bearer });

const popular = (query = '') => request(app.getHttpServer()).get(`/api/v1/search/popular${query}`);

const runSearch = (q: string, bearer?: string) =>
  request(app.getHttpServer())
    .get(`/api/v1/search?q=${encodeURIComponent(q)}`)
    .set(bearer ? { Authorization: bearer } : {});

describe('GET /api/v1/search/history (B3.5)', () => {
  it('401 without authentication', async () => {
    const res = await history();
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('200 for an authenticated user with an (initially empty) list', async () => {
    const res = await history(user.bearer);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.items).toEqual([]);
  });

  it('validates limit: 0 and 25 are 400', async () => {
    const zero = await request(app.getHttpServer())
      .get('/api/v1/search/history?limit=0')
      .set({ Authorization: user.bearer });
    expect(zero.status).toBe(400);
    const big = await request(app.getHttpServer())
      .get('/api/v1/search/history?limit=25')
      .set({ Authorization: user.bearer });
    expect(big.status).toBe(400);
  });
});

describe('recording flow: GET /api/v1/search → stats (B3.5)', () => {
  it('records popularity for anonymous searchers but no history', async () => {
    const before = statsRepo.calls.upsertPopular;
    const res = await runSearch('کافه');
    expect(res.status).toBe(200);
    expect(statsRepo.calls.upsertPopular).toBe(before + 1);
    expect(statsRepo.history.size).toBe(0);
  });

  it('records history when a valid access token rides along', async () => {
    const res = await runSearch('کافه رحیمی', user.bearer);
    expect(res.status).toBe(200);
    expect(statsRepo.calls.upsertHistory).toBe(1);
    expect(statsRepo.calls.pruneHistory).toBe(1);
    const list = await history(user.bearer);
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0].text).toBe('کافه رحیمی');
  });

  it('an invalid token records popularity WITHOUT history', async () => {
    const histBefore = statsRepo.calls.upsertHistory;
    const res = await runSearch('رستوران', 'Bearer not-a-jwt');
    expect(res.status).toBe(200);
    expect(statsRepo.calls.upsertHistory).toBe(histBefore);
    const list = await history(user.bearer);
    // only the earlier valid-token entry exists for this user
    expect(list.body.data.items).toHaveLength(1);
  });

  it('faceted search without q records NOTHING', async () => {
    const popBefore = statsRepo.calls.upsertPopular;
    const res = await request(app.getHttpServer())
      .get('/api/v1/search?minRating=4')
      .set({ Authorization: user.bearer });
    expect(res.status).toBe(200);
    expect(statsRepo.calls.upsertPopular).toBe(popBefore);
  });

  it('history is private: another user sees an empty list', async () => {
    const res = await history(other.bearer);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
  });
});

describe('DELETE /api/v1/search/history (B3.5)', () => {
  it('401 without authentication', async () => {
    const res = await clearHistory();
    expect(res.status).toBe(401);
  });

  it('clears the user history and returns the deleted count', async () => {
    const res = await clearHistory(user.bearer);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.deleted).toBe(1);
    const list = await history(user.bearer);
    expect(list.body.data.items).toEqual([]);
  });

  it('second clear returns 0', async () => {
    const res = await clearHistory(user.bearer);
    expect(res.body.data.deleted).toBe(0);
  });
});

describe('DELETE /api/v1/search/history/:id (B3.5)', () => {
  it('401 without authentication', async () => {
    const res = await request(app.getHttpServer()).delete(
      '/api/v1/search/history/33333333-3333-3333-3333-333333333333',
    );
    expect(res.status).toBe(401);
  });

  it('404 for an unknown id', async () => {
    const res = await removeItem(user.bearer, '33333333-3333-3333-3333-333333333333');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('400 for a non-uuid id', async () => {
    const res = await removeItem(user.bearer, 'not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('removes the owner entry; a foreign user gets 404 for it', async () => {
    await runSearch('چلوکباب', user.bearer);
    const list = await history(user.bearer);
    expect(list.body.data.items).toHaveLength(1);
    const id = list.body.data.items[0].id as string;
    // the other user cannot delete someone else's entry
    const foreign = await removeItem(other.bearer, id);
    expect(foreign.status).toBe(404);
    // the owner can
    const ok = await removeItem(user.bearer, id);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ deleted: 1 });
    const after = await history(user.bearer);
    expect(after.body.data.items).toHaveLength(0);
  });
});

describe('GET /api/v1/search/popular (B3.5)', () => {
  it('200 publicly with an (empty) list from the fake repo', async () => {
    const res = await popular();
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.items).toEqual([]);
  });

  it('validates limit and cityId', async () => {
    expect((await popular('?limit=0')).status).toBe(400);
    expect((await popular('?limit=21')).status).toBe(400);
    expect((await popular('?cityId=not-a-uuid')).status).toBe(400);
    expect((await popular('?limit=5')).status).toBe(200);
  });
});
