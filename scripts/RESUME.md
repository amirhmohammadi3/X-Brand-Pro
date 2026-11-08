# RESUME — automated runbook for the next agent (cron or hand-off)

This file is the single source of truth for **resuming** the X-Brand-Pro build
after a sandbox recycle. The sandbox at `/home/z/my-project/` is recycled
between turns: `/home/z/my-project/repo` and the top-level `scripts/` dir are
wiped, but `upload/` (the prompt pack), `skills/`, `download/` and `.env` are
kept. Everything durable lives on GitHub (commits + `docs/PROGRESS.md`).

Follow these steps top to bottom. Do not skip the checks. One prompt per run.

## 0. Constants

- Repo: `https://github.com/amirhmohammadi3/X-Brand-Pro.git`
- Git auth: a GitHub PAT is provided in the cron trigger message (or set
  `GITHUB_TOKEN` in the env). Use it as
  `https://x-access-token:$GITHUB_TOKEN@github.com/amirhmohammadi3/X-Brand-Pro.git`.
  **Never commit the token.** It is not in this file on purpose.
- Prompt pack: `/home/z/my-project/upload/pack_extracted/pack/prompts/`
  (subdirs `B/`, `F/`, `P-I-Q/`). A symlink `/home/z/my-project/xbrand-pack`
  points at the pack root once step 1 runs.
- Orchestrator: `scripts/orchestrator.mjs` (commands: `status`, `acquire`,
  `log`, `release`). Its state file `.phase-state.json` is **gitignored** and
  wiped on recycle — reconstruct it in step 3.

## 1. Boot the sandbox

```bash
cd /home/z/my-project
# Clone if missing; else pull --rebase to pick up any concurrent run.
if [ ! -d repo ]; then
  git clone "https://x-access-token:$GITHUB_TOKEN@github.com/amirhmohammadi3/X-Brand-Pro.git" repo
fi
cd repo
git fetch origin && git rebase origin/main  # never push --force; rebase your work on top
ln -sfn /home/z/my-project/upload/pack_extracted/pack /home/z/my-project/xbrand-pack
# pnpm via corepack (a committed copy of this lives at scripts/ensure-env.sh):
mkdir -p /home/z/my-project/scripts
cp scripts/ensure-env.sh /home/z/my-project/scripts/ensure-env.sh 2>/dev/null || true
chmod +x /home/z/my-project/scripts/ensure-env.sh
source /home/z/my-project/scripts/ensure-env.sh
pnpm install --frozen-lockfile
```

If `GITHUB_TOKEN` is empty, stop and report — you cannot clone or push.

## 2. Find where we are

Read `docs/PROGRESS.md`. The status line `وضعیت فاز جاری:` names the current
phase, and each prompt is a `- [x] ID …` (done) or `- [ ] ID …` (todo) line
under its `## فاز N` heading. The next work item is the **first `- [ ]` line**
in the current phase (phases run in order; a phase is done when all its lines
are `[x]`, then move to phase N+1).

Also read `docs/AGENTS.md` (the project's build contract) and the matching
skill section in the pack's `AGENTS.md` / scene files before writing code.

## 3. Reconstruct orchestrator state (gitignored, wiped each recycle)

Write `/home/z/my-project/repo/.phase-state.json` with:
`current_phase` = the current phase number, `status` = `"pending"`,
`prompts_done` = the `[x]` IDs in the current phase's section, `history` =
phases before the current one marked `completed`. Then:

```bash
node scripts/orchestrator.mjs status   # confirms current_phase + FREE guard
node scripts/orchestrator.mjs acquire  # sets status=running, prints the next prompt id + spec path
```

`acquire` prints `next_prompt` and `spec_path` — open that spec file and
implement ONLY that prompt's scope (not less, not more).

## 4. Implement the prompt

- Match the existing code conventions (look at a sibling module: for a backend
  prompt, mirror `apps/api/src/modules/<sibling>`; for a contract, mirror
  `packages/contracts/src/<sibling>.ts`). The previous prompt's
  `docs/DECISIONS.md` entry lists the patterns it used.
- Persist every non-trivial script under `scripts/` (this dir) and run it via
  `bash`, never inline heredocs.
- Generate Drizzle migrations with `pnpm --filter @app/api db:generate`
  (needs no DB). `pnpm db:migrate` needs Docker + Postgres — skip it here and
  note it in DECISIONS as a Docker-deferred check.

## 5. Checks (all must pass before commit)

```bash
pnpm typecheck
pnpm lint
pnpm check:rtl && pnpm check:no-external && pnpm check:brand
pnpm --filter @app/contracts test          # pure Zod, no DB
pnpm --filter @app/api test                # DB-requiring suites self-skip
pnpm --filter @app/api build
```

DB/integration + Playwright e2e suites self-skip without Docker — that is the
established pattern (B1.5/B1.6/B1.8/B2.1 all did this). Note what was deferred
in `docs/DECISIONS.md`.

## 6. Commit + push

```bash
git add -A
git commit -F /home/z/my-project/scripts/commit-msg.txt   # or -m with a clear message
git push origin main
```

Commit message format: `<type>(<scope>): <subject> — <PROMPT_ID>` then a body;
end with `Prompt: <ID>`. Do NOT commit `.phase-state.json` (gitignored) or the
token.

## 7. Tick the docs + release

- `docs/PROGRESS.md`: change the prompt's `- [ ]` to `- [x] ID … (YYYY-MM-DD)`;
  update the `وضعیت فاز جاری:` line if the phase advanced.
- `docs/DECISIONS.md`: append a dated entry (Decision / Reason / Tests /
  Alternatives / Out of scope) like the existing entries.
- `docs/API.md` / `docs/DATA_MODEL.md` / `docs/SECURITY.md`: update if the
  prompt added endpoints, tables, permissions or rate limits.
- Commit the doc changes (`docs(progression): tick <ID>`) and push.
- `node scripts/orchestrator.mjs log "<ID> done"` then
  `node scripts/orchestrator.mjs release --pause` (leaves the phase running,
  next acquire continues). If the phase is fully done, `release --ok` and tag
  `phase-<N>`.

## 8. Stop

One prompt per run. Report what you did, the commit hash, and the next prompt.
Do not start a second prompt in the same run unless step 5 is fully green and
the first prompt is committed+pushed.
