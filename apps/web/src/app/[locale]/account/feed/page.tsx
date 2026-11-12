import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { FeedView } from '../../../../components/account/feed-view';

/** `/account/feed` (F5.2) — the activity feed of followed actors. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.feed');
  return { title: t('title') };
}

export default function FeedPage() {
  return <FeedView />;
}
