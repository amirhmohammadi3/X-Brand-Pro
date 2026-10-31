'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { isApiRequestError } from '../lib/api/errors';

/**
 * App-level client providers (F0.2). Query defaults: 30s staleTime (map
 * screens refetch deliberately, not on every focus), NO retries for 4xx
 * (auth/validation/rate-limit failures are deterministic), 2 retries with
 * backoff only for network/5xx. Mutations never retry by default.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              if (isApiRequestError(error) && error.isClientError) return false;
              return failureCount < 2;
            },
          },
          mutations: { retry: false },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
