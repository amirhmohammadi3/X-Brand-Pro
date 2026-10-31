import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Minimal .env loader for CLI entry points (migrate, seed). The Nest app
 * itself receives its environment from the process environment (docker/env),
 * so only the standalone CLI tools need file-based env. Values already
 * present in the target always win; the file never overrides them.
 *
 * Supports: KEY=VALUE, quoted values, comments (#), blank lines.
 * Returns the path of the .env file that was loaded, or null.
 */
export function loadDotenvIntoProcessEnv(
  startDir: string = process.cwd(),
  target: Record<string, string | undefined> = process.env,
): string | null {
  let dir = path.resolve(startDir);
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(dir, '.env');
    if (existsSync(candidate)) {
      applyEnvFile(candidate, target);
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function applyEnvFile(
  filePath: string,
  target: Record<string, string | undefined> = process.env,
): void {
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (key === '') continue;
    if (key in target) continue; // existing process.env wins
    target[key] = value;
  }
}
