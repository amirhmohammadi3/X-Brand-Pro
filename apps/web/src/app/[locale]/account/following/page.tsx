import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { FollowingView } from '../../../../components/account/following-view';

/** `/account/following` (F5.2) — followed users and businesses. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.following');
  return { title: t('title') };
}

export default function FollowingPage() {
  return <FollowingView />;
}
