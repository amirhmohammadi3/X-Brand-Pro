#!/usr/bin/env node
// check-env.mjs (I1.1) — consistency gate between .env.example and the API
// env schema (apps/api/src/config/env.ts). Fails when a key exists on one
// side only, so documentation and code cannot drift apart.
//
// The schema keys are extracted with a deterministic regex from the
// `envSchema = z.object({ ... })` block in env.ts (importing the TS file
// from a plain .mjs script is not possible under the package's CJS scope).

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnvKeys, parseSchemaKeys } from './lib/env-tools.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = path.join(root, '.env.example');
const envTsPath = path.join(root, 'apps', 'api', 'src', 'config', 'env.ts');

/** NEXT_PUBLIC_* keys the web app validates itself (build-time, apps/web). */
const WEB_KEYS = new Set(['NEXT_PUBLIC_API_URL']);

function main() {
  const problems = [];

  if (!existsSync(envTsPath)) {
    console.error('[check:env] apps/api/src/config/env.ts not found');
    process.exitCode = 1;
    return;
  }
  if (!existsSync(examplePath)) {
    problems.push('.env.example is missing');
    console.error('[check:env] FAIL');
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
    return;
  }

  const exampleKeys = parseEnvKeys(readFileSync(examplePath, 'utf8'));
  const schemaKeys = parseSchemaKeys(readFileSync(envTsPath, 'utf8'));

  for (const key of schemaKeys) {
    if (!exampleKeys.has(key)) problems.push(`env.ts requires ${key} — missing from .env.example`);
  }
  for (const key of exampleKeys) {
    if (!schemaKeys.has(key) && !WEB_KEYS.has(key)) {
      problems.push(
        `.env.example defines ${key} — nothing reads it (not in env.ts, not a web key)`,
      );
    }
  }

  if (problems.length > 0) {
    console.error('[check:env] FAIL — env schema and .env.example disagree:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `[check:env] OK (${schemaKeys.size} schema keys + ${WEB_KEYS.size} web keys all documented)`,
  );
}

main();
