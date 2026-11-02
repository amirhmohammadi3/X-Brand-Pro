#!/usr/bin/env node
// scripts/hourly-runner.mjs — self-contained hourly scheduler.
//
// The sandbox has no system crontab, no systemd timer and the cron tool is
// unavailable, so this long-lived Node process IS the scheduler. It is tiny,
// restart-safe and idempotent: read .phase-state.json every minute; at the top
// of each UTC hour (minute 0 or 1), run cron-driver once and persist its JSON
// brief to .phase-logs/next-brief.json for the next agent turn to consume.
//
// Overlap safety is delegated to cron-driver.mjs (pid-aware lock): this
// scheduler only decides WHEN to fire; cron-driver decides whether to skip
// (live previous pid), override (dead pid / stale lock) or acquire.
//
// Run:   nohup node scripts/hourly-runner.mjs > /tmp/hourly-runner.out 2>&1 &
//        (or under any process supervisor). Restart on box recycling.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CRON_DRIVER = path.join(REPO_ROOT, 'scripts', 'cron-driver.mjs');
const LOG_DIR = path.join(REPO_ROOT, '.phase-logs');
const LOG_FILE = path.join(LOG_DIR, 'hourly-runner.log');
const MARKER_FILE = path.join(LOG_DIR, 'last-fired.txt');
const BRIEF_FILE = path.join(LOG_DIR, 'next-brief.json');
const TICK_MS = 60 * 1000;

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

function log(line) {
  const ts = new Date().toISOString();
  const out = `[${ts}] ${line}`;
  console.log(out);
  try {
    appendFileSync(LOG_FILE, out + '\n');
  } catch {
    /* best effort */
  }
}

function lastFiredHour() {
  try {
    return readFileSync(MARKER_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

function currentHourKey(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}-${hh}`;
}

function fire() {
  log('FIRING cron-driver (hourly tick)');
  const res = spawnSync(process.execPath, [CRON_DRIVER], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.error) {
    log(`cron-driver spawn error: ${res.error.message}`);
    return;
  }
  const stdout = res.stdout || '';
  // cron-driver prints a single JSON object. Persist it for the agent turn.
  try {
    const brief = JSON.parse(stdout);
    writeFileSync(
      BRIEF_FILE,
      JSON.stringify({ fired_at: new Date().toISOString(), brief }, null, 2) + '\n',
    );
    log(
      `cron-driver action=${brief.action} phase=${brief.phase ?? '-'} next_prompt=${brief.next_prompt ?? '-'}; brief saved to ${BRIEF_FILE}`,
    );
  } catch {
    log(`cron-driver did not print JSON; stdout(400): ${stdout.slice(0, 400)}`);
  }
  if (res.stderr) log(`cron-driver stderr(400): ${res.stderr.slice(0, 400)}`);
}

log(`hourly-runner started; pid ${process.pid}; repo ${REPO_ROOT}`);
log(`checking every ${TICK_MS / 1000}s; fires once per UTC hour at HH:00 (±1 min)`);

function tick() {
  const now = new Date();
  const hourKey = currentHourKey(now);
  const minute = now.getUTCMinutes();
  const alreadyFired = lastFiredHour() === hourKey;
  if ((minute === 0 || minute === 1) && !alreadyFired) {
    try {
      writeFileSync(MARKER_FILE, hourKey);
    } catch {
      /* ignore */
    }
    fire();
  } else {
    // heartbeat every 10 minutes so the log shows it is alive
    if (minute % 10 === 0)
      log(`heartbeat; hourKey=${hourKey} alreadyFired=${alreadyFired} minute=${minute}`);
  }
}

tick();
setInterval(tick, TICK_MS);
setInterval(() => {}, 1 << 30); // keep alive
