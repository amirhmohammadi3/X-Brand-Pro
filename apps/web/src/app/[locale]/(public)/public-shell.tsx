'use client';

import type { ReactNode } from 'react';
import { AuthProvider, type AuthContextValue } from '../../../lib/auth/auth-context';
import { SiteHeader } from '../../../components/layout/site-header';
import { SiteFooter } from '../../../components/layout/site-footer';
import { MobileNav } from '../../../components/layout/mobile-nav';
import type { CurrentUser } from '@app/contracts';

/**
 * `PublicShell` (F1.7). The app shell for the `(public)` route group: a
 * sticky header, the page content, the footer and the mobile bottom tab bar.
 * Wraps children in {@link AuthProvider} so the header's user menu has the
 * server-resolved session without a first-paint flicker.
 *
 * `pb-16` on the main keeps content clear of the mobile tab bar.
 */
export function PublicShell({
  children,
  initialUser,
  initialApiError,
}: {
  children: ReactNode;
  initialUser: CurrentUser | null;
  initialApiError: boolean;
}) {
  return (
    <AuthProvider initialUser={initialUser} initialApiError={initialApiError}>
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        <main id="main" className="flex-1 pb-16 md:pb-0">
          {children}
        </main>
        <SiteFooter />
        <MobileNav />
      </div>
    </AuthProvider>
  );
}

// Re-export the hook for convenience.
export { useAuth } from '../../../lib/auth/auth-context';
export type { AuthContextValue };
