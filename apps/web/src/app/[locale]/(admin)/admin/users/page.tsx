import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/auth/guard';
import { PageHeader } from '@/components/layout/page-header';
import { UsersAdmin } from './users-admin';

/**
 * `/admin/users` (F2.5) — the user registry. Visible to moderators
 * (read-only, `users.read`); write actions need `users.manage`.
 */
export default async function AdminUsersPage() {
  await requireUser({ roles: ['moderator', 'admin', 'super_admin'], pathname: '/admin/users' });
  const t = await getTranslations('admin.users');
  return (
    <div className="space-y-4">
      <PageHeader title={t('page.title')} description={t('page.description')} />
      <UsersAdmin />
    </div>
  );
}
