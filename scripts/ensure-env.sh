#!/usr/bin/env bash
# ensure-env.sh — make pnpm (pinned to 12.16.1 via corepack) available on PATH.
# Idempotent. Source it at the start of every session/cron run:
#   source /home/z/my-project/scripts/ensure-env.sh
# This committed copy lives at scripts/ensure-env.sh; a fresh clone has it.
set -e

export PROJECT_ROOT=/home/z/my-project
export COREPACK_HOME="$PROJECT_ROOT/.corepack"
export PNPM_HOME="$PROJECT_ROOT/.pnpm-store"
mkdir -p "$COREPACK_HOME" "$PNPM_HOME"

PERSIST_BIN="$PROJECT_ROOT/.local/bin"
mkdir -p "$PERSIST_BIN"
if [ ! -x "$PERSIST_BIN/pnpm" ]; then
  corepack enable --install-directory "$PERSIST_BIN" pnpm 2>/dev/null || true
fi
if [ ! -x "$PERSIST_BIN/pnpm" ]; then
  cat > "$PERSIST_BIN/pnpm" <<'SHIM'
#!/usr/bin/env bash
exec /usr/bin/corepack pnpm "$@"
SHIM
  chmod +x "$PERSIST_BIN/pnpm"
fi
if [ -w /usr/local/bin ] && [ ! -e /usr/local/bin/pnpm ]; then
  ln -s "$PERSIST_BIN/pnpm" /usr/local/bin/pnpm 2>/dev/null || true
fi

export PATH="$PERSIST_BIN:$PATH"
cd "$PROJECT_ROOT/repo" 2>/dev/null || true
corepack prepare pnpm@12.16.1 --activate >/dev/null 2>&1 || true
echo "ensure-env: pnpm $(pnpm -v 2>/dev/null || echo MISSING) at $(command -v pnpm 2>/dev/null || echo NONE)"
