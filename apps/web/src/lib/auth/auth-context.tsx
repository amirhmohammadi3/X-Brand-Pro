'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { qk } from '../api/qk';
import { isApiRequestError } from '../api/errors';
import { currentUserSchema, type CurrentUser } from '@app/contracts';

/**
 * Auth state (F1.7). `useAuth()` exposes `{ user, status, refresh, logout }`.
 *
 * The INITIAL state is resolved on the SERVER (the root layout calls
 * `GET /auth/me` with forwarded cookies and treats 401 as anonymous), then
 * passed to {@link AuthProvider} as `initialUser` so there is no auth
 * flicker on first paint. React Query keeps it fresh under `qk.auth.me()`.
 *
 * The provider also listens for the `auth:expired` window event dispatched
 * by the API client (F0.2) when an access token expires: it flips the cache
 * to anonymous immediately so guarded UI hides without waiting for a refetch.
 */

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  user: CurrentUser | null;
  status: AuthStatus;
  /** True when the server-side resolve failed (the API was unreachable). */
  apiError: boolean;
  refresh: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMe(): Promise<CurrentUser | null> {
  const result = await apiFetch<CurrentUser>('/auth/me', currentUserSchema);
  return result.data;
}

export interface AuthProviderProps {
  /** Server-resolved user (null = anonymous). Removes first-paint flicker. */
  initialUser: CurrentUser | null;
  /** True when the server resolve hit a non-401 error (API down). */
  initialApiError?: boolean;
  children: ReactNode;
}

export function AuthProvider({
  initialUser,
  initialApiError = false,
  children,
}: AuthProviderProps) {
  const queryClient = useQueryClient();
  const [apiError, setApiError] = useState(initialApiError);

  const query = useQuery<CurrentUser | null>({
    queryKey: qk.auth.me(),
    queryFn: async () => {
      try {
        return await fetchMe();
      } catch (err) {
        // 401 = anonymous (not an error); anything else = API problem.
        if (isApiRequestError(err) && err.status === 401) {
          setApiError(false);
          return null;
        }
        setApiError(true);
        // Keep the previous user rather than flipping to anonymous on a
        // transient API failure.
        throw err;
      }
    },
    initialData: initialUser,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => {
      if (isApiRequestError(error) && error.status === 401) return false;
      return failureCount < 2;
    },
  });

  // Seed the cache with the server value so the first render is synchronous.
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current) {
      seeded.current = true;
      queryClient.setQueryData(qk.auth.me(), initialUser);
    }
  }, [queryClient, initialUser]);

  // auth:expired → flip to anonymous immediately.
  useEffect(() => {
    const onExpired = () => {
      queryClient.setQueryData(qk.auth.me(), null);
      setApiError(false);
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [queryClient]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.auth.me() });
  }, [queryClient]);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/auth/logout', currentUserSchema, { method: 'POST' });
    } catch {
      // Even if the server call fails, clear the local session.
    }
    queryClient.setQueryData(qk.auth.me(), null);
    queryClient.invalidateQueries({ queryKey: qk.auth.me() });
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(() => {
    const user = query.data ?? null;
    const status: AuthStatus =
      query.isPending && initialUser === undefined
        ? 'loading'
        : user
          ? 'authenticated'
          : 'anonymous';
    return { user, status, apiError, refresh, logout };
  }, [query.data, query.isPending, initialUser, apiError, refresh, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
