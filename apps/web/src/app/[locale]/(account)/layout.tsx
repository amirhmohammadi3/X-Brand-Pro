import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { requireUser } from '../../../lib/auth/guard';
import { VerificationBanner } from '../../../components/auth/verification-banner';
import { AccountShell } from './account-shell';
import { Forbidden } from '../../../components/layout/forbidden';

/** Extract the request pathname from headers (referer fallback). F1.8's
 * middleware will set `x-pathname` explicitly; until then we best-effort
 * parse the referer so the `next` redirect lands close to the correct page. */
async function readPathname(): Promise<string> {
  const h = await headers();
  const explicit = h.get('x-pathname');
  if (explicit) return explicit;
  const referer = h.get('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      return url.pathname;
    } catch {
      // fall through
    }
  }
  return '/account';
}

/**
 * `(account)` route group (F1.7). Requires login: anonymous users are
 * redirected to `/login?next=<path>`. Renders the account shell (header +
 * sidebar/tab-scroller). Any authenticated user may view account pages.
 */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  const pathname = await readPathname();
  const { decision } = await requireUser({ pathname });

  if (decision.kind === 'forbidden') {
    return <Forbidden />;
  }

  // `requireUser` already redirected for `login`; here user is present.
  const user = decision.kind === 'allow' ? decision.user : null;
  return (
    <AccountShell initialUser={user} initialApiError={false}>
      {/* F1.8: nudge while email AND phone are both unverified. Rendered
          inside AccountShell so it can read the AuthProvider state. */}
      <VerificationBanner />
      {children}
    </AccountShell>
  );
}
