#!/usr/bin/env node
// scripts/orchestrator.mjs — phase state machine for the X-Brand-Pro build.
//
// The orchestrator is the single source of truth for "which phase are we on,
// is it still running, what should the next cron-fired agent do?". It is
// invoked by the hourly cron and by hand.
//
// State file: .phase-state.json (gitignored, lives in the repo root)
// Lock file:  .phase-lock (gitignored, contains pid + timestamp)
//
// Commands:
//   node scripts/orchestrator.mjs status            print current state + exit
//   node scripts/orchestrator.mjs acquire           acquire the lock + mark current phase "running"; print the phase brief
//   node scripts/orchestrator.mjs release [--ok|--fail]  release the lock; mark current phase completed/failed; advance if --ok
//   node scripts/orchestrator.mjs next              if current phase is completed, advance; print the next phase brief
//   node scripts/orchestrator.mjs log "message"     append a line to the state log
//
// Overlap guard: `acquire` refuses to take the lock if a fresh lock exists
// (created < STALE_AFTER_MS ago) AND the pid in the lock is still alive. A
// stale lock (older than STALE_AFTER_MS, or pid not alive) is overridden.

import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const STATE_FILE = path.join(REPO_ROOT, '.phase-state.json');
const LOCK_FILE = path.join(REPO_ROOT, '.phase-lock');
const PROMPTS_ROOT = path.resolve(REPO_ROOT, '..', 'xbrand-pack', 'pack', 'prompts');

// A lock is "stale" after this many ms. The cron fires every hour, so a phase
// that has been "running" for more than 2 hours is almost certainly abandoned
// (the previous agent session ended without calling `release`). 2h gives the
// previous agent one extra hour of slack beyond the cron interval.
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

// ─── phase definitions (from 00-START-HERE.md) ────────────────────────────
const PHASES = [
  {
    n: 0,
    name: 'اسکلت و زیرساخت',
    prompts: [
      'P0.1',
      'P0.2',
      'P0.3',
      'I0.1',
      'B0.1',
      'B0.2',
      'B0.3',
      'B0.4',
      'F0.1',
      'F0.2',
      'Q0.1',
      'I0.2',
      'Q0.2',
    ],
  },
  {
    n: 1,
    name: 'پایه: احراز هویت، چندزبانه، تم، UI Kit',
    prompts: [
      'B1.1',
      'B1.2',
      'B1.3',
      'B1.4',
      'B1.5',
      'B1.6',
      'B1.7',
      'B1.8',
      'B1.9',
      'B1.10',
      'B1.11',
      'B1.12',
      'B1.13',
      'B1.14',
      'I1.1',
      'F1.1',
      'F1.2',
      'F1.3',
      'F1.4',
      'F1.5',
      'F1.6',
      'F1.7',
      'F1.8',
      'F1.9',
      'Q1.1',
    ],
  },
  {
    n: 2,
    name: 'جغرافیا، کاتالوگ و پنل ادمین',
    prompts: [
      'B2.1',
      'B2.2',
      'B2.3',
      'B2.4',
      'B2.5',
      'B2.6',
      'B2.7',
      'B2.8',
      'B2.9',
      'B2.10',
      'F2.1',
      'F2.2',
      'F2.3',
      'F2.4',
      'F2.5',
      'Q2.1',
    ],
  },
  {
    n: 3,
    name: 'جست‌وجو و نقشه',
    prompts: [
      'B3.1',
      'B3.2',
      'B3.3',
      'B3.4',
      'B3.5',
      'I3.1',
      'F3.1',
      'F3.2',
      'F3.3',
      'F3.4',
      'F3.5',
      'F3.6',
      'Q3.1',
    ],
  },
  {
    n: 4,
    name: 'صفحه کسب‌وکار، نظرات و اعتماد',
    prompts: [
      'B4.1',
      'B4.2',
      'B4.3',
      'B4.4',
      'B4.5',
      'B4.6',
      'B4.7',
      'B4.8',
      'B4.9',
      'B4.10',
      'F4.1',
      'F4.2',
      'F4.3',
      'F4.4',
      'F4.5',
      'F4.6',
      'F4.7',
      'F4.8',
      'F4.9',
      'F4.10',
      'Q4.1',
    ],
  },
  {
    n: 5,
    name: 'تعامل: علاقه‌مندی، اعلان، پیام‌رسانی، PWA',
    prompts: [
      'B5.1',
      'B5.2',
      'B5.3',
      'B5.4',
      'B5.5',
      'B5.6',
      'B5.7',
      'F5.1',
      'F5.2',
      'F5.3',
      'F5.4',
      'F5.5',
      'F5.6',
      'Q5.1',
    ],
  },
  { n: 6, name: 'رزرو', prompts: ['B6.1', 'B6.2', 'B6.3', 'B6.4', 'F6.1', 'F6.2', 'Q6.1'] },
  {
    n: 7,
    name: 'داشبورد مالک و آنالیتیکس',
    prompts: [
      'B7.1',
      'B7.2',
      'F7.1',
      'F7.2',
      'F7.3',
      'F7.4',
      'F7.5',
      'F7.6',
      'F7.7',
      'F7.8',
      'Q7.1',
    ],
  },
  {
    n: 8,
    name: 'پرداخت، اشتراک و تبلیغات',
    prompts: [
      'B8.1',
      'B8.2',
      'B8.3',
      'B8.4',
      'B8.5',
      'B8.6',
      'F8.1',
      'F8.2',
      'F8.3',
      'F8.4',
      'Q8.1',
    ],
  },
  {
    n: 9,
    name: 'هوش مصنوعی',
    prompts: [
      'A9.1',
      'A9.2',
      'A9.3',
      'A9.4',
      'A9.5',
      'A9.6',
      'A9.7',
      'F9.1',
      'F9.2',
      'F9.3',
      'Q9.1',
    ],
  },
  {
    n: 10,
    name: 'پنل ادمین کامل و محتوا',
    prompts: [
      'B10.1',
      'B10.2',
      'B10.3',
      'B10.4',
      'B10.5',
      'F10.1',
      'F10.2',
      'F10.3',
      'F10.4',
      'F10.5',
      'F10.6',
      'F10.7',
      'Q10.1',
    ],
  },
  {
    n: 11,
    name: 'ویدیو و بهینه‌سازی تصویر',
    prompts: ['B11.1', 'B11.2', 'F11.1', 'F11.2', 'Q11.1'],
  },
  {
    n: 12,
    name: 'امنیت، کیفیت، کارایی، استقرار',
    prompts: [
      'Q12.1',
      'Q12.2',
      'Q12.3',
      'Q12.4',
      'Q12.5',
      'Q12.6',
      'Q12.7',
      'Q12.8',
      'I12.1',
      'Q12.9',
      'Q12.10',
      'Q12.11',
      'I12.2',
      'I12.3',
      'Q12.12',
      'Q12.13',
    ],
  },
];

// ─── helpers ──────────────────────────────────────────────────────────────
function nowIso() {
  return new Date().toISOString();
}
function nowMs() {
  return Date.now();
}

function defaultState() {
  return {
    schema_version: 1,
    current_phase: 0,
    status: 'pending', // pending | running | completed | failed
    started_at: null,
    completed_at: null,
    last_prompt: null,
    prompts_done: [],
    history: [],
    log: [],
    created_at: nowIso(),
  };
}

function readState() {
  if (!existsSync(STATE_FILE)) return defaultState();
  try {
    return { ...defaultState(), ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) };
  } catch (e) {
    console.error(`orchestrator: corrupt state file, resetting. Error: ${e.message}`);
    return defaultState();
  }
}

function writeState(s) {
  s.updated_at = nowIso();
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + '\n');
}

function readLock() {
  if (!existsSync(LOCK_FILE)) return null;
  try {
    return JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeLock(phase) {
  const lock = { pid: process.pid, phase, acquired_at: nowIso(), acquired_ms: nowMs() };
  writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2) + '\n');
  return lock;
}

function clearLock() {
  if (existsSync(LOCK_FILE)) unlinkSync(LOCK_FILE);
}

function pidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function lockIsFresh() {
  const lock = readLock();
  if (!lock) return false;
  const ageMs = nowMs() - (lock.acquired_ms ?? 0);
  if (ageMs >= STALE_AFTER_MS) return false; // stale
  if (pidAlive(lock.pid)) return true; // process still running
  // pid gone but lock fresh — assume the previous agent session is still
  // wrapping up (it may have spawned a subprocess that exited). Treat as
  // fresh for up to STALE_AFTER_MS.
  return true;
}

function appendLog(s, msg) {
  s.log = s.log ?? [];
  s.log.push({ ts: nowIso(), msg });
  if (s.log.length > 500) s.log = s.log.slice(-500);
}

function currentPhaseDef(s) {
  return PHASES.find((p) => p.n === s.current_phase) ?? null;
}

function nextPhaseDef(s) {
  return PHASES.find((p) => p.n === s.current_phase + 1) ?? null;
}

/**
 * Read the prompt text for a given prompt ID from the pack prompts directory.
 * Returns the raw markdown for the section that contains the ID, or null.
 * (Reserved for a future `show <ID>` subcommand; kept for reference.)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function readPromptText(promptId) {
  if (!existsSync(PROMPTS_ROOT)) return null;
  const track = promptId[0]; // P | I | B | F | A | Q
  const trackDir =
    track === 'P' || track === 'I' || track === 'Q'
      ? path.join(PROMPTS_ROOT, 'P-I-Q')
      : path.join(PROMPTS_ROOT, track);
  if (!existsSync(trackDir)) return null;
  // Find the phase file containing this prompt id.
  // Phase files are named like phase-00-01.md, phase-02-03.md, phase-04.md,
  // phase-05-06.md... and phase-12-security-tests.md / phase-12-perf-ops.md /
  // phase-12-deploy-final.md (the phase-12 split files carry a textual suffix).
  const phaseNum = parseInt(promptId.match(/\d+/)?.[0] ?? '0', 10);
  const candidates = [];
  for (const f of readdirSafe(trackDir)) {
    const m = f.match(/^phase-(\d+)(?:-(\d+))?[a-z0-9-]*\.md$/i);
    if (!m) continue;
    const lo = parseInt(m[1], 10);
    const hi = m[2] ? parseInt(m[2], 10) : lo;
    if (phaseNum >= lo && phaseNum <= hi) candidates.push(path.join(trackDir, f));
  }
  if (candidates.length === 0) return null;
  // Read each candidate and look for the section header `## <promptId>`
  for (const c of candidates) {
    const text = readFileSync(c, 'utf8');
    const idx = text.indexOf(`## ${promptId}`);
    if (idx === -1) continue;
    // Slice from this header to the next `## ` or end of file
    const after = text.slice(idx);
    const next = after.indexOf('\n## ', 1);
    return next === -1 ? after : after.slice(0, next);
  }
  return null;
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// ─── commands ─────────────────────────────────────────────────────────────

function cmdStatus() {
  const s = readState();
  const lock = readLock();
  const phase = currentPhaseDef(s);
  const fresh = lockIsFresh();
  console.log(
    JSON.stringify(
      {
        state: {
          current_phase: s.current_phase,
          phase_name: phase?.name ?? null,
          status: s.status,
          started_at: s.started_at,
          completed_at: s.completed_at,
          last_prompt: s.last_prompt,
          prompts_done_count: (s.prompts_done ?? []).length,
          prompts_total: phase?.prompts.length ?? 0,
          prompts_remaining: (phase?.prompts ?? []).filter(
            (p) => !(s.prompts_done ?? []).includes(p),
          ),
        },
        lock: lock
          ? { pid: lock.pid, phase: lock.phase, acquired_at: lock.acquired_at, fresh }
          : null,
        overlaps_guard: fresh
          ? 'BUSY — previous run still active, cron should skip'
          : 'FREE — safe to acquire',
      },
      null,
      2,
    ),
  );
}

function cmdAcquire(force = false) {
  const s = readState();
  if (!force && lockIsFresh()) {
    const lock = readLock();
    console.log(
      JSON.stringify(
        {
          action: 'skip',
          reason: 'previous run still active (lock is fresh and/or pid alive)',
          hint: 'If you are sure no other turn is running, retry with `acquire --force`.',
          lock,
          current_phase: s.current_phase,
          status: s.status,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  // --force (or stale lock): clear any existing lock before acquiring.
  if (existsSync(LOCK_FILE)) {
    const old = readLock();
    try {
      unlinkSync(LOCK_FILE);
    } catch {
      /* ignore */
    }
    if (old) {
      appendLog(
        s,
        `cleared previous lock (pid ${old.pid}, acquired ${old.acquired_at}) on forced acquire`,
      );
    }
  }
  // If the current phase is already completed, advance first.
  if (s.status === 'completed') {
    const next = nextPhaseDef(s);
    if (!next) {
      console.log(JSON.stringify({ action: 'done', reason: 'all phases completed' }, null, 2));
      process.exit(0);
    }
    s.history.push({
      phase: s.current_phase,
      started_at: s.started_at,
      completed_at: s.completed_at,
      status: 'completed',
    });
    s.current_phase = next.n;
    s.status = 'pending';
    s.started_at = null;
    s.completed_at = null;
    s.last_prompt = null;
    s.prompts_done = [];
    appendLog(s, `advanced to phase ${next.n} (${next.name})`);
  }
  // If the current phase is "running" but stale, mark it failed and retry.
  if (s.status === 'running') {
    appendLog(
      s,
      `phase ${s.current_phase} was running but lock was stale; treating as failed and retrying`,
    );
    s.status = 'pending';
    s.started_at = null;
  }
  if (s.status === 'failed') {
    appendLog(s, `retrying phase ${s.current_phase} after failure`);
    s.status = 'pending';
    s.started_at = null;
  }
  // Acquire
  s.status = 'running';
  s.started_at = nowIso();
  writeState(s);
  writeLock(s.current_phase);
  const phase = currentPhaseDef(s);
  const remaining = (phase?.prompts ?? []).filter((p) => !(s.prompts_done ?? []).includes(p));
  console.log(
    JSON.stringify(
      {
        action: 'acquired',
        phase: s.current_phase,
        phase_name: phase?.name ?? null,
        prompts_total: phase?.prompts.length ?? 0,
        prompts_done: s.prompts_done,
        prompts_remaining: remaining,
        started_at: s.started_at,
        repo_root: REPO_ROOT,
        prompts_root: PROMPTS_ROOT,
        note: 'Run the prompts in prompts_remaining order. After each prompt, run `node scripts/orchestrator.mjs log "P0.1 done"` to record progress. When the whole phase is done, run `node scripts/orchestrator.mjs release --ok`. If something failed badly, run `node scripts/orchestrator.mjs release --fail`.',
      },
      null,
      2,
    ),
  );
}

function cmdRelease(flag) {
  const s = readState();
  const ok = flag === '--ok';
  const fail = flag === '--fail';
  const pause = flag === '--pause';
  if (!ok && !fail && !pause) {
    console.error('orchestrator release: must pass --ok | --fail | --pause');
    process.exit(2);
  }
  if (ok) {
    s.status = 'completed';
    s.completed_at = nowIso();
    appendLog(s, `phase ${s.current_phase} completed`);
  } else if (fail) {
    s.status = 'failed';
    appendLog(s, `phase ${s.current_phase} marked failed`);
  } else {
    // --pause: the cron-fired agent ran out of time mid-phase. Drop the lock
    // so the next cron can pick the phase up, but keep status='pending' and
    // prompts_done intact so work resumes where it left off (no restart).
    s.status = 'pending';
    appendLog(
      s,
      `phase ${s.current_phase} paused mid-phase (${(s.prompts_done ?? []).length}/${
        currentPhaseDef(s)?.prompts.length ?? '?'
      } prompts done); lock released for next cron`,
    );
  }
  if (pause) s.started_at = null;
  writeState(s);
  clearLock();
  console.log(
    JSON.stringify({ action: 'released', phase: s.current_phase, status: s.status }, null, 2),
  );
}

function cmdNext() {
  const s = readState();
  if (s.status !== 'completed') {
    console.error(
      `orchestrator next: current phase ${s.current_phase} is ${s.status}, not completed`,
    );
    process.exit(2);
  }
  const next = nextPhaseDef(s);
  if (!next) {
    console.log(JSON.stringify({ action: 'done', reason: 'all phases completed' }, null, 2));
    return;
  }
  s.history.push({
    phase: s.current_phase,
    started_at: s.started_at,
    completed_at: s.completed_at,
    status: 'completed',
  });
  s.current_phase = next.n;
  s.status = 'pending';
  s.started_at = null;
  s.completed_at = null;
  s.last_prompt = null;
  s.prompts_done = [];
  appendLog(s, `advanced to phase ${next.n} (${next.name})`);
  writeState(s);
  console.log(
    JSON.stringify(
      { action: 'advanced', to_phase: next.n, phase_name: next.name, prompts: next.prompts },
      null,
      2,
    ),
  );
}

function cmdLog(message) {
  if (!message) {
    console.error('orchestrator log: message required');
    process.exit(2);
  }
  const s = readState();
  appendLog(s, message);
  // If the message looks like "P0.1 done", record it in prompts_done.
  const m = message.match(/^(P\d+\.\d+|I\d+\.\d+|B\d+\.\d+|F\d+\.\d+|A\d+\.\d+|Q\d+\.\d+)\s+done/i);
  if (m) {
    const id = m[1].toUpperCase();
    if (!(s.prompts_done ?? []).includes(id)) {
      s.prompts_done = [...(s.prompts_done ?? []), id];
      s.last_prompt = id;
    }
  }
  writeState(s);
  console.log(JSON.stringify({ action: 'logged', message, prompts_done: s.prompts_done }, null, 2));
}

// ─── main ─────────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'status':
    cmdStatus();
    break;
  case 'acquire':
    cmdAcquire(rest.includes('--force'));
    break;
  case 'release':
    cmdRelease(rest[0]);
    break;
  case 'next':
    cmdNext();
    break;
  case 'log':
    cmdLog(rest.join(' '));
    break;
  default:
    console.log(`Usage: node scripts/orchestrator.mjs <status|acquire|release --ok|--fail|--pause|next|log "message">
State file: ${STATE_FILE}
Lock file:  ${LOCK_FILE}
Prompts:    ${PROMPTS_ROOT}
Stale after: ${STALE_AFTER_MS} ms (${STALE_AFTER_MS / 3600000}h)`);
    process.exit(cmd ? 1 : 0);
}
