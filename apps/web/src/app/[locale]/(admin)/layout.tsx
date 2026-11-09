import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { requireUser } from '../../../lib/auth/guard';
import { AdminShell } from './admin-shell';
import { Forbidden } from '../../../components/layout/forbidden';
import type { UserRole } from '@app/contracts';

const ADMIN_ROLES: ReadonlyArray<UserRole> = ['moderator', 'admin', 'super_admin'];

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
  return '/admin';
}

/**
 * `(admin)` route group layout (F1.7 guard, F2.1 shell). Guard for roles
 * moderator, admin, super_admin; anonymous → login redirect, wrong role →
 * 403. Authenticated admins get the admin shell (SiteHeader + grouped,
 * permission-mirrored sidebar) around every `/admin/*` page.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = await readPathname();
  const { user, decision } = await requireUser({ roles: ADMIN_ROLES, pathname });

  if (decision.kind === 'forbidden') {
    return <Forbidden />;
  }

  return (
    <AdminShell initialUser={user} initialApiError={false}>
      {children}
    </AdminShell>
  );
}
