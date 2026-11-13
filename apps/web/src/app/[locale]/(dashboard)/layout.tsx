import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { requireUser } from '../../../lib/auth/guard';
import { Forbidden } from '../../../components/layout/forbidden';
import { DashboardShell } from './dashboard-shell';
import type { UserRole } from '@app/contracts';

const DASHBOARD_ROLES: ReadonlyArray<UserRole> = ['owner', 'admin', 'super_admin'];

async function readPathname(): Promise<string> {
  const h = await headers();
  const explicit = h.get('x-pathname');
  if (explicit) return explicit;
  const referer = h.get('referer');
  if (referer) {
    try {
      return new URL(referer).pathname;
    } catch {
      // fall through
    }
  }
  return '/dashboard';
}

/**
 * `(dashboard)` route group (F1.7). Owner area guard: role owner or admin.
 * Anonymous → redirect to login; authenticated but wrong role → 403. F7.1
 * wraps every `/dashboard/*` page in {@link DashboardShell} (header + business
 * selector + section sidebar) so the per-business pages share one chrome;
 * the guard still runs before the shell mounts, and every dashboard endpoint
 * re-checks ownership on the API.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = await readPathname();
  const { decision } = await requireUser({ roles: DASHBOARD_ROLES, pathname });

  if (decision.kind === 'forbidden') {
    return <Forbidden />;
  }

  const user = decision.kind === 'allow' ? decision.user : null;
  return (
    <DashboardShell initialUser={user} initialApiError={false}>
      {children}
    </DashboardShell>
  );
}
