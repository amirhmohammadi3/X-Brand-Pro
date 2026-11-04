import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { requireUser } from '../../../lib/auth/guard';
import { Forbidden } from '../../../components/layout/forbidden';
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
 * Anonymous → redirect to login; authenticated but wrong role → 403. The
 * actual dashboard shell is filled by F7.1; this layout only enforces the
 * guard and renders children (or the forbidden page).
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = await readPathname();
  const { decision } = await requireUser({ roles: DASHBOARD_ROLES, pathname });

  if (decision.kind === 'forbidden') {
    return <Forbidden />;
  }

  return <>{children}</>;
}
