#!/usr/bin/env node
// gen-secrets.mjs (I1.1) — creates .env from .env.example when missing and
// fills the secret keys with random values ONLY when they are empty or still
// the example value. Never overwrites a real value; prints key NAMES only.

import { randomBytes } from 'node:crypto';
import { b64url48, b64_32, isUnsetValue } from './lib/env-tools.mjs';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = path.join(root, '.env.example');
const envPath = path.join(root, '.env');

/** The secret keys and their generators (order matters for readability). */
const SECRETS = {
  JWT_ACCESS_SECRET: () => b64url48(randomBytes),
  JWT_REFRESH_SECRET: () => b64url48(randomBytes),
  OTP_HMAC_SECRET: () => b64url48(randomBytes),
  SETTINGS_ENCRYPTION_KEY: () => b64_32(randomBytes),
};

function main() {
  if (!existsSync(examplePath)) {
    console.error('[env:init] .env.example is missing — nothing to generate from');
    process.exitCode = 1;
    return;
  }

  let created = false;
  let lines;
  if (existsSync(envPath)) {
    lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  } else {
    lines = readFileSync(examplePath, 'utf8').split(/\r?\n/);
    created = true;
  }

  const generated = [];
  const seen = new Set();
  const out = lines.map((line) => {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match) return line;
    const [, key] = match;
    seen.add(key);
    const generator = SECRETS[key];
    if (!generator || !isUnsetValue(match[2])) return line;
    generated.push(key);
    return `${key}=${generator()}`;
  });

  // A key missing from the file entirely (fresh example without it) is appended.
  for (const key of Object.keys(SECRETS)) {
    if (!seen.has(key)) {
      generated.push(key);
      out.push(`${key}=${SECRETS[key]()}`);
    }
  }

  writeFileSync(envPath, out.join('\n').endsWith('\n') ? out.join('\n') : `${out.join('\n')}\n`);

  if (created) console.log('[env:init] .env created from .env.example');
  // Names only — never print the values.
  if (generated.length > 0) {
    console.log(`[env:init] generated secret keys: ${generated.join(', ')}`);
  } else {
    console.log('[env:init] all secret keys already set — nothing generated');
  }
}

main();
