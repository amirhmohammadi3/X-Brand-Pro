import { cookies } from 'next/headers';
import type { ZodType } from 'zod';
import { apiFetch, type ApiFetchOptions, type QueryRecord } from './client';

/**
 * Server-side client for Server Components: forwards the browser's cookies
 * so session-aware endpoints work without a token in JSX-land (the auth
 * contract itself arrives with B1.3; this is the transport hook it needs).
 * Client components use apiFetch directly through TanStack Query instead.
 */
export async function apiFetchServer<TData, TBody = unknown>(
  path: string,
  dataSchema: ZodType<TData>,
  options: Omit<ApiFetchOptions<TBody>, 'headers' | 'signal'> & { query?: QueryRecord } = {},
): Promise<{ data: TData; meta?: unknown }> {
  const cookieStore = await cookies();
  const cookie = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  return apiFetch<TData, TBody>(path, dataSchema, {
    ...options,
    headers: cookie === '' ? {} : { Cookie: cookie },
  });
}
