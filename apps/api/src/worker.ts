#!/usr/bin/env node
// Worker process entry: consumes BullMQ queues. Runs SEPARATELY from the API
// process (`pnpm --filter @app/api dev:worker` / `node dist/src/worker.js`).
// Boots the same AppModule (so all DI-provided services exist), starts every
// registered processor, then waits for SIGTERM/SIGINT to drain gracefully.

import { NestFactory } from '@nestjs/core';
import { loadDotenvIntoProcessEnv } from './db/load-dotenv.js';
import { AppModule } from './app.module.js';
import { WORKERS_SERVICE } from './queue/queue.module.js';
import { type WorkersService } from './queue/workers.service.js';

async function bootstrap(): Promise<void> {
  loadDotenvIntoProcessEnv();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
    bufferLogs: false,
  });
  // Silence the default "Nest application successfully started" noise once.
  const workers = app.get<WorkersService>(WORKERS_SERVICE);
  workers.startAll();
  const queues = workers.registeredQueues();
  if (queues.length === 0) {
    process.stdout.write('[worker] no processors registered yet — idling\n');
  } else {
    process.stdout.write(`[worker] consuming queues: ${queues.join(', ')}\n`);
  }

  // Keep the process alive even with zero registered processors: deployment
  // platforms restart an exited worker container in a loop, and an idle
  // worker is the correct steady state until a prompt registers one. BullMQ
  // workers hold the loop themselves once started; this interval only covers
  // the empty case. Cleared by process.exit() in shutdown().
  const KEEP_ALIVE_MS = 60 * 60 * 1000;
  const keepAlive = setInterval(() => undefined, KEEP_ALIVE_MS);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(keepAlive);
    process.stdout.write(`[worker] ${signal} received — draining jobs and closing\n`);
    try {
      await workers.closeAll();
      await app.close();
      process.stdout.write('[worker] goodbye\n');
      process.exit(0);
    } catch (err) {
      process.stderr.write(
        `[worker] shutdown error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err: unknown) => {
  process.stderr.write(
    `[worker] failed to start: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
