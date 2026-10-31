import { Queue, Worker, type Job } from 'bullmq';
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
  private readonly repeatables: Array<{
    queue: string;
    name: string;
    data: unknown;
    everyMs: number;
  }> = [];
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

  /**
   * Declare a REPEATABLE job (B1.4): when startAll() runs (worker process
   * only), the schedule is upserted on the queue — BullMQ deduplicates by
   * (queue, name, repeat config), so re-registering on every boot is safe.
   * The processor for the queue is registered with register() as usual and
   * switches on `job.name`.
   */
  registerRepeatable(queue: string, name: string, data: unknown, everyMs: number): this {
    this.repeatables.push({ queue, name, data, everyMs });
    return this;
  }

  private async upsertRepeatable(
    repeatable: { queue: string; name: string; data: unknown; everyMs: number },
    connection: ReturnType<typeof parseRedisUrl>,
  ): Promise<void> {
    // BullMQ 6: repeating jobs are managed via job SCHEDULERS, not `repeat`
    // in JobsOptions. The scheduler id is the job name — upsert is idempotent.
    const queue = new Queue(repeatable.queue, { connection });
    try {
      await queue.upsertJobScheduler(
        repeatable.name,
        { every: repeatable.everyMs },
        {
          name: repeatable.name,
          data: repeatable.data as object,
        },
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          msg: 'repeatable_upsert_failed',
          queue: repeatable.queue,
          jobName: repeatable.name,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      await queue.close().catch(() => {});
    }
  }

  /** Starts one BullMQ Worker per registration. Idempotent within a process. */
  startAll(): Worker[] {
    if (this.workers.length > 0) return this.workers;
    const connection = parseRedisUrl(this.redisUrl);

    // Upsert repeatable schedules (worker boot only). Fire-and-forget: a
    // missed first tick is harmless (the next interval tick runs the job),
    // and keeping startAll() synchronous preserves the B0.4 contract.
    for (const repeatable of this.repeatables) {
      void this.upsertRepeatable(repeatable, connection);
    }

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
