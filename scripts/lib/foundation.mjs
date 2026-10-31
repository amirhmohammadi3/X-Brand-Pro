// Pure helpers for scripts/check-foundation.mjs. Extracted so the Node test
// runner can exercise them without spawning a subprocess.
import path from 'node:path';

/** Files that must exist at the repo root and be committed. */
export const FOUNDATION_FILES = [
  'AGENTS.md',
  'docs/PROGRESS.md',
  'docs/DECISIONS.md',
  'docs/DESIGN.md',
  'docs/API.md',
  'docs/DATA_MODEL.md',
  'docs/SECURITY.md',
  'docs/DEPLOYMENT.md',
];

/**
 * Find which foundation files are missing from the given list of tracked files.
 * @param {string[]} trackedFiles - output of `git ls-files`
 * @returns {string[]} missing foundation file paths (posix, relative)
 */
export function findMissingFoundationFiles(trackedFiles) {
  const set = new Set(trackedFiles.map((f) => f.replace(/\\/g, '/')));
  return FOUNDATION_FILES.filter((f) => !set.has(f));
}

/**
 * Detect duplicate prompt IDs in docs/PROGRESS.md.
 * Returns an array of duplicate IDs (empty if none).
 * @param {string} progressMarkdown
 * @returns {string[]}
 */
export function findDuplicatePromptIds(progressMarkdown) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  // Match lines like `- [ ] P0.1 🟢 ...` or `- [x] B1.3 🔴 ...`
  const re = /^\s*- \[[ xX]\]\s+([A-Z](?:-?[A-Z])?\d+(?:\.\d+)?(?:[a-z])?)\b/gm;
  let m;
  while ((m = re.exec(progressMarkdown)) !== null) {
    const id = m[1];
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
}

/**
 * @param {string} relPath
 */
export function toPosix(relPath) {
  return relPath.replace(/\\/g, '/');
}

export const __dirname = path.dirname(new URL(import.meta.url).pathname);
