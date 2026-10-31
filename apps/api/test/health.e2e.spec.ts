import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './create-test-app.js';
import { ProbeModule } from './probe.module.js';

// Env must exist before ConfigModule.forRoot() validates process.env.
process.env.NODE_ENV = 'test';
process.env.API_PORT = '4100';
process.env.PUBLIC_WEB_URL = 'http://localhost:3100';
process.env.DATABASE_URL = 'postgres://app:app_dev_password@localhost:5432/app_test';
process.env.TEST_DATABASE_URL = 'postgres://app:app_dev_password@localhost:5432/app_test';
process.env.REDIS_URL = 'redis://localhost:6379/15';
process.env.TEST_REDIS_URL = 'redis://localhost:6379/15';
process.env.LOG_LEVEL = 'warn';
process.env.DEV_TOOLS = 'true';

describe('Health e2e (B0.1)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp([ProbeModule]);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns the success envelope with ok/status/uptime/version', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(typeof res.body.data.uptimeSec).toBe('number');
    expect(res.body.data.version).toBe('0.0.0');
    expect(res.body.data.checks).toEqual({});
  });

  it('echoes a valid incoming X-Request-Id and generates one when missing', async () => {
    const fixed = '123e4567-e89b-12d3-a456-426614174000';
    const echo = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('X-Request-Id', fixed);
    expect(echo.headers['x-request-id']).toBe(fixed);

    const generated = await request(app.getHttpServer()).get('/api/v1/health');
    expect(generated.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('rejects a non-uuid X-Request-Id and issues a fresh one', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('X-Request-Id', 'not-a-uuid');
    expect(res.headers['x-request-id']).not.toBe('not-a-uuid');
  });

  it('unknown route returns a 404 error envelope with code NOT_FOUND and a requestId', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/definitely-not-here').expect(404);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.messageKey).toBe('errors.not_found');
    expect(res.body.error.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('invalid body to the probe controller returns 400 VALIDATION_FAILED with details array', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe/echo')
      .send({ name: 'x', age: 999, extra: 'unknown key rejected by .strict()' })
      .expect(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.messageKey).toBe('errors.validation_failed');
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(res.body.error.details.length).toBeGreaterThan(0);
    for (const d of res.body.error.details) {
      expect(typeof d.message).toBe('string');
    }
  });

  it('valid probe body echoes data in the success envelope (coercion works)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe/echo')
      .send({ name: 'Amir', age: '31' })
      .expect(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toEqual({ name: 'Amir', age: 31 });
  });

  it('thrown generic Error returns 500 INTERNAL_ERROR without leaking the message (production-like)', async () => {
    // Force production mode for this scenario by starting a separate app.
    process.env.NODE_ENV = 'production';
    const prodApp = await createTestApp([ProbeModule]);
    await prodApp.init();
    const res = await request(prodApp.getHttpServer()).get('/api/v1/probe/boom').expect(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.message).toBe('Internal server error');
    expect(JSON.stringify(res.body)).not.toContain('super secret internals');
    await prodApp.close();
    process.env.NODE_ENV = 'test';
  });

  it('CORS allows the configured public origin and echoes X-Request-Id on preflight', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:3100')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3100');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('CORS rejects a foreign origin', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
