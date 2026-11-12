import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { NotificationsView } from '../../../../components/account/notifications-view';

/** `/account/notifications` (F5.3) — inbox + channel preferences. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.notifications');
  return { title: t('title') };
}

export default function NotificationsPage() {
  return <NotificationsView />;
}
