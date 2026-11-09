import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/auth/guard';
import { PageHeader } from '@/components/layout/page-header';
import { AmenitiesAdmin } from './amenities-admin';

/** `/admin/amenities` (F2.2) — the flat amenity catalog (`catalog.manage`). */
export default async function AdminAmenitiesPage() {
  await requireUser({ roles: ['admin', 'super_admin'], pathname: '/admin/amenities' });
  const t = await getTranslations('admin.amenities');
  return (
    <div className="space-y-4">
      <PageHeader title={t('page.title')} description={t('page.description')} />
      <AmenitiesAdmin />
    </div>
  );
}
