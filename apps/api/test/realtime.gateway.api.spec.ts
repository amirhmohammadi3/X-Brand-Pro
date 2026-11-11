import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { SESSIONS_REPOSITORY } from '../src/modules/auth/session.repository.js';
import { USERS_REPOSITORY } from '../src/modules/users/users.service.js';
import { AUDIT_SERVICE } from '../src/modules/audit/audit.service.js';
import { REDIS } from '../src/redis/redis.client.js';
import { QUEUES_SERVICE } from '../src/queue/queue.module.js';
import { SETTINGS_REPOSITORY } from '../src/modules/settings/settings.service.js';
import { BUSINESSES_REPOSITORY } from '../src/modules/business/businesses.repository.js';
import { RealtimeService } from '../src/modules/realtime/realtime.service.js';
import { REALTIME_WS_PATH } from '../src/modules/realtime/realtime.io-adapter.js';
import { REALTIME_JOIN_EVENT, REALTIME_LEAVE_EVENT, type RealtimeAck } from '@app/contracts';
import { FakeRedis } from './fake-redis.js';
import {
  cookieValue,
  createUser,
  loginAs,
  makeMemorySessionRepo,
  makeMemoryUserRepo,
  type LoginSession,
} from './auth.utils.js';

/**
 * B5.5 realtime gateway tests — a REAL Socket.IO server on an ephemeral
 * port, exercised with the REAL socket.io-client. Everything DB-shaped is
 * the same in-memory fake set the other API specs use (no Docker in this
 * sandbox, CI provides Postgres/Redis), and REDIS is FakeRedis so the
 * gateway boots with its documented in-memory fallback (no ioredis
 * carrier → adapter attach is skipped; cross-instance emit is covered by
 * the Redis adapter's own test suite).
 *
 * Covered: handshake rejection (no token / bad token), the auth.token and
 * cookie handshake paths, auto-join of the user room (server-side
 * emitToUser reaches the client), the room:join/room:leave ACL (own user
 * room OK, stranger rooms FORBIDDEN, owner-only business rooms, grammar
 * violations BAD_ROOM) and room routing between two sockets of one user.
 */

const BIZ_OWNED = '33333333-3333-4333-8333-333333333333';
const BIZ_OTHER = '44444444-4444-4444-8444-444444444444';
const STRANGER_ID = '55555555-5555-4555-8555-555555555555';

let app: INestApplication;
let realtime: RealtimeService;
let port: number;
let user: LoginSession;
let userId: string;
/** Late-bound owner id (createUser mints it) — the businesses fake reads it. */
const userIdRef: { id: string } = { id: '00000000-0000-4000-8000-000000000000' };

const connect = (opts: {
  token?: string;
  cookie?: string;
  /** Rejection tests use polling: over websocket-only transport the server
   * rejects with a raw close frame and the client reports 'websocket error'
   * instead of carrying the middleware's error message. */
  transports?: Array<'websocket' | 'polling'>;
}): Promise<{ client: ClientSocket; error?: Error }> =>
  new Promise((resolve) => {
    const client = io(`http://localhost:${port}`, {
      path: REALTIME_WS_PATH,
      transports: opts.transports ?? ['websocket'],
      ...(opts.token !== undefined ? { auth: { token: opts.token } } : {}),
      ...(opts.cookie !== undefined ? { extraHeaders: { cookie: opts.cookie } } : {}),
    });
    let settled = false;
    client.once('connect', () => {
      if (!settled) {
        settled = true;
        resolve({ client });
      }
    });
    client.once('connect_error', (err: Error) => {
      if (!settled) {
        settled = true;
        resolve({ client, error: err });
      }
    });
  });

const emitAck = (client: ClientSocket, event: string, payload: unknown): Promise<RealtimeAck> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ack timeout')), 3000);
    client.emit(event, payload, (ack: RealtimeAck) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });

const waitForEvent = (client: ClientSocket, event: string): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`event ${event} timeout`)), 3000);
    client.once(event, (data: unknown) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

const tick = (ms = 120): Promise<void> => new Promise((r) => setTimeout(r, ms));

const tokenOf = (session: LoginSession): string => cookieValue(session.cookies, 'at');

beforeAll(async () => {
  const redis = new FakeRedis();
  const compiled = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(SESSIONS_REPOSITORY)
    .useValue(makeMemorySessionRepo())
    .overrideProvider(USERS_REPOSITORY)
    .useValue(makeMemoryUserRepo())
    .overrideProvider(QUEUES_SERVICE)
    .useValue({ add: vi.fn(async () => undefined), route: vi.fn() })
    .overrideProvider(BUSINESSES_REPOSITORY)
    .useValue({
      async findById(id: string) {
        if (id === BIZ_OWNED) return { id, ownerId: userIdRef.id };
        if (id === BIZ_OTHER) return { id, ownerId: STRANGER_ID };
        return null;
      },
    })
    .overrideProvider(SETTINGS_REPOSITORY)
    .useValue({
      async findAll() {
        return [];
      },
      async findByKey() {
        return null;
      },
      async upsert(row: Record<string, unknown>) {
        return row;
      },
    })
    .overrideProvider(AUDIT_SERVICE)
    .useValue({
      log: vi.fn(),
      write: vi.fn(async () => ({ id: 'audit-1' })),
    })
    .compile();

  const expressApp = compiled.createNestApplication<NestExpressApplication>();
  app = expressApp as unknown as INestApplication;
  configureApp(expressApp);
  await app.init();

  // The businesses fake needs the real owner id; createUser mints UUIDs.
  const ownerRow = await createUser(app, { username: 'wsowner', password: 'Sup3rSecret!2026' });
  userIdRef.id = ownerRow.id;

  user = await loginAs(app, 'wsowner', 'Sup3rSecret!2026');
  userId = ownerRow.id;

  await app.listen(0);
  port = (app.getHttpServer().address() as AddressInfo).port;
  realtime = compiled.get(RealtimeService);
});

afterAll(async () => {
  await app?.close();
});

describe('B5.5 handshake authentication', () => {
  it('rejects a handshake with no token (UNAUTHENTICATED)', async () => {
    const { client, error } = await connect({ transports: ['polling'] });
    expect(error?.message).toBe('UNAUTHENTICATED');
    client.disconnect();
    await tick(20);
  });

  it('rejects a handshake with an invalid token (UNAUTHENTICATED)', async () => {
    const { client, error } = await connect({ token: 'not-a-jwt', transports: ['polling'] });
    expect(error?.message).toBe('UNAUTHENTICATED');
    client.disconnect();
    await tick(20);
  });

  it('accepts a handshake with a valid access token via auth.token', async () => {
    const { client, error } = await connect({ token: tokenOf(user) });
    expect(error).toBeUndefined();
    expect(client.connected).toBe(true);
    client.disconnect();
    await tick(20);
  });

  it('accepts a handshake with the same token in the `at` cookie', async () => {
    const { client, error } = await connect({ cookie: `at=${tokenOf(user)}` });
    expect(error).toBeUndefined();
    expect(client.connected).toBe(true);
    client.disconnect();
    await tick(20);
  });
});

describe('B5.5 user room + server-side emit', () => {
  it('auto-joins user:<id> on connect — emitToUser reaches the client', async () => {
    const { client } = await connect({ token: tokenOf(user) });
    await tick(); // handleConnection's join is async

    const received = waitForEvent(client, 'notification');
    realtime.emitToUser(userId, 'notification', { kind: 'test', body: 'سلام' });
    expect(await received).toEqual({ kind: 'test', body: 'سلام' });

    client.disconnect();
    await tick(20);
  });

  it('does NOT reach a stranger through the same server-side emit', async () => {
    const { client } = await connect({ token: tokenOf(user) });
    await tick();

    let hit = false;
    client.once('notification', () => {
      hit = true;
    });
    realtime.emitToUser(STRANGER_ID, 'notification', { kind: 'test' });
    await tick(150);
    expect(hit).toBe(false);

    client.disconnect();
    await tick(20);
  });

  it('isReady() flips true once the gateway registered the server', () => {
    expect(realtime.isReady()).toBe(true);
  });
});

describe('B5.5 room join/leave ACL', () => {
  it('allows joining your OWN user room (ack ok, echoes the room)', async () => {
    const { client } = await connect({ token: tokenOf(user) });
    const ack = await emitAck(client, REALTIME_JOIN_EVENT, { room: `user:${userId}` });
    expect(ack).toEqual({ ok: true, room: `user:${userId}` });
    client.disconnect();
    await tick(20);
  });

  it("forbids joining another user's user room (FORBIDDEN_ROOM)", async () => {
    const { client } = await connect({ token: tokenOf(user) });
    const ack = await emitAck(client, REALTIME_JOIN_EVENT, { room: `user:${STRANGER_ID}` });
    expect(ack).toEqual({ ok: false, code: 'FORBIDDEN_ROOM', message: expect.any(String) });
    client.disconnect();
    await tick(20);
  });

  it('allows joining an OWNED business room, forbids a foreign one', async () => {
    const { client } = await connect({ token: tokenOf(user) });
    const okAck = await emitAck(client, REALTIME_JOIN_EVENT, { room: `business:${BIZ_OWNED}` });
    expect(okAck).toEqual({ ok: true, room: `business:${BIZ_OWNED}` });

    const otherAck = await emitAck(client, REALTIME_JOIN_EVENT, { room: `business:${BIZ_OTHER}` });
    expect(otherAck).toEqual({ ok: false, code: 'FORBIDDEN_ROOM', message: expect.any(String) });

    const missingAck = await emitAck(client, REALTIME_JOIN_EVENT, {
      room: 'business:66666666-6666-4666-8666-666666666666',
    });
    expect(missingAck).toEqual({ ok: false, code: 'FORBIDDEN_ROOM', message: expect.any(String) });
    client.disconnect();
    await tick(20);
  });

  it('rejects grammar violations with BAD_ROOM (never joins)', async () => {
    const { client } = await connect({ token: tokenOf(user) });
    const ack = await emitAck(client, REALTIME_JOIN_EVENT, { room: 'conversation:whatever' });
    expect(ack).toEqual({ ok: false, code: 'BAD_ROOM', message: expect.any(String) });

    const junk = await emitAck(client, REALTIME_JOIN_EVENT, { room: '*' });
    expect(junk).toEqual({ ok: false, code: 'BAD_ROOM', message: expect.any(String) });

    const nonObject = await emitAck(client, REALTIME_JOIN_EVENT, 'a plain string');
    expect(nonObject).toEqual({ ok: false, code: 'BAD_ROOM', message: expect.any(String) });
    client.disconnect();
    await tick(20);
  });

  it('room:leave returns ok for a well-formed room', async () => {
    const { client } = await connect({ token: tokenOf(user) });
    const ack = await emitAck(client, REALTIME_LEAVE_EVENT, { room: `user:${userId}` });
    expect(ack).toEqual({ ok: true, room: `user:${userId}` });

    // After leaving, the server-side emit no longer reaches this socket.
    let hit = false;
    client.once('notification', () => {
      hit = true;
    });
    realtime.emitToUser(userId, 'notification', { kind: 'after-leave' });
    await tick(150);
    expect(hit).toBe(false);

    client.disconnect();
    await tick(20);
  });

  it('routes a room emit to BOTH sockets of one user (in-memory fan-out)', async () => {
    const a = await connect({ token: tokenOf(user) });
    const b = await connect({ token: tokenOf(user) });
    await tick();

    const gotA = waitForEvent(a.client, 'notification');
    const gotB = waitForEvent(b.client, 'notification');
    realtime.emitToUser(userId, 'notification', { kind: 'fanout' });
    expect(await gotA).toEqual({ kind: 'fanout' });
    expect(await gotB).toEqual({ kind: 'fanout' });

    a.client.disconnect();
    b.client.disconnect();
    await tick(20);
  });
});
