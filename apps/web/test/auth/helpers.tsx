// @vitest-environment jsdom
/**
 * Shared helpers for the F1.8 auth component specs: provider wrappers using
 * the REAL bundled seed messages (byte-identical to the API seeds), a route
 * matcher over a stubbed global fetch (no MSW dependency — same pattern as
 * test/api-client.spec.ts), and navigation mocks.
 */
import { cleanup, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, type Mock } from 'vitest';
import enSeed from '../../src/i18n/fallback/en.json';
import faSeed from '../../src/i18n/fallback/fa.json';
import type { CurrentUser } from '@app/contracts';

export const en = enSeed as unknown as Record<string, unknown>;
export const fa = faSeed as unknown as Record<string, unknown>;

// jsdom lacks requestAnimationFrame in some configurations; useZodForm's
// focus-on-server-error path needs it.
if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0)) as unknown as typeof requestAnimationFrame;
}

// Router doubles shared by every spec that imports this helper. Each test
// file registers its own HOISTED `vi.mock('@/i18n/navigation', ...)` factory
// (see the specs) that returns these — vi.mock is only hoisted in test files,
// never in imported helper modules.
export const routerPush = vi.fn();
export const routerReplace = vi.fn();

export function makeUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: '00000000-0000-0000-0000-0000000000f1',
    username: 'tester',
    email: null,
    phone: null,
    role: 'user',
    status: 'active',
    displayName: 'Tester',
    bio: null,
    locale: 'en',
    avatarUrl: null,
    hasPassword: true,
    emailVerified: false,
    phoneVerified: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

interface RouteResult {
  status: number;
  body: unknown;
}

export type RouteHandler = (url: string, init: RequestInit | undefined) => RouteResult | undefined;

/** Success envelope helper. */
export const okEnvelope = (data: unknown) => ({ ok: true, data });

/** Failure envelope helper — mirrors the API error contract (requestId required). */
export const errorEnvelope = (code: string, message = code, details?: unknown) => ({
  ok: false,
  error: {
    code,
    messageKey: `errors.${code.toLowerCase()}`,
    message,
    ...(details !== undefined ? { details } : {}),
    requestId: 'req-test',
  },
});

/**
 * Stub global fetch with a path-matching router. Unmatched URLs answer 404
 * with a valid error envelope (so stray queries fail loudly but quietly).
 */
export function stubFetch(handler: RouteHandler): Mock {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const matched = handler(url, init);
    const result = matched ?? {
      status: 404,
      body: errorEnvelope('NOT_FOUND', `unexpected ${url}`),
    };
    return new Response(result.body === null ? null : JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export interface RenderAuthOptions {
  locale?: 'fa' | 'en';
}

/**
 * Render a client auth component inside QueryClient + next-intl providers
 * using the real seed messages. Returns the query client for cache asserts.
 */
export function renderAuth(
  node: React.ReactNode,
  { locale = 'fa' }: RenderAuthOptions = {},
): QueryClient {
  cleanup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const messages = locale === 'fa' ? fa : en;
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale={locale} messages={messages}>
        {node}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

export async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
