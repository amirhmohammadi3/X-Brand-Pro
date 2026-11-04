import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { requireUser } from '../../../lib/auth/guard';
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
 * `(admin)` route group (F1.7). Guard for roles moderator, admin, super_admin.
 * The shell and sidebar are built by F2.1; this layout only enforces the
 * guard and renders children (or the forbidden page).
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = await readPathname();
  const { decision } = await requireUser({ roles: ADMIN_ROLES, pathname });

  if (decision.kind === 'forbidden') {
    return <Forbidden />;
  }

  return <>{children}</>;
}
