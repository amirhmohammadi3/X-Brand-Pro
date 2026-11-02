#!/usr/bin/env node
// scripts/cron-driver.mjs — entry point for the hourly cron.
//
// The cron fires this script via an agent turn. It implements the
// pid-aware overlap guard the user asked for:
//
//   - if a previous agent's lock exists AND its pid is STILL ALIVE  → SKIP
//     (the previous turn is genuinely still running; do not interfere)
//   - if a lock exists but the pid is DEAD (the previous agent turn ended
//     without releasing — normal in this cron-to-agent environment) → the
//     lock is stale; clear it and ACQUIRE so work resumes
//   - if no lock exists → ACQUIRE
//
// On acquire it prints (as JSON) the next prompt to work on and its full
// text from the pack, plus instructions for the agent. The agent then does
// the work, logs each prompt done, and on turn end runs
//   node scripts/orchestrator.mjs release --pause   (phase not finished)
//   node scripts/orchestrator.mjs release --ok      (phase finished → advance)

import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const STATE_FILE = path.join(REPO_ROOT, '.phase-state.json');
const LOCK_FILE = path.join(REPO_ROOT, '.phase-lock');
const ORCH = path.join(REPO_ROOT, 'scripts', 'orchestrator.mjs');
const PROMPTS_ROOT = path.resolve(REPO_ROOT, '..', 'xbrand-pack', 'pack', 'prompts');

function readJson(f) {
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
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

// Read the prompt text for an ID from the pack (mirrors orchestrator.mjs logic).
function readPromptText(promptId) {
  if (!existsSync(PROMPTS_ROOT)) return null;
  const track = promptId[0];
  const trackDir =
    track === 'P' || track === 'I' || track === 'Q'
      ? path.join(PROMPTS_ROOT, 'P-I-Q')
      : path.join(PROMPTS_ROOT, track);
  if (!existsSync(trackDir)) return null;
  const phaseNum = parseInt(promptId.match(/\d+/)?.[0] ?? '0', 10);
  const candidates = [];
  let entries = [];
  try {
    entries = readdirSync(trackDir);
  } catch {
    entries = [];
  }
  for (const f of entries) {
    const m = f.match(/^phase-(\d+)(?:-(\d+))?[a-z0-9-]*\.md$/i);
    if (!m) continue;
    const lo = parseInt(m[1], 10);
    const hi = m[2] ? parseInt(m[2], 10) : lo;
    if (phaseNum >= lo && phaseNum <= hi) candidates.push(path.join(trackDir, f));
  }
  for (const c of candidates) {
    const text = readFileSync(c, 'utf8');
    const idx = text.indexOf(`## ${promptId}`);
    if (idx === -1) continue;
    const after = text.slice(idx);
    const next = after.indexOf('\n## ', 1);
    return next === -1 ? after : after.slice(0, next);
  }
  return null;
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

const out = (obj) => console.log(JSON.stringify(obj, null, 2));

// ---- 1) pid-aware overlap guard ----
const lock = readJson(LOCK_FILE);
const state = readJson(STATE_FILE);

if (lock) {
  if (pidAlive(lock.pid)) {
    out({
      action: 'skip',
      reason: `previous agent (pid ${lock.pid}) still alive on phase ${lock.phase}`,
      lock,
      hint: 'Do nothing this hour; the in-flight turn will release on its own.',
    });
    process.exit(0);
  }
  // pid dead → previous turn ended without releasing. Stale: clear & proceed.
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    /* ignore */
  }
  if (state) {
    state.log = state.log ?? [];
    state.log.push({
      ts: new Date().toISOString(),
      msg: `cron-driver: cleared stale lock (pid ${lock.pid} no longer alive) for phase ${lock.phase}`,
    });
    if (state.status === 'running') {
      // Flip to pending so acquire resumes cleanly (no "failed" misnomer).
      state.status = 'pending';
      state.started_at = null;
    }
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
  }
}

// ---- 2) acquire (advances completed→next, retries failed) ----
const acq = spawnSync(process.execPath, [ORCH, 'acquire'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
});
const acquired = safeJson(acq.stdout);

if (typeof acquired !== 'object' || acquired === null) {
  out({
    action: 'error',
    reason: 'orchestrator acquire produced no JSON',
    stdout: acq.stdout,
    stderr: acq.stderr,
    exit_code: acq.status,
  });
  process.exit(1);
}

if (acquired.action === 'skip' || acquired.action === 'done') {
  out({ action: acquired.action, reason: acquired.reason, raw: acquired });
  process.exit(0);
}

// ---- 3) figure out the next prompt and its text ----
const remaining = acquired.prompts_remaining ?? [];
if (remaining.length === 0) {
  // No remaining prompts → mark phase complete (advances to next phase).
  const rel = spawnSync(process.execPath, [ORCH, 'release', '--ok'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  out({
    action: 'phase-complete',
    phase: acquired.phase,
    release: safeJson(rel.stdout),
    hint: 'All prompts of this phase are done; orchestrator advanced. Next cron starts the next phase.',
  });
  process.exit(0);
}

const nextPromptId = remaining[0];
const promptText = readPromptText(nextPromptId);

out({
  action: 'acquired',
  phase: acquired.phase,
  phase_name: acquired.phase_name,
  prompts_total: acquired.prompts_total,
  prompts_done: acquired.prompts_done,
  prompts_remaining: remaining,
  next_prompt: nextPromptId,
  prompt_text: promptText,
  repo_root: REPO_ROOT,
  prompts_root: PROMPTS_ROOT,
  instructions:
    `Implement ONLY the scope of ${nextPromptId} following AGENTS.md (read official docs, pin versions in DECISIONS, write code + tests). ` +
    `After it passes its "Done when" (run \`pnpm verify\`), run: ` +
    `node scripts/orchestrator.mjs log "${nextPromptId} done" && ` +
    (remaining.length === 1
      ? 'node scripts/orchestrator.mjs release --ok   # last prompt of the phase → advance'
      : 'node scripts/orchestrator.mjs release --pause  # phase not finished → next cron resumes') +
    `. Then commit with footer "Prompt: ${nextPromptId}". Do NOT touch other prompts.`,
});
