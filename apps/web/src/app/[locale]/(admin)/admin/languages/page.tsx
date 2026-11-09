import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/auth/guard';
import { PageHeader } from '@/components/layout/page-header';
import { LanguagesAdmin } from './languages-admin';

/** `/admin/languages` (F2.3) — the language registry (`i18n.manage`). */
export default async function AdminLanguagesPage() {
  await requireUser({ roles: ['admin', 'super_admin'], pathname: '/admin/languages' });
  const t = await getTranslations('admin.languages');
  return (
    <div className="space-y-4">
      <PageHeader title={t('page.title')} description={t('page.description')} />
      <LanguagesAdmin />
    </div>
  );
}
