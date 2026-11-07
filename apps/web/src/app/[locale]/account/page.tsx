'use client';

import { useEffect } from 'react';
import { useRouter } from '@/i18n/navigation';

/**
 * `/account` (F1.9) — redirects to the profile tab. The account area's entry
 * point is the profile page; the sidebar links to the other sections.
 */
export default function AccountIndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/account/profile');
  }, [router]);
  return null;
}
