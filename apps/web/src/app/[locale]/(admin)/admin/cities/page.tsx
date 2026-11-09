import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/auth/guard';
import { PageHeader } from '@/components/layout/page-header';
import { CitiesAdmin } from './cities-admin';

/**
 * `/admin/cities` (F2.2) — city + neighborhood management (`catalog.manage`).
 * The route group layout has already enforced the admin guard.
 */
export default async function AdminCitiesPage() {
  await requireUser({ roles: ['admin', 'super_admin'], pathname: '/admin/cities' });
  const t = await getTranslations('admin.cities');
  return (
    <div className="space-y-4">
      <PageHeader title={t('page.title')} description={t('page.description')} />
      <CitiesAdmin />
    </div>
  );
}
