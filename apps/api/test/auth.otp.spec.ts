import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { SESSIONS_REPOSITORY } from '../src/modules/auth/session.repository.js';
import { USERS_REPOSITORY, UsersService } from '../src/modules/users/users.service.js';
import { OTP_REPOSITORY, type OtpRepositoryLike } from '../src/modules/otp/otp.repository.js';
import { SETTINGS_REPOSITORY } from '../src/modules/settings/settings.service.js';
import { EmailService, SMTP_DRIVER } from '../src/modules/email/email.service.js';
import { SmsService } from '../src/modules/sms/sms.service.js';
import { QUEUES_SERVICE } from '../src/queue/queue.module.js';
import { REDIS } from '../src/redis/redis.client.js';
import { FakeRedis } from './fake-redis.js';
import { DEV_SMS_OUTBOX_KEY } from '../src/modules/sms/drivers/fake.driver.js';
import type { EmailDriver, EmailMessage } from '../src/modules/email/email.driver.js';
import {
  bearerFromCookies,
  createUser,
  extractCookies,
  loginAs,
  makeMemorySessionRepo,
  makeMemoryUserRepo,
} from './auth.utils.js';
import type { SettingRow } from '../src/db/schema/settings.js';
import type { OtpCodeRow } from '../src/db/schema/otp.js';

// env defaults come from global-setup (registered in vitest.config.ts).

/**
 * OTP-based auth flows (B1.7) over the REAL controller/guards/services with
 * in-memory repositories, FakeRedis and a capturing email driver. SMS codes
 * are read back from the fake driver's dev outbox (exactly what DEV_TOOLS
 * exposes); email codes from the capturing driver double.
 */

type OtpStore = Map<string, OtpCodeRow>;

function makeMemoryOtpRepo(): OtpRepositoryLike & { rows: OtpStore } {
  const rows: OtpStore = new Map<string, OtpCodeRow>();
  return {
    rows,
    async insert(row) {
      const created: OtpCodeRow = {
        id: row.id,
        purpose: row.purpose,
        channel: row.channel,
        target: row.target,
        codeHash: row.codeHash,
        expiresAt: row.expiresAt,
        attempts: 0,
        maxAttempts: row.maxAttempts,
        consumedAt: null,
        createdAt: new Date(),
        ip: row.ip,
        userId: row.userId,
      };
      rows.set(created.id, created);
      return created;
    },
    async findLatestUnconsumed(target, purpose) {
      const list = [...rows.values()]
        .filter((r) => r.target === target && r.purpose === purpose && r.consumedAt === null)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return list[0] ?? null;
    },
    async incrementAttempts(id) {
      const r = rows.get(id);
      if (!r) return null;
      r.attempts += 1;
      return r.attempts;
    },
    async markConsumed(id) {
      const r = rows.get(id);
      if (r && r.consumedAt === null) r.consumedAt = new Date();
    },
    async invalidateUnconsumed(target, purpose) {
      let count = 0;
      for (const r of rows.values()) {
        if (r.target === target && r.purpose === purpose && r.consumedAt === null) {
          r.consumedAt = new Date();
          count += 1;
        }
      }
      return count;
    },
    async deleteExpired(olderThanMs) {
      const cutoff = Date.now() - olderThanMs;
      let count = 0;
      for (const [id, r] of rows) {
        if (r.expiresAt.getTime() < cutoff) {
          rows.delete(id);
          count += 1;
        }
      }
      return count;
    },
  };
}

function makeFakeSettingsRepo() {
  const store = new Map<string, SettingRow>();
  return {
    async findAll(): Promise<SettingRow[]> {
      return [...store.values()];
    },
    async findByKey(key: string): Promise<SettingRow | null> {
      return store.get(key) ?? null;
    },
    async upsert(row: {
      key: string;
      value: unknown;
      isSecret: boolean;
      group: string;
      description: string | null;
    }): Promise<SettingRow> {
      const created = {
        key: row.key,
        value: row.value,
        isSecret: row.isSecret,
        group: row.group,
        description: row.description,
        updatedAt: new Date(),
      } as SettingRow;
      store.set(row.key, created);
      return created;
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
  };
}

/** Capturing email driver double — records every send for code extraction. */
function makeCapturingEmailDriver(): EmailDriver & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    name: 'capturing',
    sent,
    async send(mail: EmailMessage) {
      sent.push(mail);
      return { providerMessageId: `cap-${sent.length}` };
    },
  };
}

/**
 * Inline queue double: enqueue() immediately runs the module's own processor
 * (the code the WORKER would run), so the HTTP-level tests exercise the full
 * enqueue → deliver → fake-driver path without a real Redis/BullMQ. Real
 * queue behaviour (retries, schedulers) is covered by the unit specs and the
 * Docker follow-up.
 */
class InlineQueuesService {
  private route: Map<string, (data: unknown) => Promise<void>> | null = null;
  private seq = 0;

  attachRouter(route: Record<string, (data: unknown) => Promise<void>>): void {
    this.route = new Map(Object.entries(route));
  }

  async enqueue(queue: string, _name: string, data: unknown): Promise<string> {
    const handler = this.route?.get(queue);
    if (!handler) throw new Error(`no inline route for queue "${queue}"`);
    await handler(data);
    return `inline-job-${(this.seq += 1)}`;
  }

  async closeAll(): Promise<void> {
    this.route = null;
  }

  getQueue(): unknown {
    throw new Error('inline queues double does not expose BullMQ queues');
  }
}

interface TestApp {
  app: INestApplication;
  redis: FakeRedis;
  otpRepo: OtpStore;
  email: ReturnType<typeof makeCapturingEmailDriver>;
}

async function buildApp(): Promise<TestApp> {
  const localRedis = new FakeRedis();
  const localOtpRepo = makeMemoryOtpRepo();
  const localEmail = makeCapturingEmailDriver();
  const inlineQueues = new InlineQueuesService();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(localRedis)
    .overrideProvider(SESSIONS_REPOSITORY)
    .useValue(makeMemorySessionRepo())
    .overrideProvider(USERS_REPOSITORY)
    .useValue(makeMemoryUserRepo())
    .overrideProvider(OTP_REPOSITORY)
    .useValue(localOtpRepo)
    .overrideProvider(SETTINGS_REPOSITORY)
    .useValue(makeFakeSettingsRepo())
    .overrideProvider(SMTP_DRIVER)
    .useValue(localEmail)
    .overrideProvider(QUEUES_SERVICE)
    .useValue(inlineQueues)
    .compile();
  const expressApp = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(expressApp);
  const asINest = expressApp as unknown as INestApplication;
  await asINest.init();
  // Route enqueued jobs straight to the worker-side processors.
  inlineQueues.attachRouter({
    sms: (data) => moduleRef.get(SmsService).deliver(data as never),
    mail: (data) => moduleRef.get(EmailService).deliver(data as never),
  });
  return { app: asINest, redis: localRedis, otpRepo: localOtpRepo.rows, email: localEmail };
}

/**
 * Each test gets its OWN app (fresh FakeRedis, repos and counters). The
 * OtpService hourly per-IP cap is 20 — sharing one Redis across ~16 issuing
 * tests would trip it; per-test isolation keeps the suite deterministic.
 */
let ctx: TestApp & { post: (path: string) => request.Test; get: (path: string) => request.Test };

beforeEach(async () => {
  const built = await buildApp();
  ctx = {
    ...built,
    post: (path: string) => request(built.app.getHttpServer()).post(path),
    get: (path: string) => request(built.app.getHttpServer()).get(path),
  };
});

afterEach(async () => {
  await ctx?.app.close();
});

// Shorthand bound to the CURRENT test's app instance.
const post = (path: string) => ctx.post(path);
const get = (path: string) => ctx.get(path);

async function latestSmsText(target: string): Promise<string> {
  const items = await ctx.redis.lrange(DEV_SMS_OUTBOX_KEY, 0, -1);
  for (const raw of items) {
    const item = JSON.parse(raw) as { to: string; text: string };
    if (item.to === target) return item.text;
  }
  throw new Error(`no sms in outbox for ${target}`);
}

function lastEmail(to: string): EmailMessage {
  const found = [...ctx.email.sent].reverse().find((m) => m.to === to);
  if (!found) throw new Error(`no email captured for ${to}`);
  return found;
}

function codeIn(text: string): string {
  const m = text.match(/\b(\d{6})\b/);
  if (!m || !m[1]) throw new Error(`no 6-digit code in: ${text.slice(0, 120)}`);
  return m[1];
}

let phoneSeq = 501;
const nextPhone = () => `+98913${String(4000000 + (phoneSeq += 17)).slice(0, 7)}`;
let mailSeq = 0;
const nextEmail = () => `otp${(mailSeq += 19)}@x.ir`;

describe('POST /auth/otp/request + /auth/otp/verify (B1.7)', () => {
  it('sms OTP login creates a throwaway-username user and sets auth cookies', async () => {
    const phone = nextPhone();
    const first = await post('/api/v1/auth/otp/request').send({ channel: 'sms', target: phone });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      channel: 'sms',
      resendAfterSec: 60,
      expiresInSec: 120,
    });
    expect(first.body.data.targetMasked).toContain('***');
    expect(first.body.data.targetMasked).not.toContain(phone.slice(4, 11));

    const code = codeIn(await latestSmsText(phone));
    const verify = await post('/api/v1/auth/otp/verify').send({
      channel: 'sms',
      target: phone,
      code,
    });
    expect(verify.status).toBe(200);
    expect(verify.body.ok).toBe(true);
    expect(verify.body.data.user.phone).toBe(phone);
    expect(verify.body.data.user.phoneVerified).toBe(true);
    expect(verify.body.data.user.username).toMatch(/^u[0-9a-z]{8}$/);

    const raw = verify.headers['set-cookie'] as unknown as string[];
    const cookies = Array.isArray(raw) ? raw : [raw];
    expect(cookies.some((c) => c.startsWith('rt='))).toBe(true);
    const me = await get('/api/v1/auth/me').set(
      'Authorization',
      bearerFromCookies(extractCookies(verify)),
    );
    expect(me.status).toBe(200);
    expect(me.body.data.phone).toBe(phone);
  });

  it('email OTP login works the same way and picks up the Accept-Language locale', async () => {
    const email = nextEmail();
    const req = await post('/api/v1/auth/otp/request')
      .set('Accept-Language', 'fa')
      .send({ channel: 'email', target: email });
    expect(req.status).toBe(201);

    const mail = lastEmail(email);
    expect(mail.html).toContain('dir="rtl"');
    const code = codeIn(mail.text);

    const verify = await post('/api/v1/auth/otp/verify')
      .set('Accept-Language', 'fa')
      .send({ channel: 'email', target: email, code });
    expect(verify.status).toBe(200);
    expect(verify.body.data.user.email).toBe(email);
    expect(verify.body.data.user.emailVerified).toBe(true);
    expect(verify.body.data.user.locale).toBe('fa');
  });

  it('rejects a wrong code with 422 OTP_INVALID', async () => {
    const phone = nextPhone();
    await post('/api/v1/auth/otp/request').send({ channel: 'sms', target: phone });
    const wrong = await post('/api/v1/auth/otp/verify').send({
      channel: 'sms',
      target: phone,
      code: '000000',
    });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe('OTP_INVALID');
  });

  it('rejects an expired code with 422 OTP_EXPIRED', async () => {
    const phone = nextPhone();
    await post('/api/v1/auth/otp/request').send({ channel: 'sms', target: phone });
    const row = [...ctx.otpRepo.values()].reverse().find((r) => r.target === phone);
    if (!row) throw new Error('otp row not stored');
    row.expiresAt = new Date(Date.now() - 1_000); // backdate the stored row
    const code = codeIn(await latestSmsText(phone));
    const res = await post('/api/v1/auth/otp/verify').send({ channel: 'sms', target: phone, code });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });

  it('resend too soon returns 422 OTP_RESEND_TOO_SOON with a retryAfter', async () => {
    const phone = nextPhone();
    const first = await post('/api/v1/auth/otp/request').send({ channel: 'sms', target: phone });
    expect(first.status).toBe(201);
    const second = await post('/api/v1/auth/otp/request').send({ channel: 'sms', target: phone });
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe('OTP_RESEND_TOO_SOON');
    expect(second.body.error.details.retryAfterSec).toBeGreaterThan(0);
  });

  it('unknown and known targets get identical request responses (anti-enumeration)', async () => {
    const knownEmail = nextEmail();
    await createUser(ctx.app, {
      username: 'otp_known',
      password: 'Sup3rSecret!',
      email: knownEmail,
    });
    const unknownEmail = nextEmail();

    const known = await post('/api/v1/auth/otp/request').send({
      channel: 'email',
      target: knownEmail,
    });
    const unknown = await post('/api/v1/auth/otp/request').send({
      channel: 'email',
      target: unknownEmail,
    });
    expect(known.status).toBe(201);
    expect(unknown.status).toBe(201);
    expect(Object.keys(known.body.data).sort()).toEqual(Object.keys(unknown.body.data).sort());
    expect(known.body.data.resendAfterSec).toBe(unknown.body.data.resendAfterSec);
    expect(known.body.data.expiresInSec).toBe(unknown.body.data.expiresInSec);
    // Both targets actually received a code — the same work happened.
    lastEmail(knownEmail);
    lastEmail(unknownEmail);
  });

  it('takeover rule: OTP login with an unverified registered target logs into THAT user', async () => {
    const email = nextEmail();
    const owner = await createUser(ctx.app, {
      username: 'otp_owner',
      password: 'Sup3rSecret!',
      email,
    });
    expect(owner.emailVerifiedAt).toBeNull();

    await post('/api/v1/auth/otp/request').send({ channel: 'email', target: email });
    const code = codeIn(lastEmail(email).text);
    const res = await post('/api/v1/auth/otp/verify').send({
      channel: 'email',
      target: email,
      code,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(owner.id); // SAME user, not a new one
    expect(res.body.data.user.emailVerified).toBe(true);
  });

  it('a banned account gets 403 ACCOUNT_BANNED on otp verify', async () => {
    const phone = nextPhone();
    const user = await createUser(ctx.app, {
      username: 'otp_banned',
      password: 'Sup3rSecret!',
      phone,
    });
    await post('/api/v1/auth/otp/request').send({ channel: 'sms', target: phone });

    const users = ctx.app.get(UsersService);
    await users.changeStatus(user.id, 'blocked');
    const repoRow = (
      ctx.app.get(USERS_REPOSITORY) as unknown as {
        rows: Map<string, { bannedUntil: Date | null } & Record<string, unknown>>;
      }
    ).rows.get(user.id);
    if (repoRow) repoRow.bannedUntil = new Date(Date.now() + 3_600_000);

    const code = codeIn(await latestSmsText(phone));
    const res = await post('/api/v1/auth/otp/verify').send({ channel: 'sms', target: phone, code });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_BANNED');
  });
});

describe('POST /auth/verify/request + /auth/verify/confirm (B1.7)', () => {
  it('verify-email flow: request → confirm → verified flag set', async () => {
    const email = nextEmail();
    const user = await createUser(ctx.app, {
      username: 'verify_flow',
      password: 'Sup3rSecret!',
      email,
    });
    const login = await loginAs(ctx.app, 'verify_flow', 'Sup3rSecret!');

    const req = await post('/api/v1/auth/verify/request')
      .set('Authorization', login.bearer)
      .send({ channel: 'email', target: email });
    expect(req.status).toBe(201);
    expect(req.body.data.channel).toBe('email');

    const code = codeIn(lastEmail(email).text);
    const confirm = await post('/api/v1/auth/verify/confirm')
      .set('Authorization', login.bearer)
      .send({ channel: 'email', target: email, code });
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.id).toBe(user.id);
    expect(confirm.body.data.emailVerified).toBe(true);
  });

  it('a NEW identifier owned by a VERIFIED account is rejected with 409 at request time', async () => {
    const taken = nextEmail();
    await createUser(ctx.app, {
      username: 'verified_holder',
      password: 'Sup3rSecret!',
      email: taken,
    });
    const users = ctx.app.get(UsersService);
    const holder = await users.getByIdentifier(taken);
    if (!holder) throw new Error('holder missing');
    await users.attachIdentifier({ userId: holder.id, channel: 'email', target: taken });

    await createUser(ctx.app, { username: 'wants_taken', password: 'Sup3rSecret!' });
    const login = await loginAs(ctx.app, 'wants_taken', 'Sup3rSecret!');
    const res = await post('/api/v1/auth/verify/request')
      .set('Authorization', login.bearer)
      .send({ channel: 'email', target: taken });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('a fresh identifier attaches; an unverified holder loses it to the proving user', async () => {
    const fresh = nextEmail();
    const holderAddr = nextEmail();
    await createUser(ctx.app, {
      username: 'stale_holder',
      password: 'Sup3rSecret!',
      email: holderAddr,
    });

    const taker = await createUser(ctx.app, {
      username: 'identifier_taker',
      password: 'Sup3rSecret!',
    });
    const login = await loginAs(ctx.app, 'identifier_taker', 'Sup3rSecret!');

    const req = await post('/api/v1/auth/verify/request')
      .set('Authorization', login.bearer)
      .send({ channel: 'email', target: fresh });
    expect(req.status).toBe(201);
    const code = codeIn(lastEmail(fresh).text);
    const confirm = await post('/api/v1/auth/verify/confirm')
      .set('Authorization', login.bearer)
      .send({ channel: 'email', target: fresh, code });
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.email).toBe(fresh);
    expect(confirm.body.data.emailVerified).toBe(true);

    // Take the unverified holder's address through the same flow.
    await post('/api/v1/auth/verify/request')
      .set('Authorization', login.bearer)
      .send({ channel: 'email', target: holderAddr });
    const code2 = codeIn(lastEmail(holderAddr).text);
    const confirm2 = await post('/api/v1/auth/verify/confirm')
      .set('Authorization', login.bearer)
      .send({ channel: 'email', target: holderAddr, code: code2 });
    expect(confirm2.status).toBe(200);

    const users = ctx.app.get(UsersService);
    const nowHolder = await users.getByIdentifier(holderAddr);
    if (!nowHolder) throw new Error('taken identifier lost');
    expect(nowHolder.id).toBe(taker.id);
    const oldOwner = await users.getByIdentifier('stale_holder');
    if (!oldOwner) throw new Error('old owner missing');
    expect(oldOwner.email).toBeNull();
  });
});

describe('POST /auth/password/forgot + /auth/password/reset (B1.7)', () => {
  async function makeResettableUser(username: string, email: string) {
    await createUser(ctx.app, { username, password: 'OldPass123!', email });
    const users = ctx.app.get(UsersService);
    const row = await users.getByIdentifier(email);
    if (!row) throw new Error('user missing');
    await users.attachIdentifier({ userId: row.id, channel: 'email', target: email });
    return users;
  }

  it('forgot+reset revokes all sessions; the old password stops working', async () => {
    const email = nextEmail();
    await makeResettableUser('reset_flow', email);
    const oldLogin = await loginAs(ctx.app, 'reset_flow', 'OldPass123!');

    const forgot = await post('/api/v1/auth/password/forgot').send({ identifier: email });
    expect(forgot.status).toBe(200);
    expect(forgot.body.data).toEqual({ ok: true });

    const code = codeIn(lastEmail(email).text);
    const reset = await post('/api/v1/auth/password/reset').send({
      identifier: email,
      code,
      newPassword: 'NewPass456!',
    });
    expect(reset.status).toBe(204);

    const oldPassword = await post('/api/v1/auth/login').send({
      identifier: 'reset_flow',
      password: 'OldPass123!',
    });
    expect(oldPassword.status).toBe(401);
    const newPassword = await post('/api/v1/auth/login').send({
      identifier: 'reset_flow',
      password: 'NewPass456!',
    });
    expect(newPassword.status).toBe(200);

    const me = await get('/api/v1/auth/me').set('Authorization', oldLogin.bearer);
    expect(me.status).toBe(401); // pre-reset session was revoked
  });

  it('forgot for an unknown identifier is indistinguishable from a known one', async () => {
    const known = nextEmail();
    await makeResettableUser('forgot_known', known);
    const a = await post('/api/v1/auth/password/forgot').send({ identifier: known });
    const b = await post('/api/v1/auth/password/forgot').send({ identifier: nextEmail() });
    expect(a.status).toBe(b.status);
    expect(a.body.data).toEqual(b.body.data);
  });

  it('a login-purpose code is rejected for password reset (purpose mismatch)', async () => {
    const email = nextEmail();
    await makeResettableUser('purpose_mix', email);

    await post('/api/v1/auth/otp/request').send({ channel: 'email', target: email });
    const loginCode = codeIn(lastEmail(email).text);
    const res = await post('/api/v1/auth/password/reset').send({
      identifier: email,
      code: loginCode,
      newPassword: 'Whatever123!',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OTP_INVALID');
  });

  it('password/reset enforces the password schema (400 on weak password)', async () => {
    const email = nextEmail();
    await makeResettableUser('weak_reset', email);
    await post('/api/v1/auth/password/forgot').send({ identifier: email });
    const code = codeIn(lastEmail(email).text);
    const res = await post('/api/v1/auth/password/reset').send({
      identifier: email,
      code,
      newPassword: 'short',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('rate limits (B1.7)', () => {
  it('the 11th otp/request from one ip within the hour returns 429 + Retry-After', async () => {
    const fresh = await buildApp(); // own FakeRedis → fresh limiter counters
    try {
      let last: request.Response | undefined;
      for (let i = 0; i < 11; i++) {
        last = await request(fresh.app.getHttpServer())
          .post('/api/v1/auth/otp/request')
          .send({ channel: 'sms', target: `+98915${String(1000000 + i * 11).slice(0, 7)}` });
      }
      if (!last) throw new Error('no responses');
      expect(last.status).toBe(429);
      expect(last.body.error.code).toBe('RATE_LIMITED');
      expect(last.headers['retry-after']).toBeDefined();
    } finally {
      await fresh.app.close();
    }
  });
});
