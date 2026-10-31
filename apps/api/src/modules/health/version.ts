import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Reads the api package version from package.json at require-time. Falls back
 * to '0.0.0' when packaged without the file (e.g. bundled single binary).
 */
let cached: string | null = null;
export function getVersion(): string {
  if (cached) return cached;
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'),
    ) as { version?: string };
    cached = pkg.version ?? '0.0.0';
  } catch {
    cached = '0.0.0';
  }
  return cached;
}

export const VERSION = getVersion();
