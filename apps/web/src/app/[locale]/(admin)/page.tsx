import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '../../../lib/auth/guard';
import { PageHeader } from '../../../components/layout/page-header';
import { availableAdminItems } from '../../../lib/admin-nav';
import type { UserRole } from '@app/contracts';

const ADMIN_ROLES: ReadonlyArray<UserRole> = ['moderator', 'admin', 'super_admin'];

/**
 * `/admin` overview (F2.1) — the admin panel entry point. Server-rendered:
 * greets the admin by role and lists the sections their role can open
 * (permission-mirrored, linkable ones only — unbuilt sections are "soon"
 * placeholders in the sidebar and never appear here).
 */
export default async function AdminOverviewPage() {
  // The route-group layout already guarded; this repeat call is idempotent
  // (cached by resolveAuthServer's request memo) and keeps the page safe
  // standalone.
  const { decision } = await requireUser({ roles: ADMIN_ROLES, pathname: '/admin' });
  const t = await getTranslations('admin');

  const role = decision.kind === 'allow' ? decision.user.role : ('user' as UserRole);
  const items = availableAdminItems(role);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('overview.title')}
        description={t('overview.description', { role: t(`role.${role}`) })}
      />
      {items.length === 0 ? (
        <p className="text-text-subtle">{t('overview.emptyHint')}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="block h-full rounded-md border border-border-subtle p-4 transition-colors hover:bg-surface-alt focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="block font-medium text-text">{t(`nav.${item.labelKey}`)}</span>
                <span className="mt-1 block text-sm text-text-subtle">
                  {t(`nav.${item.labelKey}.hint`)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
