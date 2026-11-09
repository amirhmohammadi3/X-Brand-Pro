import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/auth/guard';
import { PageHeader } from '@/components/layout/page-header';
import { SettingsAdmin } from './settings-admin';

/** `/admin/settings` (F2.4) — the settings-registry skeleton (`settings.manage`). */
export default async function AdminSettingsPage() {
  await requireUser({ roles: ['admin', 'super_admin'], pathname: '/admin/settings' });
  const t = await getTranslations('admin.settings');
  return (
    <div className="space-y-4">
      <PageHeader title={t('page.title')} description={t('page.description')} />
      <SettingsAdmin />
    </div>
  );
}
