import type { ReactNode } from 'react';
import { resolveAuthServer } from '../../../lib/auth/server';
import { PublicShell } from './public-shell';

/**
 * `(public)` route group (F1.7). Header + footer + mobile nav. Auth is
 * resolved server-side and passed to the shell so the header's user menu
 * renders without flicker.
 */
export default async function PublicLayout({ children }: { children: ReactNode }) {
  const { user, apiError } = await resolveAuthServer();
  return (
    <PublicShell initialUser={user} initialApiError={apiError}>
      {children}
    </PublicShell>
  );
}
