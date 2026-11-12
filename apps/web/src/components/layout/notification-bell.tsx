'use client';

/**
 * NotificationBell (F5.3) — the header island. Renders the bell with the
 * unread badge (60 s poll via `useUnreadCount`) for AUTHENTICATED users and
 * nothing for guests (the notifications endpoints are private). The badge
 * caps at 99+ so a flood never breaks the header layout.
 */
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Bell } from 'lucide-react';
import { useUnreadCount } from '../../lib/api/notifications';
import { useAuth } from '../../lib/auth/auth-context';
import { createFormatters } from '../../lib/format';
import { cn } from '../../lib/cn';

export function NotificationBell() {
  const t = useTranslations('account.notifications');
  const locale = useLocale();
  const { status } = useAuth();
  const authenticated = status === 'authenticated';
  const { unread } = useUnreadCount(authenticated);
  const { formatNumber } = createFormatters(locale);

  if (!authenticated) return null;

  const label = t('bellAria', { count: unread });

  return (
    <Link
      href="/account/notifications"
      aria-label={label}
      title={label}
      data-testid="notification-bell"
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-text-subtle transition-colors hover:bg-surface-alt hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Bell size={18} aria-hidden />
      {unread > 0 ? (
        <span
          data-testid="notification-bell-badge"
          className={cn(
            'absolute -top-0.5 end-0 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-on-primary',
          )}
        >
          {unread > 99 ? '99+' : formatNumber(unread)}
        </span>
      ) : null}
    </Link>
  );
}
