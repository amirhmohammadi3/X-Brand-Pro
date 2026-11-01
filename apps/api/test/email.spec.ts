import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnrecoverableError } from 'bullmq';

const transporterMocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  createTransport: transporterMocks.createTransport,
}));

import { SmtpDriver } from '../src/modules/email/drivers/smtp.driver.js';
import {
  EmailProviderError,
  isRetryableEmailCause,
  toEmailProviderError,
} from '../src/modules/email/email.driver.js';
import { EmailService, mailJobOpts, MAIL_QUEUE } from '../src/modules/email/email.service.js';
import { SmtpHealthIndicator } from '../src/modules/email/smtp.health.js';
import type { SmtpConfig } from '../src/modules/email/email-credentials.service.js';
import type { EmailCredentialsService } from '../src/modules/email/email-credentials.service.js';

// ---------------------------------------------------------------------------
// Helpers

function smtpConfig(overrides: Partial<SmtpConfig> = {}): SmtpConfig {
  return {
    host: 'localhost',
    port: 1025,
    secure: false,
    user: '',
    password: '',
    fromAddress: 'no-reply@localhost',
    fromName: 'Test',
    ...overrides,
  };
}

function fakeCredentials(config: SmtpConfig): EmailCredentialsService {
  return {
    smtp: async () => config,
    siteLocale: async () => 'fa' as const,
  } as unknown as EmailCredentialsService;
}

function fakeTransport() {
  return {
    sendMail: vi.fn(async () => ({ messageId: '<msg-1@localhost>' })),
    verify: vi.fn(async () => true),
    close: vi.fn(async () => undefined),
  };
}

interface DriverFixture {
  driver: SmtpDriver;
  transport: ReturnType<typeof fakeTransport>;
}

function mutableCredentials(): { creds: EmailCredentialsService; set: (c: SmtpConfig) => void } {
  let current = smtpConfig();
  const creds = {
    smtp: async () => current,
    siteLocale: async () => 'fa' as const,
  } as unknown as EmailCredentialsService;
  return { creds, set: (c) => (current = c) };
}

function makeDriver(config: SmtpConfig): DriverFixture {
  const transport = fakeTransport();
  transporterMocks.createTransport.mockImplementation(() => transport);
  return { driver: new SmtpDriver(fakeCredentials(config)), transport };
}

// ---------------------------------------------------------------------------

describe('SmtpDriver (B1.6, nodemailer mocked)', () => {
  beforeEach(() => {
    transporterMocks.createTransport.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends through a pooled transport and returns the provider message id', async () => {
    const { driver, transport } = makeDriver(smtpConfig());
    const result = await driver.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Hello',
        from: { address: 'no-reply@localhost', name: 'Test' },
      }),
    );
    expect(result).toEqual({ providerMessageId: '<msg-1@localhost>' });
  });

  it('reuses one transport while settings are unchanged, rebuilds on change', async () => {
    const { creds, set } = mutableCredentials();
    const first = fakeTransport();
    transporterMocks.createTransport.mockImplementation(() => first);
    const driver = new SmtpDriver(creds);
    const mail = { subject: 's', html: '<p></p>', text: '' };
    await driver.send({ to: 'a@example.com', ...mail });
    await driver.send({ to: 'b@example.com', ...mail });
    expect(transporterMocks.createTransport).toHaveBeenCalledTimes(1);
    expect(transporterMocks.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'localhost', port: 1025, secure: false, pool: true }),
    );

    // Admin edits the SMTP settings → same driver rebuilds its transport and
    // closes the stale pooled connection.
    set(smtpConfig({ host: 'smtp.example.com', user: 'u', password: 'p' }));
    const second = fakeTransport();
    transporterMocks.createTransport.mockImplementation(() => second);
    await driver.send({ to: 'c@example.com', ...mail });
    expect(transporterMocks.createTransport).toHaveBeenCalledTimes(2);
    expect(transporterMocks.createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ host: 'smtp.example.com', auth: { user: 'u', pass: 'p' } }),
    );
    expect(first.close).toHaveBeenCalled();
  });

  it('classifies SMTP 5xx as permanent, 4xx and connection errors as retryable', async () => {
    const { driver, transport } = makeDriver(smtpConfig());

    transport.sendMail.mockRejectedValueOnce(
      Object.assign(new Error('mailbox unavailable'), { responseCode: 550 }),
    );
    await expect(
      driver.send({ to: 'x@example.com', subject: 's', html: '', text: '' }),
    ).rejects.toMatchObject({
      name: 'EmailProviderError',
      retryable: false,
      providerCode: 'SMTP_550',
    });

    transport.sendMail.mockRejectedValueOnce(
      Object.assign(new Error('try again later'), { responseCode: 421 }),
    );
    await expect(
      driver.send({ to: 'x@example.com', subject: 's', html: '', text: '' }),
    ).rejects.toMatchObject({ retryable: true, providerCode: 'SMTP_421' });

    transport.sendMail.mockRejectedValueOnce(
      Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }),
    );
    await expect(
      driver.send({ to: 'x@example.com', subject: 's', html: '', text: '' }),
    ).rejects.toMatchObject({ retryable: true, providerCode: 'ECONNREFUSED' });

    transport.sendMail.mockRejectedValueOnce(
      Object.assign(new Error('bad credentials'), { code: 'EAUTH' }),
    );
    await expect(
      driver.send({ to: 'x@example.com', subject: 's', html: '', text: '' }),
    ).rejects.toMatchObject({ retryable: false, providerCode: 'EAUTH' });
  });

  it('caches verify() for 60 seconds (health indicator probe)', async () => {
    const { driver, transport } = makeDriver(smtpConfig());
    expect(await driver.verify(1_000)).toBe(true);
    expect(await driver.verify(30_000)).toBe(true);
    expect(transport.verify).toHaveBeenCalledTimes(1); // cached
    expect(await driver.verify(61_000)).toBe(true);
    expect(transport.verify).toHaveBeenCalledTimes(2); // expired → fresh probe
  });

  it('verify() reports false (not throw) when the server is unreachable', async () => {
    const { driver, transport } = makeDriver(smtpConfig());
    transport.verify.mockRejectedValueOnce(
      Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
    );
    expect(await driver.verify(1_000)).toBe(false);
  });
});

describe('email error mapping (B1.6)', () => {
  it('toEmailProviderError passes through classified errors', () => {
    const original = new EmailProviderError('boom', true, 'X');
    expect(toEmailProviderError(original)).toBe(original);
  });

  it('isRetryableEmailCause honours the flag and rejects unknown causes', () => {
    expect(isRetryableEmailCause(new EmailProviderError('t', true))).toBe(true);
    expect(isRetryableEmailCause(new EmailProviderError('p', false))).toBe(false);
    expect(isRetryableEmailCause(new Error('mystery'))).toBe(false);
  });
});

describe('EmailService (B1.6, fake driver + recorded queue)', () => {
  class FakeDriver {
    readonly name = 'fake';
    sent: Array<{ to: string; subject: string; html: string; text: string }> = [];
    failure: Error | null = null;
    async send(mail: { to: string; subject: string; html: string; text: string }) {
      if (this.failure) throw this.failure;
      this.sent.push(mail);
      return { providerMessageId: 'fake-1' };
    }
  }

  function makeService() {
    const driver = new FakeDriver();
    const enqueue = vi.fn(async () => 'job-1');
    const email = new EmailService(driver as never, fakeCredentials(smtpConfig()), {
      enqueue,
    } as never);
    return { email, driver, enqueue };
  }

  it('enqueues on the mail queue with 5 attempts and 15s exponential backoff', async () => {
    const { email, enqueue } = makeService();
    const { jobId } = await email.send({
      to: 'user@example.com',
      template: 'welcome',
      locale: 'fa',
      vars: { name: 'امیر' },
    });
    expect(jobId).toBe('job-1');
    expect(enqueue).toHaveBeenCalledWith(
      MAIL_QUEUE,
      'send',
      expect.objectContaining({ to: 'user@example.com', template: 'welcome', locale: 'fa' }),
      expect.objectContaining({ attempts: 5, backoff: { type: 'exponential', delay: 15_000 } }),
    );
  });

  it('removes otp jobs on completion so codes never linger in Redis', async () => {
    const { email, enqueue } = makeService();
    await email.send({ to: 'user@example.com', template: 'otp', vars: { code: '123456' } });
    const opts = (enqueue.mock.calls as unknown as unknown[][])[0]?.[3] as
      | Record<string, unknown>
      | undefined;
    expect(opts?.['removeOnComplete']).toBe(true);
    // non-otp templates keep the default retention instead
    expect(mailJobOpts('generic').removeOnComplete).not.toBe(true);
  });

  it('rejects invalid or multi recipients before enqueueing', async () => {
    const { email, enqueue } = makeService();
    await expect(email.send({ to: 'not-an-email', template: 'welcome' })).rejects.toThrow();
    await expect(
      email.send({ to: 'a@example.com,b@example.com', template: 'welcome' }),
    ).rejects.toThrow();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('deliver() renders with the site locale fallback and sends via the driver', async () => {
    const { email, driver } = makeService();
    await email.deliver({
      to: 'user@example.com',
      template: 'generic',
      locale: '',
      vars: { title: 'سلام', body: 'متن' },
    });
    expect(driver.sent[0]?.html).toContain('dir="rtl"');
    expect(driver.sent[0]?.subject).toBe('سلام');
  });

  it('deliver() rethrows retryable failures and wraps permanent ones in UnrecoverableError', async () => {
    const { email, driver } = makeService();
    driver.failure = new EmailProviderError('temp', true, 'SMTP_421');
    await expect(
      email.deliver({ to: 'user@example.com', template: 'welcome', locale: 'en', vars: {} }),
    ).rejects.toBe(driver.failure);

    driver.failure = new EmailProviderError('perm', false, 'SMTP_550');
    await expect(
      email.deliver({ to: 'user@example.com', template: 'welcome', locale: 'en', vars: {} }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('sendNow() returns ok with the message id, or ok:false with an errorCode', async () => {
    const { email, driver } = makeService();
    const ok = await email.sendNow('user@example.com', { title: 'T', body: 'B' });
    expect(ok).toEqual({ ok: true, providerMessageId: 'fake-1' });

    driver.failure = new EmailProviderError('nope', false, 'SMTP_550');
    const fail = await email.sendNow('user@example.com', { title: 'T', body: 'B' });
    expect(fail).toEqual({ ok: false, errorCode: 'SMTP_550' });
  });
});

describe('health indicators (B1.6)', () => {
  it('SmtpHealthIndicator maps verify() to ok/down and is non-critical', async () => {
    const driver = { verify: vi.fn(async () => true) } as unknown as SmtpDriver;
    const indicator = new SmtpHealthIndicator(driver);
    expect(indicator.critical).toBe(false);
    expect(indicator.name).toBe('smtp');
    await expect(indicator.check()).resolves.toBe('ok');
    (driver.verify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    await expect(indicator.check()).resolves.toBe('down');
  });
});
