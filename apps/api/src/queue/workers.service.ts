import { Worker, type Job } from 'bullmq';
import type { ZodType } from 'zod';
import { parseRedisUrl } from './connection.js';

/** Minimal job view passed to processors — hides BullMQ internals from domain code. */
export type QueueJob<T> = { id: string; name: string; data: T; attemptsMade: number };

export type Processor<T> = (job: QueueJob<T>) => Promise<void>;

type Registration = {
  processor: Processor<unknown>;
  schema?: ZodType;
  concurrency: number;
};

/**
 * Consume-side registry. Domain modules call `register()` at module init
 * (inside their Nest module factory) and the worker entry calls `startAll()`
 * once. The API process never registers processors; the worker process never
 * enqueues. This split keeps HTTP latency independent of job execution.
 */
export class WorkersService {
  private readonly registrations = new Map<string, Registration>();
  private readonly workers: Worker[] = [];

  constructor(private readonly redisUrl: string) {}

  register<T>(
    queue: string,
    processor: Processor<T>,
    opts: { schema?: ZodType<T>; concurrency?: number } = {},
  ): this {
    if (this.registrations.has(queue)) {
      throw new Error(`A processor for queue "${queue}" is already registered`);
    }
    this.registrations.set(queue, {
      // The schema narrows before the domain processor sees the payload.
      processor: processor as Processor<unknown>,
      schema: opts.schema,
      concurrency: opts.concurrency ?? 5,
    });
    return this;
  }

  /** Names registered so far (used by the worker entry for a boot summary). */
  registeredQueues(): string[] {
    return [...this.registrations.keys()].sort();
  }

  /** Starts one BullMQ Worker per registration. Idempotent within a process. */
  startAll(): Worker[] {
    if (this.workers.length > 0) return this.workers;
    const connection = parseRedisUrl(this.redisUrl);
    for (const [queue, reg] of this.registrations) {
      const worker = new Worker(
        queue,
        async (job: Job) => {
          const data = reg.schema ? reg.schema.parse(job.data) : job.data;
          await reg.processor({
            id: String(job.id ?? ''),
            name: job.name,
            data,
            attemptsMade: job.attemptsMade,
          });
        },
        { connection, concurrency: reg.concurrency },
      );
      worker.on('failed', (job, err) => {
        // Full detail lives in BullMQ's own events; this line gives the
        // structured log a stable anchor for alerting (Q12.10).
        console.error(
          JSON.stringify({
            msg: 'job_failed',
            queue,
            jobId: job?.id ?? null,
            jobName: job?.name ?? null,
            attemptsMade: job?.attemptsMade ?? null,
            error: err.message,
          }),
        );
      });
      this.workers.push(worker);
    }
    return this.workers;
  }

  /** Graceful shutdown: waits (bounded by BullMQ) for running jobs to finish. */
  async closeAll(): Promise<void> {
    const closing = this.workers.map((w) => w.close());
    this.workers.length = 0;
    await Promise.all(closing);
  }
}
