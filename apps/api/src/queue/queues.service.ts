import { Queue, type JobsOptions } from 'bullmq';
import { parseRedisUrl } from './connection.js';

/**
 * Defaults for every job the app enqueues. Later prompts may override per
 * call, but safe retention + bounded retries must be the baseline: failed
 * side effects are retried with exponential backoff, completed jobs age out
 * after 24h (keep the newest 1000), failed jobs are kept 7 days for
 * inspection, then removed.
 */
export const DEFAULT_JOB_OPTS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 24 * 3_600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3_600 },
};

/**
 * Enqueue-side API: one BullMQ Queue per queue name, created lazily from the
 * Redis URL. Enqueuing never starts a connection before the first job.
 */
export class QueuesService {
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly redisUrl: string) {}

  /** Adds a job and returns its id. Never used for HTTP request paths — services call this from event subscribers. */
  async enqueue(queue: string, name: string, data: unknown, opts?: JobsOptions): Promise<string> {
    const q = this.getQueue(queue);
    const job = await q.add(name, data, { ...DEFAULT_JOB_OPTS, ...opts });
    return String(job.id ?? '');
  }

  async closeAll(): Promise<void> {
    const closing = [...this.queues.values()].map((q) => q.close());
    this.queues.clear();
    await Promise.all(closing);
  }

  /** Exposed for tests and for the worker entry to assert queue existence. */
  getQueue(queue: string): Queue {
    const existing = this.queues.get(queue);
    if (existing) return existing;
    const created = new Queue(queue, {
      connection: parseRedisUrl(this.redisUrl),
      defaultJobOptions: DEFAULT_JOB_OPTS,
    });
    this.queues.set(queue, created);
    return created;
  }
}
