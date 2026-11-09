import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/auth/guard';
import { PageHeader } from '@/components/layout/page-header';
import { NeighborhoodsAdmin } from './neighborhoods-admin';

/**
 * `/admin/cities/[cityId]` (F2.2) — the neighborhoods of one city. The city
 * display name resolves client-side from the cached cities list.
 */
export default async function AdminNeighborhoodsPage({
  params,
}: {
  params: Promise<{ cityId: string }>;
}) {
  const { cityId } = await params;
  await requireUser({ roles: ['admin', 'super_admin'], pathname: '/admin/cities' });
  const t = await getTranslations('admin.neighborhoods');
  return (
    <div className="space-y-4">
      <PageHeader title={t('page.title')} description={t('page.description')} />
      <NeighborhoodsAdmin cityId={cityId} />
    </div>
  );
}
