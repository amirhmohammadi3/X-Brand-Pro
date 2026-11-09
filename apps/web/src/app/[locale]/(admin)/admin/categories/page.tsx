import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/auth/guard';
import { PageHeader } from '@/components/layout/page-header';
import { CategoriesAdmin } from './categories-admin';

/** `/admin/categories` (F2.2) — the two-level category tree (`catalog.manage`). */
export default async function AdminCategoriesPage() {
  await requireUser({ roles: ['admin', 'super_admin'], pathname: '/admin/categories' });
  const t = await getTranslations('admin.categories');
  return (
    <div className="space-y-4">
      <PageHeader title={t('page.title')} description={t('page.description')} />
      <CategoriesAdmin />
    </div>
  );
}
