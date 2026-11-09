import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/auth/guard';
import { PageHeader } from '@/components/layout/page-header';
import { ThemeAdmin } from './theme-admin';

/** `/admin/theme` (F2.4) — the theme-pack gallery + active switch. */
export default async function AdminThemePage() {
  await requireUser({ roles: ['admin', 'super_admin'], pathname: '/admin/theme' });
  const t = await getTranslations('admin.theme');
  return (
    <div className="space-y-4">
      <PageHeader title={t('page.title')} description={t('page.description')} />
      <ThemeAdmin />
    </div>
  );
}
