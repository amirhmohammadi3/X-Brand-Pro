import { apiFetchServer } from '../api/server';
import { isApiRequestError } from '../api/errors';
import { currentUserSchema, type CurrentUser } from '@app/contracts';

/**
 * Server-side auth resolution (F1.7). The root layout calls this once per
 * request to seed the {@link AuthProvider} and avoid first-paint flicker.
 *
 * - 200 → the current user (authenticated).
 * - 401 → anonymous (no error surfaced).
 * - any other failure → anonymous + `apiError: true` so the shell can show a
 *   subtle "couldn't reach the server" indicator rather than treating the
 *   user as logged-out.
 */
export interface ResolvedAuth {
  user: CurrentUser | null;
  apiError: boolean;
}

export async function resolveAuthServer(): Promise<ResolvedAuth> {
  try {
    const result = await apiFetchServer<CurrentUser>('/auth/me', currentUserSchema);
    return { user: result.data, apiError: false };
  } catch (err) {
    if (isApiRequestError(err) && err.status === 401) {
      return { user: null, apiError: false };
    }
    return { user: null, apiError: true };
  }
}
