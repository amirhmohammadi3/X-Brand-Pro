#!/usr/bin/env node
// scripts/services.mjs — cross-platform (Linux/macOS/Windows) manager for the
// dev Docker Compose services (db, redis, mailpit). No bash-only syntax.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const composeFile = path.join(repoRoot, 'infra', 'docker-compose.dev.yml');

/** @returns {boolean} true if `docker` exists on PATH and the daemon is up. */
function dockerAvailable() {
  try {
    const version = spawnSync('docker', ['--version'], { encoding: 'utf8' });
    if (version.status !== 0) return false;
    const info = spawnSync('docker', ['info'], { encoding: 'utf8' });
    return info.status === 0;
  } catch {
    return false;
  }
}

function composeArgs() {
  return ['-f', composeFile];
}

function run(/** @type {string[]} */ args, /** @type {object} */ opts = {}) {
  const result = spawnSync('docker', args, {
    stdio: opts.stdio ?? 'inherit',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    if (opts.allowFail) return result;
    process.exit(result.status ?? 1);
  }
  return result;
}

const [cmd, ...rest] = process.argv.slice(2);

function usage() {
  console.log(`Usage: pnpm services:<cmd>
Commands:
  up        start db, redis, mailpit, tiles (detached, waits for healthchecks)
  down      stop and remove containers (keeps data volumes)
  reset     stop, remove containers AND data volumes (destructive!)
  logs [s]  tail logs (optional service name: db | redis | mailpit)
  status    show container status`);
}

if (!cmd) {
  usage();
  process.exit(0);
}

if (!dockerAvailable()) {
  console.error('services: `docker` is not installed or the Docker daemon is not running.');
  console.error(
    '  Start Docker Desktop (Windows/macOS) or `sudo systemctl start docker` (Linux) and retry.',
  );
  process.exit(2);
}

switch (cmd) {
  case 'up': {
    run(['compose', ...composeArgs(), 'up', '-d', '--wait']);
    console.log('services: up. db on 5432, redis on 6379, mailpit UI on 8025.');
    break;
  }
  case 'down': {
    run(['compose', ...composeArgs(), 'down']);
    console.log('services: down. Data volumes preserved.');
    break;
  }
  case 'reset': {
    const yes = rest.includes('--yes') || rest.includes('-y');
    if (!yes) {
      process.stdout.write(
        'services: reset will DELETE all db and redis data. Type "yes" to continue: ',
      );
      const answer = readFileSync(0, 'utf8').trim().toLowerCase();
      if (answer !== 'yes') {
        console.log('services: reset cancelled.');
        process.exit(0);
      }
    }
    run(['compose', ...composeArgs(), 'down', '-v']);
    run(['compose', ...composeArgs(), 'up', '-d', '--wait']);
    console.log('services: reset complete.');
    break;
  }
  case 'logs': {
    const svc = rest[0];
    if (svc) run(['compose', ...composeArgs(), 'logs', '-f', svc]);
    else run(['compose', ...composeArgs(), 'logs', '-f']);
    break;
  }
  case 'status': {
    run(['compose', ...composeArgs(), 'ps']);
    break;
  }
  default:
    console.error(`services: unknown command "${cmd}"`);
    usage();
    process.exit(1);
}
