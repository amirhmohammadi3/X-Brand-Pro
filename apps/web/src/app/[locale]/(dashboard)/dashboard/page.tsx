import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DashboardOverview } from '../../../../components/dashboard/dashboard-overview';

/** `/dashboard` (F7.1) — the owner area landing. Lists every business the
 *  caller owns (every status) as cards that link into the per-business
 *  dashboard. The list itself is the `DashboardOverview` client component
 *  (loading state, empty-state CTA, cards). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard');
  return { title: t('title') };
}

export default function DashboardPage() {
  return <DashboardOverview />;
}
