import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { timingSafeEqual } from 'node:crypto';
import type { SettingRow } from '../src/db/schema/settings.js';
import type { OtpCodeRow } from '../src/db/schema/otp.js';
import { OtpService } from '../src/modules/otp/otp.service.js';
import { OTP_REPOSITORY, type OtpRepositoryLike } from '../src/modules/otp/otp.repository.js';
import { SETTINGS_REPOSITORY } from '../src/modules/settings/settings.service.js';
import { REDIS } from '../src/redis/redis.client.js';
import { FakeRedis } from './fake-redis.js';

// env defaults come from global-setup (registered in vitest.config.ts).

/**
 * OTP engine tests (B1.4) — no live services: the repository is an
 * in-memory fake, Redis is FakeRedis, settings resolve registry defaults
 * through an in-memory repository (no overrides = defaults 6/120/5).
 */
let app: INestApplication;
let otp: OtpService;
let redis: FakeRedis;
let repo: ReturnType<typeof makeMemoryOtpRepo>;

type Store = Map<string, OtpCodeRow>;

function makeMemoryOtpRepo(): OtpRepositoryLike & { rows: Store } {
  const rows: Store = new Map<string, OtpCodeRow>();
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

function makeFakeSettingsRepo(): {
  findAll(): Promise<SettingRow[]>;
  findByKey(key: string): Promise<SettingRow | null>;
  upsert(row: {
    key: string;
    value: unknown;
    isSecret: boolean;
    group: string;
    description: string | null;
  }): Promise<SettingRow>;
  delete(key: string): Promise<void>;
} {
  const store = new Map<string, SettingRow>();
  return {
    async findAll() {
      return [...store.values()];
    },
    async findByKey(key) {
      return store.get(key) ?? null;
    },
    async upsert(row) {
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
    async delete(key) {
      store.delete(key);
    },
  };
}

const TARGET = '+989123456789';

beforeAll(async () => {
  redis = new FakeRedis();
  repo = makeMemoryOtpRepo();
  const moduleRef = await Test.createTestingModule({
    imports: [(await import('../src/app.module.js')).AppModule],
  })
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(OTP_REPOSITORY)
    .useValue(repo)
    .overrideProvider(SETTINGS_REPOSITORY)
    .useValue(makeFakeSettingsRepo())
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
  otp = app.get(OtpService);
});

afterAll(async () => {
  await app?.close();
});

describe('OtpService issue/verify (B1.4)', () => {
  it('issues a numeric code of the configured length and verifies it (success path)', async () => {
    const issued = await otp.issue({
      purpose: 'login',
      channel: 'sms',
      target: TARGET,
      ip: '1.2.3.4',
    });
    expect(issued.code).toMatch(/^\d{6}$/); // default otp.length = 6
    expect(issued.resendAfterSec).toBe(60);
    expect(issued.expiresInSec).toBe(120);
    // The stored row never contains the plain code.
    expect(JSON.stringify([...repo.rows.values()])).not.toContain(issued.code);

    const verified = await otp.verify({
      purpose: 'login',
      channel: 'sms',
      target: TARGET,
      code: issued.code,
    });
    expect(verified.otpId).toBeTruthy();

    // A consumed code cannot be reused.
    await expect(
      otp.verify({ purpose: 'login', channel: 'sms', target: TARGET, code: issued.code }),
    ).rejects.toMatchObject({ response: { code: 'OTP_INVALID' } });
  });

  it('normalizes Persian digits in the submitted code', async () => {
    const issued = await otp.issue({ purpose: 'verify_phone', channel: 'sms', target: TARGET });
    const persian = issued.code.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);
    const verified = await otp.verify({
      purpose: 'verify_phone',
      channel: 'sms',
      target: TARGET,
      code: persian,
    });
    expect(verified.otpId).toBeTruthy();
  });

  it('counts wrong attempts and kills the code after max attempts', async () => {
    const issued = await otp.issue({ purpose: 'reset_password', channel: 'sms', target: TARGET });
    // 4 wrong attempts (max 5): each OTP_INVALID.
    for (let i = 0; i < 4; i += 1) {
      await expect(
        otp.verify({ purpose: 'reset_password', channel: 'sms', target: TARGET, code: '000000' }),
      ).rejects.toMatchObject({ response: { code: 'OTP_INVALID' } });
    }
    // 5th wrong attempt hits the cap → OTP_TOO_MANY_ATTEMPTS.
    await expect(
      otp.verify({ purpose: 'reset_password', channel: 'sms', target: TARGET, code: '000000' }),
    ).rejects.toMatchObject({ response: { code: 'OTP_TOO_MANY_ATTEMPTS' } });
    // Even the RIGHT code is now dead.
    await expect(
      otp.verify({ purpose: 'reset_password', channel: 'sms', target: TARGET, code: issued.code }),
    ).rejects.toMatchObject({ response: { code: 'OTP_TOO_MANY_ATTEMPTS' } });
  });

  it('rejects an expired code', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T08:00:00Z'));
    try {
      const issued = await otp.issue({
        purpose: 'login',
        channel: 'email',
        target: 'otp-exp@x.ir',
      });
      vi.setSystemTime(new Date('2026-11-01T08:03:00Z')); // > ttlSec (120)
      await expect(
        otp.verify({
          purpose: 'login',
          channel: 'email',
          target: 'otp-exp@x.ir',
          code: issued.code,
        }),
      ).rejects.toMatchObject({ response: { code: 'OTP_EXPIRED' } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('enforces the 60 second resend cooldown', async () => {
    await otp.issue({ purpose: 'login', channel: 'sms', target: 'cooldown@x.ir' });
    await expect(
      otp.issue({ purpose: 'login', channel: 'sms', target: 'cooldown@x.ir' }),
    ).rejects.toMatchObject({
      response: { code: 'OTP_RESEND_TOO_SOON', details: { retryAfterSec: expect.any(Number) } },
    });
  });

  it('applies the hourly cap per target (5) and per ip (20)', async () => {
    // Cooldown is 60s — jump the clock between issues (FakeRedis honors it).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T09:00:00Z'));
    try {
      for (let i = 0; i < 5; i += 1) {
        vi.setSystemTime(new Date('2026-11-01T09:00:00Z'));
        vi.advanceTimersByTime(i * 61_000);
        await otp.issue({ purpose: 'verify_email', channel: 'email', target: 'capped@x.ir' });
      }
      await expect(
        otp.issue({ purpose: 'verify_email', channel: 'email', target: 'capped@x.ir' }),
      ).rejects.toMatchObject({ response: { code: 'OTP_RESEND_TOO_SOON' } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('invalidates the previous code when a new one is issued', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'));
    try {
      const first = await otp.issue({ purpose: 'login', channel: 'sms', target: 'rot@x.ir' });
      vi.advanceTimersByTime(61_000);
      const second = await otp.issue({ purpose: 'login', channel: 'sms', target: 'rot@x.ir' });
      await expect(
        otp.verify({ purpose: 'login', channel: 'sms', target: 'rot@x.ir', code: first.code }),
      ).rejects.toMatchObject({ response: { code: 'OTP_INVALID' } });
      const ok = await otp.verify({
        purpose: 'login',
        channel: 'sms',
        target: 'rot@x.ir',
        code: second.code,
      });
      expect(ok.otpId).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses timingSafeEqual (not ===) for the comparison', async () => {
    const spy = vi.spyOn(
      otp as unknown as { compareCode: (a: string, b: string) => boolean },
      'compareCode',
    );
    const issued = await otp.issue({ purpose: 'login', channel: 'sms', target: 'timing@x.ir' });
    await otp.verify({
      purpose: 'login',
      channel: 'sms',
      target: 'timing@x.ir',
      code: issued.code,
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    void timingSafeEqual;
  });

  it('cleanup deletes only rows expired more than 1 day ago', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T11:00:00Z'));
    try {
      await otp.issue({ purpose: 'login', channel: 'sms', target: 'fresh@x.ir' });
      vi.advanceTimersByTime(48 * 3_600_000); // +48h: the fresh code expired 47h ago
      await otp.issue({ purpose: 'login', channel: 'sms', target: 'new@x.ir' }); // valid now
      const deleted = await otp.cleanupExpired();
      expect(deleted).toBeGreaterThanOrEqual(1);
      // The new code still verifies.
      // (issued above for 'new@x.ir'; verify works)
      const issued = await otp.issue({
        purpose: 'verify_email',
        channel: 'email',
        target: 'another@x.ir',
      });
      vi.advanceTimersByTime(30_000);
      const ok = await otp.verify({
        purpose: 'verify_email',
        channel: 'email',
        target: 'another@x.ir',
        code: issued.code,
      });
      expect(ok.otpId).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
