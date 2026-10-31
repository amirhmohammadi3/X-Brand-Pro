import { z } from 'zod';

/**
 * Build-time public env for the web app. NEXT_PUBLIC_* variables are inlined
 * by Next at build time; this schema validates them once at import so a bad
 * value fails the build instead of silently pointing at the wrong API.
 * Server-only deployment secrets never live here — the browser bundle must
 * stay free of anything non-public (AGENTS.md section 9).
 */
const webEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost:4000/api/v1'),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export function loadWebEnv(source: Record<string, string | undefined> = process.env): WebEnv {
  const parsed = webEnvSchema.safeParse(source);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid web environment configuration:\n${issues}`);
}

export const env = loadWebEnv();
