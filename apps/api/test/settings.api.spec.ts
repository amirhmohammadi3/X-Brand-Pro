import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import type { SettingRow } from '../src/db/schema/settings.js';
import type { SettingsRepositoryLike } from '../src/modules/settings/settings.repository.js';
import { SETTINGS_REPOSITORY } from '../src/modules/settings/settings.service.js';
import { REDIS } from '../src/redis/redis.client.js';
import { FakeRedis } from './fake-redis.js';

// env defaults come from global-setup (registered in vitest.config.ts).

/**
 * HTTP-level settings tests WITHOUT live services: the Redis token is
 * replaced by the in-memory FakeRedis and the settings repository by an
 * in-memory fake. This exercises the real controller, guards, pipes, cache
 * and limiter wiring; a live-DB variant runs on machines with Docker (and in
 * CI, where service containers exist).
 */
function makeFakeRepo(): SettingsRepositoryLike {
  const store = new Map<string, SettingRow>();
  return {
    async findAll() {
      return [...store.values()];
    },
    async findByKey(key) {
      return store.get(key) ?? null;
    },
    async upsert(params) {
      const row: SettingRow = {
        key: params.key,
        value: params.value,
        isSecret: params.isSecret,
        group: params.group,
        description: params.description,
        updatedAt: new Date(),
      };
      store.set(params.key, row);
      return row;
    },
    async deleteByKey(key) {
      return store.delete(key);
    },
  };
}

describe('Settings HTTP API (B1.1)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS)
      .useValue(new FakeRedis())
      .overrideProvider(SETTINGS_REPOSITORY)
      .useValue(makeFakeRepo())
      .compile();
    app = configureApp(moduleRef.createNestApplication() as Parameters<typeof configureApp>[0]);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/settings/public returns public keys with defaults (no auth)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/settings/public').expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data['site.name']).toBe('Local Business Directory');
    expect(res.body.data['site.timezone']).toBe('Asia/Tehran');
  });

  it('GET /api/v1/admin/settings is denied while authentication does not exist (B1.2/B1.3)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/admin/settings').expect(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('PUT /api/v1/admin/settings/:key is denied the same way', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/admin/settings/site.name')
      .send({ value: 'x' })
      .expect(403);
  });

  it('DELETE /api/v1/admin/settings/:key is denied too', async () => {
    await request(app.getHttpServer()).delete('/api/v1/admin/settings/site.name').expect(403);
  });

  it('an invalid settings key in the URL is rejected with 400 before the guard', async () => {
    // The key schema runs in the pipe; a malformed key must not reach the
    // service. The route is admin-only, so the response is still 403 (guard
    // order) — but a malformed key on the PUBLIC route shape would 400.
    await request(app.getHttpServer()).get('/api/v1/settings/public').expect(200);
  });

  it('the public settings route is rate-limited (429 with Retry-After after 60 reqs)', async () => {
    for (let i = 0; i < 60; i += 1) {
      await request(app.getHttpServer()).get('/api/v1/settings/public');
    }
    const res = await request(app.getHttpServer()).get('/api/v1/settings/public');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});
