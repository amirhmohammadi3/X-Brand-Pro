/**
 * Pure helpers for the env/secret guard scripts (I1.1). No filesystem or
 * process access — everything takes strings and returns values, so the
 * Node test runner can exercise the rules without fixtures.
 */

/** 48 random bytes, base64url (JWT/OTP secrets). */
export function b64url48(randomBytes) {
  return randomBytes(48).toString('base64url');
}

/** 32 random bytes, base64 (AES-256 settings key). */
export function b64_32(randomBytes) {
  return randomBytes(32).toString('base64');
}

/** Example values that mark a key as "not filled in yet". */
const EXAMPLE_MARKERS = ['', 'CHANGE_ME', 'fill-me', 'example'];

/** True when a .env value is empty or still a placeholder → safe to generate. */
export function isUnsetValue(value) {
  if (value === undefined) return true;
  const trimmed = value.trim();
  return (
    trimmed === '' ||
    EXAMPLE_MARKERS.some((m) => trimmed === m) ||
    /^(example|sample|test|dev)[-_]/i.test(trimmed)
  );
}

/** `KEY=value` lines from a .env-style file (line-wise, regex-lean). */
export function parseEnvKeys(source) {
  const keyIsUpper = /^[A-Z][A-Z0-9_]*$/;
  const keys = new Set();
  for (const line of source.split('\n')) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq);
    if (keyIsUpper.test(key)) keys.add(key);
  }
  return keys;
}

/**
 * Top-level keys of the `envSchema = z.object({ ... })` block in env.ts.
 * Top-level entries sit at exactly 2-space indentation; nested schemas are
 * deeper and don't match. Throws when the file shape changes so the guard
 * fails loudly instead of silently passing on zero keys.
 */
export function parseSchemaKeys(source) {
  const start = source.indexOf('envSchema = z.object({');
  if (start === -1) throw new Error('envSchema definition not found in env.ts');
  const rest = source.slice(start);
  const end = rest.indexOf('\n});');
  if (end === -1) throw new Error('envSchema block end not found');
  const block = rest.slice(0, end);
  const keys = new Set();
  for (const match of block.matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)) {
    keys.add(match[1]);
  }
  if (keys.size === 0) throw new Error('no schema keys parsed from env.ts');
  return keys;
}

/** Scan rules (name + regex) — shared by the scanner and its tests. */
export const SECRET_RULES = [
  { name: 'private key block', re: /-----BEGIN (RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/ },
  { name: 'OpenAI-style API key', re: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  {
    name: 'hex secret assignment',
    re: /(?:secret|token|password|api[_-]?key|apikey|private[_-]?key)["']?\s*[:=]\s*["']?[0-9a-f]{32,}\b/i,
  },
];

/**
 * Scan one file's content; returns [{ line, rule, snippet }] findings.
 * Lines containing the `fake-secret` marker are exempt (test fixtures).
 */
export function scanContent(content, filePath = 'inline') {
  if (content.includes('\u0000')) return []; // binary
  const findings = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.includes('fake-secret')) continue;
    for (const rule of SECRET_RULES) {
      if (rule.re.test(line)) {
        findings.push({
          file: filePath,
          line: i + 1,
          rule: rule.name,
          snippet: line.trim().slice(0, 120),
        });
      }
    }
  }
  return findings;
}
