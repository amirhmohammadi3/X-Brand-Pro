'use client';

/**
 * NotificationsView (F5.3) — the `/account/notifications` body.
 *
 * Two tabs:
 *  - INBOX (`GET /notifications/me/inbox`): one row per delivered in-app
 *    notification. The payload is the RAW var map — the UI re-renders the
 *    text through the `notifications.<eventKey>.title/.body` i18n templates
 *    (so a translation fix repairs old rows for free, per B5.3). A row click
 *    marks it read; the header button marks EVERYTHING unread.
 *  - PREFERENCES (`GET/PUT /notifications/me/preferences`): the merged
 *    channel matrix — one row per event (five in the v1 catalog), four
 *    channel switches each. A toggle PUTs the PARTIAL merge (the server
 *    keeps the untouched channels of the existing override row) and the
 *    refetch renders the authoritative merged state (`overridden` badge).
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { BellOff, CheckCheck, Mail, MessageCircle, Smartphone, Bell } from 'lucide-react';
import type {
  NOTIFICATION_EVENT_KEYS,
  NotificationChannels,
  NotificationItem,
  NotificationPreference,
} from '@app/contracts';
import { createFormatters } from '../../lib/format';
import { isApiRequestError } from '../../lib/api/errors';
import {
  NOTIFICATIONS_PAGE_SIZE,
  useMarkNotificationsRead,
  useNotificationInbox,
  useNotificationPreferences,
  useUpdateNotificationPreference,
} from '../../lib/api/notifications';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Pagination,
  Spinner,
  Switch,
  Tabs,
  useToast,
} from '../ui';
import { PushDevicesTab } from '../pwa/push-devices-tab';
import { cn } from '../../lib/cn';

const TAB_INBOX = 'inbox';
const TAB_PREFERENCES = 'preferences';
const TAB_DEVICES = 'devices';

/**
 * The four channels — the MATRIX keys are camelCase (`inApp`), while the wire
 * enum (`NotificationChannel`) spells it `in_app`; the matrix key is what the
 * switches read/write and what the PUT body carries.
 */
const CHANNELS: ReadonlyArray<{
  matrix: keyof NotificationChannels;
  icon: typeof Bell;
}> = [
  { matrix: 'inApp', icon: Bell },
  { matrix: 'email', icon: Mail },
  { matrix: 'sms', icon: Smartphone },
  { matrix: 'push', icon: MessageCircle },
];

export function NotificationsView() {
  const t = useTranslations('account.notifications');
  const tRoot = useTranslations();
  const locale = useLocale();
  const toast = useToast();

  const [tab, setTab] = useState<string>(TAB_INBOX);
  const [page, setPage] = useState(1);

  const {
    result: inbox,
    isPending: inboxPending,
    error: inboxError,
  } = useNotificationInbox(page, NOTIFICATIONS_PAGE_SIZE, tab === TAB_INBOX);

  const {
    result: prefs,
    isPending: prefsPending,
    error: prefsError,
  } = useNotificationPreferences(tab === TAB_PREFERENCES);

  const markRead = useMarkNotificationsRead();
  const updatePref = useUpdateNotificationPreference();

  const handleTabChange = (value: string): void => {
    setTab(value);
    setPage(1);
  };

  const handleMarkAll = async (): Promise<void> => {
    try {
      const res = await markRead.mutateAsync({ all: true });
      toast.success(t('markedAllToast', { count: res.marked }));
    } catch (err) {
      toast.error(mapNotificationError(err, tRoot, t));
    }
  };

  const handleMarkOne = async (item: NotificationItem): Promise<void> => {
    if (item.readAt !== null) return;
    try {
      await markRead.mutateAsync({ ids: [item.id] });
    } catch (err) {
      toast.error(mapNotificationError(err, tRoot, t));
    }
  };

  const handleToggleChannel = async (
    pref: NotificationPreference,
    channel: keyof NotificationChannels,
    next: boolean,
  ): Promise<void> => {
    if (pref.channels[channel] === next) return;
    try {
      await updatePref.mutateAsync({
        body: {
          eventKey: pref.eventKey,
          channels: { [channel]: next },
        },
      });
      toast.success(t('prefSavedToast'));
    } catch (err) {
      toast.error(mapNotificationError(err, tRoot, t));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        {tab === TAB_INBOX && (inbox?.unread ?? 0) > 0 ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={markRead.isPending}
            onClick={handleMarkAll}
            data-testid="mark-all-read"
          >
            <CheckCheck size={16} aria-hidden />
            {t('markAllRead')}
          </Button>
        ) : null}
      </div>

      <Tabs
        value={tab}
        onValueChange={handleTabChange}
        className="w-full"
        tabs={[
          { value: TAB_INBOX, label: t('tabs.inbox') },
          { value: TAB_PREFERENCES, label: t('tabs.preferences') },
          { value: TAB_DEVICES, label: t('tabs.devices') },
        ]}
      />

      {tab === TAB_INBOX ? (
        <InboxTab
          inbox={inbox}
          pending={inboxPending}
          error={inboxError}
          locale={locale}
          t={t}
          tRoot={tRoot}
          onMarkOne={handleMarkOne}
          onPage={setPage}
          page={page}
        />
      ) : tab === TAB_PREFERENCES ? (
        <PreferencesTab
          prefs={prefs}
          pending={prefsPending}
          error={prefsError}
          t={t}
          togglePending={updatePref.isPending}
          onToggle={handleToggleChannel}
        />
      ) : (
        <PushDevicesTab />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inbox tab
// ---------------------------------------------------------------------------

interface InboxTabProps {
  inbox: {
    items: NotificationItem[];
    unread: number;
    meta: { page: number; totalPages: number };
  } | null;
  pending: boolean;
  error: unknown;
  locale: string;
  t: ReturnType<typeof useTranslations>;
  tRoot: ReturnType<typeof useTranslations>;
  onMarkOne: (item: NotificationItem) => void;
  page: number;
  onPage: (page: number) => void;
}

function InboxTab({
  inbox,
  pending,
  error,
  locale,
  t,
  tRoot,
  onMarkOne,
  page,
  onPage,
}: InboxTabProps) {
  const { formatRelative, formatNumber } = createFormatters(locale);

  if (error) {
    return <ErrorState error={t('loadError')} />;
  }
  if (pending && !inbox) {
    return <Spinner aria-label={tRoot('common.loading')} />;
  }
  const items = inbox?.items ?? [];
  if (items.length === 0) {
    return <EmptyState icon={BellOff} title={t('emptyTitle')} description={t('emptyBody')} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted" data-testid="notifications-unread">
        {t('unreadSummary', { count: formatNumber(inbox?.unread ?? 0) })}
      </p>
      <ul className="flex flex-col divide-y divide-border-subtle" data-testid="notifications-list">
        {items.map((item) => {
          const unread = item.readAt === null;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onMarkOne(item)}
                aria-label={unread ? t('markOneAria') : undefined}
                data-testid="notification-row"
                data-read={unread ? 'false' : 'true'}
                className={cn(
                  'flex w-full flex-col items-start gap-1 py-3 text-start transition-colors',
                  unread ? 'bg-surface-alt/60 hover:bg-surface-alt' : 'hover:bg-surface-alt/50',
                )}
              >
                <div className="flex w-full flex-wrap items-center gap-2">
                  {unread ? (
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                  ) : null}
                  <span className={cn('text-sm', unread ? 'font-semibold text-text' : 'text-text')}>
                    {t(
                      `templates.${templateKey(item.eventKey, 'title')}` as 'templates.reviewRepliedTitle',
                      item.payload,
                    )}
                  </span>
                  {!unread ? (
                    <Badge variant="neutral">{t('readBadge')}</Badge>
                  ) : (
                    <Badge variant="primary">{t('unreadBadge')}</Badge>
                  )}
                  <span className="ms-auto text-xs text-muted">
                    {formatRelative(item.createdAt)}
                  </span>
                </div>
                <p className="text-sm text-muted">
                  {t(
                    `templates.${templateKey(item.eventKey, 'body')}` as 'templates.reviewRepliedBody',
                    item.payload,
                  )}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
      {inbox && inbox.meta.totalPages > 1 ? (
        <Pagination page={page} totalPages={inbox.meta.totalPages} onPageChange={onPage} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preferences tab
// ---------------------------------------------------------------------------

function PreferencesTab({
  prefs,
  pending,
  error,
  t,
  togglePending,
  onToggle,
}: {
  prefs: { preferences: NotificationPreference[] } | null;
  pending: boolean;
  error: unknown;
  t: ReturnType<typeof useTranslations>;
  togglePending: boolean;
  onToggle: (
    pref: NotificationPreference,
    channel: keyof NotificationChannels,
    next: boolean,
  ) => void;
}) {
  if (error) {
    return <ErrorState error={t('loadError')} />;
  }
  if (pending && !prefs) {
    return <Spinner />;
  }

  return (
    <div className="flex flex-col gap-3" data-testid="notification-preferences">
      <p className="text-sm text-muted">{t('preferencesIntro')}</p>
      <ul className="flex flex-col divide-y divide-border-subtle">
        {(prefs?.preferences ?? []).map((pref) => (
          <li
            key={pref.eventKey}
            className="flex flex-col gap-3 py-4"
            data-testid="preference-row"
            data-event={pref.eventKey}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-text">
                {t(`events.${eventLabelKey(pref.eventKey)}` as 'events.reviewReplied')}
              </span>
              {pref.overridden ? <Badge variant="neutral">{t('customBadge')}</Badge> : null}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {CHANNELS.map(({ matrix, icon: Icon }) => (
                <Switch
                  key={matrix}
                  checked={pref.channels[matrix]}
                  disabled={togglePending}
                  onChange={(next) => onToggle(pref, matrix, next)}
                  label={
                    <span className="inline-flex items-center gap-1.5 text-xs text-text-subtle">
                      <Icon size={14} aria-hidden />
                      {t(`channels.${matrix}` as 'channels.inApp')}
                    </span>
                  }
                />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key helpers — the enum values carry dots; the i18n keys are flat camelCase
// (events.reviewReplied, channels.inApp, …) per the seeded fallbacks.
// ---------------------------------------------------------------------------

function eventLabelKey(
  key: (typeof NOTIFICATION_EVENT_KEYS)[number],
): 'reviewReplied' | 'reviewVoted' | 'questionAnswered' | 'followCreated' | 'businessFavorited' {
  switch (key) {
    case 'review.replied':
      return 'reviewReplied';
    case 'review.voted':
      return 'reviewVoted';
    case 'question.answered':
      return 'questionAnswered';
    case 'follow.created':
      return 'followCreated';
    case 'business.favorited':
      return 'businessFavorited';
  }
}

/**
 * The wire event keys carry dots (`review.replied`) — next-intl forbids dots
 * INSIDE a literal key, so the web renders from the flat
 * `account.notifications.templates.<camelCase><Title|Body>` keys. The raw
 * payload vars ({actor}, {business}, …) pass through unchanged.
 */
function templateKey(eventKey: NotificationItem['eventKey'], part: 'title' | 'body'): string {
  const camel = eventLabelKey(eventKey);
  return `${camel}${part.charAt(0).toUpperCase()}${part.slice(1)}`;
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

function mapNotificationError(
  err: unknown,
  tRoot: ReturnType<typeof useTranslations>,
  t: ReturnType<typeof useTranslations>,
): string {
  if (!isApiRequestError(err)) return t('serverError');
  if (err.isRateLimited) return tRoot('auth.rateLimited');
  return tRoot(err.messageKey) ?? t('serverError');
}
