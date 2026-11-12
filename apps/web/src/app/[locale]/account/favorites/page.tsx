import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { FavoritesView } from '../../../../components/account/favorites-view';

/** `/account/favorites` (F5.1) — saved businesses and named lists. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.favorites');
  return { title: t('title') };
}

export default function FavoritesPage() {
  return <FavoritesView />;
}
