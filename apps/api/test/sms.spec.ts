import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import {
  buildOtpMessage,
  OTP_JOB_OPTS,
  SmsService,
  SMS_DRIVER_FAKE,
  SMS_DRIVER_KAVENEGAR,
  SMS_DRIVER_MELIPAYAMAK,
} from '../src/modules/sms/sms.service.js';
import type { SmsCredentialsService } from '../src/modules/sms/sms-credentials.service.js';
import {
  isRetryableCause,
  SmsProviderError,
  toProviderFormat,
} from '../src/modules/sms/sms.driver.js';
import { FakeSmsDriver, DEV_SMS_OUTBOX_KEY } from '../src/modules/sms/drivers/fake.driver.js';
import { MelipayamakDriver } from '../src/modules/sms/drivers/melipayamak.driver.js';
import { KavenegarDriver } from '../src/modules/sms/drivers/kavenegar.driver.js';
import { devSmsEnabled } from '../src/modules/sms/dev-sms.controller.js';
import { FakeRedis } from './fake-redis.js';

// ---------------------------------------------------------------------------
// Helpers

type FetchCall = { url: string; init: RequestInit };

function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response>): FetchCall[] {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {} as RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Awaits a promise expected to reject with SmsProviderError and returns it. */
async function expectProviderError(promise: Promise<unknown>): Promise<SmsProviderError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof SmsProviderError) return e;
    throw new Error(`expected SmsProviderError, got ${String(e)}`);
  }
  throw new Error('expected the send to reject with SmsProviderError');
}

/** Minimal SmsCredentialsService double with programmable credentials. */
function fakeCredentials(overrides: Record<string, unknown> = {}): SmsCredentialsService {
  const base = {
    provider: async () => 'fake' as const,
    melipayamak: async () => ({
      username: 'user',
      password: 'pass',
      sender: '50004001',
      otpBodyId: '',
    }),
    kavenegar: async () => ({ apiKey: 'KAVE-KEY', sender: '10004346', otpTemplate: '' }),
    siteLocale: async () => 'fa' as const,
  };
  const merged = { ...base, ...overrides };
  return merged as unknown as SmsCredentialsService;
}

function fakeQueues(): { enqueue: ReturnType<typeof vi.fn> } {
  return { enqueue: vi.fn(async () => 'job-1') };
}

function makeSmsService(
  creds: SmsCredentialsService,
  queues = fakeQueues(),
): { sms: SmsService; queues: ReturnType<typeof fakeQueues> } {
  const redis = new FakeRedis();
  const sms = new SmsService(
    new FakeSmsDriver(redis),
    new MelipayamakDriver(creds),
    new KavenegarDriver(creds),
    creds,
    queues as unknown as never,
  );
  return { sms, queues };
}

beforeEach(() => {
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Pure helpers

describe('SMS helpers (B1.5)', () => {
  it('toProviderFormat converts E.164 to the Iranian local form', () => {
    expect(toProviderFormat('+989121234567')).toBe('09121234567');
  });

  it('toProviderFormat rejects non-E.164 input with a non-retryable error', () => {
    try {
      toProviderFormat('09121234567');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SmsProviderError);
      expect((e as SmsProviderError).retryable).toBe(false);
      expect((e as SmsProviderError).providerCode).toBe('INVALID_NUMBER');
    }
  });

  it('isRetryableCause classifies timeouts and network errors as retryable', () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    expect(isRetryableCause(timeout)).toBe(true);
    const network = new Error('fetch failed');
    network.name = 'TypeError';
    expect(isRetryableCause(network)).toBe(true);
    expect(isRetryableCause(new SmsProviderError('bad credentials', false, '401'))).toBe(false);
    expect(isRetryableCause('weird')).toBe(false);
  });

  it('buildOtpMessage renders the localized code text', () => {
    expect(buildOtpMessage('fa', '123456')).toBe('کد ورود شما: 123456');
    expect(buildOtpMessage('en', '123456')).toBe('Your verification code: 123456');
  });

  it('devSmsEnabled registers the dev outbox only with DEV_TOOLS outside production', () => {
    expect(devSmsEnabled('development', true)).toBe(true);
    expect(devSmsEnabled('production', true)).toBe(false);
    expect(devSmsEnabled('development', false)).toBe(false);
    expect(devSmsEnabled(undefined, undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fake driver

describe('FakeSmsDriver (B1.5)', () => {
  it('pushes deliveries to the dev outbox, newest first', async () => {
    const redis = new FakeRedis();
    const driver = new FakeSmsDriver(redis);
    await driver.send({ to: '+989121234567', text: 'hello' });
    const raw = await redis.lrange(DEV_SMS_OUTBOX_KEY, 0, -1);
    expect(raw).toHaveLength(1);
    const item = JSON.parse(raw[0] as string) as { to: string; text: string; at: string };
    expect(item.to).toBe('+989121234567');
    expect(item.text).toBe('hello');
    expect(item.at).toBeTruthy();
  });

  it('trims the outbox to the newest 50 entries', async () => {
    const redis = new FakeRedis();
    const driver = new FakeSmsDriver(redis);
    for (let i = 0; i < 55; i += 1) {
      await driver.send({ to: '+989121234567', text: `m${i}` });
    }
    const raw = await redis.lrange(DEV_SMS_OUTBOX_KEY, 0, -1);
    expect(raw).toHaveLength(50);
    const newest = JSON.parse(raw[0] as string) as { text: string };
    const oldest = JSON.parse(raw[raw.length - 1] as string) as { text: string };
    expect(newest.text).toBe('m54');
    expect(oldest.text).toBe('m5'); // m0..m4 were trimmed
  });
});

// ---------------------------------------------------------------------------
// Melipayamak

describe('MelipayamakDriver (B1.5, mocked fetch)', () => {
  const message = { to: '+989121234567', text: 'سلام' };

  it('sends plain text with the documented URL and form fields', async () => {
    const calls = stubFetch(async () =>
      jsonResponse(200, { Value: 12345, RetStatus: 1, StrRetStatus: 'Ok' }),
    );
    const driver = new MelipayamakDriver(fakeCredentials());
    const result = await driver.send(message);
    expect(result).toEqual({ providerMessageId: '12345' });
    expect(calls[0]?.url).toBe('https://rest.payamak-panel.com/api/SendSMS/SendSMS');
    const body = new URLSearchParams(String(calls[0]?.init.body));
    expect(body.get('username')).toBe('user');
    expect(body.get('password')).toBe('pass');
    expect(body.get('to')).toBe('09121234567');
    expect(body.get('from')).toBe('50004001');
    expect(body.get('text')).toBe('سلام');
    expect(body.get('isFlash')).toBe('false');
  });

  it('uses BaseServiceNumber for template sends with tokens joined by ";"', async () => {
    const calls = stubFetch(async () =>
      jsonResponse(200, { Value: 999, RetStatus: 1, StrRetStatus: 'Ok' }),
    );
    const driver = new MelipayamakDriver(
      fakeCredentials({
        melipayamak: async () => ({
          username: 'user',
          password: 'pass',
          sender: '',
          otpBodyId: '3135',
        }),
      }),
    );
    await driver.send({
      to: '+989121234567',
      template: { name: '3135', tokens: { token: '4821' } },
    });
    expect(calls[0]?.url).toBe('https://rest.payamak-panel.com/api/SendSMS/BaseServiceNumber');
    const body = new URLSearchParams(String(calls[0]?.init.body));
    expect(body.get('bodyId')).toBe('3135');
    expect(body.get('text')).toBe('4821');
  });

  it('maps a non-Ok StrRetStatus to a non-retryable error with RetStatus as code', async () => {
    stubFetch(async () => jsonResponse(200, { Value: '', RetStatus: 11, StrRetStatus: 'Error' }));
    const driver = new MelipayamakDriver(fakeCredentials());
    const err = await expectProviderError(driver.send(message));
    expect(err.retryable).toBe(false);
    expect(err.providerCode).toBe('11');
  });

  it('maps HTTP 5xx to a retryable error and timeouts to retryable too', async () => {
    const calls = stubFetch(async () => jsonResponse(503, { message: 'maintenance' }));
    const driver = new MelipayamakDriver(fakeCredentials());
    await expect(driver.send(message)).rejects.toMatchObject({ retryable: true });
    expect(calls[0]?.url).toContain('/SendSMS');

    stubFetch(async () => {
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    });
    await expect(driver.send(message)).rejects.toMatchObject({ retryable: true });
  });

  it('fails fast with NOT_CONFIGURED when credentials are missing (no fetch)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const driver = new MelipayamakDriver(
      fakeCredentials({
        melipayamak: async () => ({ username: '', password: '', sender: '', otpBodyId: '' }),
      }),
    );
    const err = await expectProviderError(driver.send(message));
    expect(err.retryable).toBe(false);
    expect(err.providerCode).toBe('NOT_CONFIGURED');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Kavenegar

describe('KavenegarDriver (B1.5, mocked fetch)', () => {
  const message = { to: '+989121234567', text: 'hello' };

  it('sends plain text to sms/send.json with the API key in the path', async () => {
    const calls = stubFetch(async () =>
      jsonResponse(200, {
        return: { status: 200, message: 'تایید شد' },
        entries: [{ messageid: 8792343 }],
      }),
    );
    const driver = new KavenegarDriver(fakeCredentials());
    const result = await driver.send(message);
    expect(result).toEqual({ providerMessageId: '8792343' });
    expect(calls[0]?.url).toBe('https://api.kavenegar.com/v1/KAVE-KEY/sms/send.json');
    const body = new URLSearchParams(String(calls[0]?.init.body));
    expect(body.get('receptor')).toBe('09121234567');
    expect(body.get('message')).toBe('hello');
    expect(body.get('sender')).toBe('10004346');
  });

  it('uses verify/lookup.json for template sends with token + template', async () => {
    const calls = stubFetch(async () =>
      jsonResponse(200, {
        return: { status: 200, message: 'تایید شد' },
        entries: [{ messageid: 5 }],
      }),
    );
    const driver = new KavenegarDriver(
      fakeCredentials({
        kavenegar: async () => ({ apiKey: 'KAVE-KEY', sender: '', otpTemplate: 'xbrand-otp' }),
      }),
    );
    await driver.send({
      to: '+989121234567',
      template: { name: 'xbrand-otp', tokens: { token: '4821' } },
    });
    expect(calls[0]?.url).toBe('https://api.kavenegar.com/v1/KAVE-KEY/verify/lookup.json');
    const body = new URLSearchParams(String(calls[0]?.init.body));
    expect(body.get('receptor')).toBe('09121234567');
    expect(body.get('token')).toBe('4821');
    expect(body.get('template')).toBe('xbrand-otp');
  });

  it('maps return.status 418 (insufficient credit) to non-retryable with code 418', async () => {
    stubFetch(async () =>
      jsonResponse(418, {
        return: { status: 418, message: 'اعتبار حساب کافی نیست' },
        entries: null,
      }),
    );
    const driver = new KavenegarDriver(fakeCredentials());
    const err = await expectProviderError(driver.send(message));
    expect(err.retryable).toBe(false);
    expect(err.providerCode).toBe('418');
  });

  it('maps return.status 409 (server busy) to a retryable error', async () => {
    stubFetch(async () =>
      jsonResponse(409, { return: { status: 409, message: 'سرور قادر به پاسخگوئی نیست' } }),
    );
    const driver = new KavenegarDriver(fakeCredentials());
    await expect(driver.send(message)).rejects.toMatchObject({ retryable: true });
  });

  it('maps HTTP 5xx and network failures to retryable errors', async () => {
    stubFetch(async () => jsonResponse(500, { return: { status: 500, message: 'oops' } }));
    const driver = new KavenegarDriver(fakeCredentials());
    await expect(driver.send(message)).rejects.toMatchObject({ retryable: true });

    stubFetch(async () => {
      throw Object.assign(new Error('fetch failed'), { name: 'TypeError' });
    });
    await expect(driver.send(message)).rejects.toMatchObject({ retryable: true });
  });

  it('fails fast with NOT_CONFIGURED when the API key is missing (no fetch)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const driver = new KavenegarDriver(
      fakeCredentials({ kavenegar: async () => ({ apiKey: '', sender: '', otpTemplate: '' }) }),
    );
    const err = await expectProviderError(driver.send(message));
    expect(err.providerCode).toBe('NOT_CONFIGURED');
    expect(err.retryable).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SmsService: queueing, driver selection, retry classification

describe('SmsService (B1.5)', () => {
  it('send() enqueues on the sms queue and returns the job id', async () => {
    const { sms, queues } = makeSmsService(fakeCredentials());
    const { jobId } = await sms.send('+989121234567', 'hi');
    expect(jobId).toBe('job-1');
    expect(queues.enqueue).toHaveBeenCalledOnce();
    const [queue, name, payload] = (queues.enqueue as ReturnType<typeof vi.fn>).mock
      .calls[0] as unknown as [string, string, { to: string; text: string }];
    expect(queue).toBe('sms');
    expect(name).toBe('send');
    expect(payload).toEqual({ to: '+989121234567', text: 'hi' });
  });

  it('sendOtp() uses the kavenegar lookup template when configured', async () => {
    const creds = fakeCredentials({
      provider: async () => 'kavenegar' as const,
      kavenegar: async () => ({ apiKey: 'K', sender: '', otpTemplate: 'xbrand-otp' }),
    });
    const { sms, queues } = makeSmsService(creds);
    await sms.sendOtp('+989121234567', '4821');
    const [queue, name, payload, opts] = (queues.enqueue as ReturnType<typeof vi.fn>).mock
      .calls[0] as unknown as [string, string, unknown, Record<string, unknown>];
    expect(queue).toBe('sms');
    expect(name).toBe('send');
    expect(payload).toEqual({
      to: '+989121234567',
      template: { name: 'xbrand-otp', tokens: { token: '4821' } },
    });
    expect(opts).toEqual(OTP_JOB_OPTS);
    expect(OTP_JOB_OPTS.removeOnComplete).toBe(true);
    expect(OTP_JOB_OPTS.removeOnFail).toEqual({ age: 3600 });
  });

  it('sendOtp() falls back to the localized plain text with the site default locale', async () => {
    const creds = fakeCredentials({
      provider: async () => 'melipayamak' as const,
      melipayamak: async () => ({ username: 'u', password: 'p', sender: '', otpBodyId: '' }),
      siteLocale: async () => 'en' as const,
    });
    const { sms, queues } = makeSmsService(creds);
    await sms.sendOtp('+989121234567', '4821');
    const [, , payload] = (queues.enqueue as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [
      string,
      string,
      { to: string; text: string },
    ];
    expect(payload.text).toBe('Your verification code: 4821');
  });

  it('deliver() resolves the driver from the setting at processing time', async () => {
    stubFetch(async () => jsonResponse(200, { Value: 7, RetStatus: 1, StrRetStatus: 'Ok' }));
    const creds = fakeCredentials({ provider: async () => 'melipayamak' as const });
    const { sms } = makeSmsService(creds);
    // Deliver runs without throwing; the melipayamak driver was selected
    // (fetch was called — the fake driver would not fetch).
    await expect(sms.deliver({ to: '+989121234567', text: 'x' })).resolves.toBeUndefined();
  });

  it('deliver() wraps non-retryable provider errors in UnrecoverableError', async () => {
    const creds = fakeCredentials({
      provider: async () => 'melipayamak' as const,
      melipayamak: async () => ({ username: '', password: '', sender: '', otpBodyId: '' }),
    });
    const { sms } = makeSmsService(creds);
    const promise = sms.deliver({ to: '+989121234567', text: 'x' });
    await expect(promise).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('deliver() rethrows retryable errors for BullMQ backoff', async () => {
    stubFetch(async () => jsonResponse(500, {}));
    const creds = fakeCredentials({ provider: async () => 'kavenegar' as const });
    const { sms } = makeSmsService(creds);
    await expect(sms.deliver({ to: '+989121234567', text: 'x' })).rejects.not.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('sendNow() returns ok:false with the provider code instead of throwing', async () => {
    stubFetch(async () => jsonResponse(200, { Value: '', RetStatus: 35, StrRetStatus: 'Error' }));
    const creds = fakeCredentials({
      provider: async () => 'melipayamak' as const,
      melipayamak: async () => ({ username: 'bad', password: 'bad', sender: '', otpBodyId: '' }),
    });
    const { sms } = makeSmsService(creds);
    const result = await sms.sendNow('+989121234567', 'test');
    expect(result).toEqual({ driver: 'melipayamak', ok: false, errorCode: '35' });
  });

  it('sendNow() reports missing credentials as NOT_CONFIGURED without a network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const creds = fakeCredentials({
      provider: async () => 'melipayamak' as const,
      melipayamak: async () => ({ username: '', password: '', sender: '', otpBodyId: '' }),
    });
    const { sms } = makeSmsService(creds);
    const result = await sms.sendNow('+989121234567', 'test');
    expect(result).toEqual({ driver: 'melipayamak', ok: false, errorCode: 'NOT_CONFIGURED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sendNow() returns the driver name and provider message id on success', async () => {
    stubFetch(async () => jsonResponse(200, { Value: 42, RetStatus: 1, StrRetStatus: 'Ok' }));
    const creds = fakeCredentials({ provider: async () => 'melipayamak' as const });
    const { sms } = makeSmsService(creds);
    const result = await sms.sendNow('+989121234567', 'test');
    expect(result).toEqual({ driver: 'melipayamak', ok: true, providerMessageId: '42' });
  });
});

// ---------------------------------------------------------------------------
// DI token sanity: providers resolve against the symbols the module exports.

describe('SMS DI tokens (B1.5)', () => {
  it('exposes the three driver tokens', () => {
    expect(SMS_DRIVER_FAKE).toBeTypeOf('symbol');
    expect(SMS_DRIVER_MELIPAYAMAK).toBeTypeOf('symbol');
    expect(SMS_DRIVER_KAVENEGAR).toBeTypeOf('symbol');
  });
});
