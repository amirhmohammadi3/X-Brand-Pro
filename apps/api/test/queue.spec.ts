import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { DEFAULT_JOB_OPTS, QueuesService } from '../src/queue/queues.service.js';
import { parseRedisUrl, mask, BLOCKING_CONNECTION_DEFAULTS } from '../src/queue/connection.js';
import { WorkersService } from '../src/queue/workers.service.js';
import type { Worker } from 'bullmq';

// Hoisted capture of BullMQ constructor calls — no live Redis needed.
const { queuesCreated, workersCreated } = vi.hoisted(() => ({
  queuesCreated: [] as Array<{ name: string; opts: Record<string, unknown> }>,
  workersCreated: [] as Array<{ name: string; processor: unknown; opts: Record<string, unknown> }>,
}));

vi.mock('bullmq', () => {
  class FakeQueue {
    name: string;
    opts: Record<string, unknown>;
    closed = false;
    constructor(name: string, opts: Record<string, unknown> = {}) {
      this.name = name;
      this.opts = opts;
      queuesCreated.push({ name, opts });
    }
    async add(jobName: string, data: unknown, jobOpts: Record<string, unknown>) {
      return { id: 'job-1', name: jobName, data, opts: jobOpts };
    }
    async close() {
      this.closed = true;
    }
  }
  class FakeWorker {
    name: string;
    processor: unknown;
    opts: Record<string, unknown>;
    closed = false;
    constructor(name: string, processor: unknown, opts: Record<string, unknown> = {}) {
      this.name = name;
      this.processor = processor;
      this.opts = opts;
      workersCreated.push({ name, processor, opts });
    }
    on(): this {
      return this;
    }
    async close() {
      this.closed = true;
    }
  }
  return { Queue: FakeQueue, Worker: FakeWorker };
});

const REDIS_URL = 'redis://:secret@localhost:6379/0';

describe('parseRedisUrl (B0.4)', () => {
  it('parses host, port, password and db', () => {
    const opts = parseRedisUrl('redis://:secret@localhost:6379/15');
    expect(opts).toEqual({
      host: 'localhost',
      port: 6379,
      password: 'secret',
      db: 15,
      ...BLOCKING_CONNECTION_DEFAULTS,
    });
  });

  it('defaults the port to 6379 and rejects non-redis protocols', () => {
    expect(parseRedisUrl('redis://localhost')).toMatchObject({ port: 6379 });
    expect(() => parseRedisUrl('postgres://localhost/x')).toThrow(/protocol/);
    expect(() => parseRedisUrl('not a url at all')).toThrow(/Invalid REDIS_URL/);
  });

  it('enables TLS for rediss:// and rejects non-integer db', () => {
    expect(parseRedisUrl('rediss://cache.example.com')).toMatchObject({ tls: {} });
    expect(() => parseRedisUrl('redis://localhost/abc')).toThrow(/database/);
  });

  it('mask() hides the password but keeps the rest', () => {
    expect(mask('redis://:hunter2@localhost:6379/0')).not.toContain('hunter2');
    expect(mask('redis://:hunter2@localhost:6379/0')).toContain('localhost:6379');
  });
});

describe('QueuesService (B0.4)', () => {
  beforeEach(() => {
    queuesCreated.length = 0;
  });

  it('creates one lazily-configured Queue per name and reuses it', async () => {
    const service = new QueuesService(REDIS_URL);
    await service.enqueue('mail', 'send', { to: 'a@b.c' });
    await service.enqueue('mail', 'send', { to: 'd@e.f' });
    await service.enqueue('analytics', 'record', { n: 1 });
    expect(queuesCreated.map((q) => q.name).sort()).toEqual(['analytics', 'mail']);
    const mail = queuesCreated.find((q) => q.name === 'mail');
    expect(mail?.opts.connection).toEqual(parseRedisUrl(REDIS_URL));
    expect(mail?.opts.defaultJobOptions).toEqual(DEFAULT_JOB_OPTS);
    await service.closeAll();
  });

  it('merges per-call options over the safe defaults', async () => {
    const service = new QueuesService(REDIS_URL);
    const spy = vi.spyOn(service.getQueue('mail'), 'add');
    await service.enqueue('mail', 'send', {}, { attempts: 7 });
    expect(spy).toHaveBeenCalledWith(
      'send',
      {},
      expect.objectContaining({ attempts: 7, backoff: DEFAULT_JOB_OPTS.backoff }),
    );
    await service.closeAll();
  });
});

describe('WorkersService (B0.4)', () => {
  let service: WorkersService;

  beforeEach(() => {
    workersCreated.length = 0;
    service = new WorkersService(REDIS_URL);
  });

  afterEach(async () => {
    await service.closeAll();
  });

  it('starts one worker per registration with parsed connection and concurrency', () => {
    service.register('mail', async () => undefined, { concurrency: 3 });
    service.register('analytics', async () => undefined);
    const workers = service.startAll() as unknown as FakeWorkerLike[];
    expect(workersCreated.map((w) => w.name).sort()).toEqual(['analytics', 'mail']);
    const mail = workersCreated.find((w) => w.name === 'mail');
    expect(mail?.opts.connection).toEqual(parseRedisUrl(REDIS_URL));
    expect(mail?.opts.concurrency).toBe(3);
    expect(workers.length).toBe(2);
  });

  it('startAll is idempotent within a process', () => {
    service.register('mail', async () => undefined);
    const first = service.startAll();
    const second = service.startAll();
    expect(second).toBe(first);
    expect(workersCreated.length).toBe(1);
  });

  it('rejects duplicate registrations for the same queue', () => {
    service.register('mail', async () => undefined);
    expect(() => service.register('mail', async () => undefined)).toThrow(/already registered/);
  });

  it('validates payloads with the registered zod schema before the processor runs', async () => {
    const schema = z.object({ to: z.string().email() }).strict();
    const processor = vi.fn(async () => undefined);
    service.register('mail', processor, { schema });
    const workers = service.startAll();
    const handler = (workers[0] as unknown as { processor: (job: unknown) => Promise<void> })
      .processor;
    await expect(
      handler({ id: '1', name: 'send', data: { to: 'not-an-email' }, attemptsMade: 0 }),
    ).rejects.toThrow();
    expect(processor).not.toHaveBeenCalled();
    await handler({ id: '2', name: 'send', data: { to: 'user@example.com' }, attemptsMade: 0 });
    expect(processor).toHaveBeenCalledWith(
      expect.objectContaining({ id: '2', data: { to: 'user@example.com' } }),
    );
  });

  it('closeAll closes every started worker exactly once', async () => {
    service.register('mail', async () => undefined);
    const workers = service.startAll() as unknown as FakeWorkerLike[];
    await service.closeAll();
    expect(workers.every((w) => w.closed)).toBe(true);
    // After closeAll the registry keeps its entries but the worker array is
    // cleared; starting again creates fresh workers for BOTH queues.
    service.register('analytics', async () => undefined);
    service.startAll();
    expect(workersCreated.length).toBe(3); // 1 (first start) + 2 (restarted)
  });
});

type FakeWorkerLike = Worker & { closed: boolean };
