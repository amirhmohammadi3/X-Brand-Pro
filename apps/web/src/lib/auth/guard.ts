import { redirect } from 'next/navigation';
import { resolveAuthServer } from './server';
import type { CurrentUser, UserRole } from '@app/contracts';

/**
 * Route guards (F1.7). Pure decision helpers used by route-group layouts.
 *
 * - No user + 401 → redirect to `/login?next=<path>` (so the user returns
 *   after authenticating).
 * - User present but missing the required role → the layout renders the 403
 *   page instead of redirecting (so the user understands why, and can navigate
 *   back).
 *
 * The pure decision function {@link decideAccess} is unit-tested separately
 * from Next.js routing.
 */

export interface GuardInput {
  user: CurrentUser | null;
  roles?: ReadonlyArray<UserRole>;
  /** Current pathname, for the `next` redirect param. */
  pathname: string;
}

export type GuardDecision =
  | { kind: 'allow'; user: CurrentUser }
  | { kind: 'login'; next: string }
  | { kind: 'forbidden' };

/** Pure decision — no Next.js imports, unit-testable. */
export function decideAccess({ user, roles, pathname }: GuardInput): GuardDecision {
  if (!user) {
    return { kind: 'login', next: pathname };
  }
  if (roles && !roles.includes(user.role)) {
    return { kind: 'forbidden' };
  }
  return { kind: 'allow', user };
}

/**
 * Server-side guard: resolves auth and either returns the user, redirects to
 * login, or returns `null` to signal "render the 403 page".
 */
export async function requireUser(opts: {
  roles?: ReadonlyArray<UserRole>;
  pathname: string;
}): Promise<{ user: CurrentUser | null; decision: GuardDecision }> {
  const { user, apiError } = await resolveAuthServer();
  // If the API was unreachable, treat as anonymous so the user can at least
  // see public pages; guarded pages redirect to login (which will also fail
  // gracefully). `apiError` is surfaced via the auth provider for the shell.
  void apiError;
  const decision = decideAccess({ user, roles: opts.roles, pathname: opts.pathname });
  if (decision.kind === 'login') {
    const next = encodeURIComponent(opts.pathname);
    redirect(`/login?next=${next}`);
  }
  return { user, decision };
}
