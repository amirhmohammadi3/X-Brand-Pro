'use client';

/**
 * MessagingInbox (F5.6) — the `/account/messages` body.
 *
 * Renders the inbox (`GET /messaging/conversations`): one card per DM with
 * the peer's avatar + name, the trimmed last-message preview (or a
 * "[deleted]" / attachment marker when the last row is soft-deleted or
 * attachment-only), the relative timestamp, and an unread badge. Each card
 * links to `/account/messages/<conversationId>`.
 *
 * Realtime (F5.5): the inbox itself does NOT subscribe to realtime events —
 * the conversation page does, and its invalidations propagate to the inbox
 * via the shared `qk.messaging.inboxAll()` prefix. When the user navigates
 * back from a conversation to the inbox, the cache is already fresh (or
 * refetches on focus). This keeps the inbox component simple and avoids a
 * duplicate socket subscriber when both pages could be mounted.
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { MessageSquareOff } from 'lucide-react';
import type { ConversationCard } from '@app/contracts';
import { createFormatters } from '../../lib/format';
import { useMessagingInbox } from '../../lib/api/messaging';
import { Avatar, Badge, EmptyState, ErrorState, Pagination, Spinner } from '../ui';
import { Link } from '@/i18n/navigation';
import { cn } from '../../lib/cn';

export function MessagingInbox() {
  const t = useTranslations('account.messages');
  const tRoot = useTranslations();
  const locale = useLocale();
  const [page, setPage] = useState(1);

  const { result, isPending, error } = useMessagingInbox(page, 20, true);

  if (error) {
    return <ErrorState error={t('loadError')} />;
  }
  if (isPending && !result) {
    return <Spinner aria-label={tRoot('common.loading')} />;
  }

  const items = result?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <EmptyState icon={MessageSquareOff} title={t('emptyTitle')} description={t('emptyBody')} />
      </div>
    );
  }

  const { formatRelative } = createFormatters(locale);

  return (
    <div className="flex flex-col gap-6" data-testid="messaging-inbox">
      <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
      <ul className="flex flex-col divide-y divide-border-subtle">
        {items.map((card) => (
          <ConversationRow key={card.id} card={card} formatRelative={formatRelative} t={t} />
        ))}
      </ul>
      {result && result.meta.totalPages > 1 ? (
        <Pagination page={page} totalPages={result.meta.totalPages} onPageChange={setPage} />
      ) : null}
    </div>
  );
}

function ConversationRow({
  card,
  formatRelative,
  t,
}: {
  card: ConversationCard;
  formatRelative: (iso: string) => string;
  t: ReturnType<typeof useTranslations>;
}) {
  const peer = card.peer;
  const name = peer.displayName ?? peer.username;
  const last = card.lastMessage;
  const unread = card.unreadCount > 0;

  // The preview: a deleted last message → placeholder; an attachment-only
  // message → the attachment marker; otherwise the trimmed body.
  let preview: string;
  if (!last) {
    preview = '';
  } else if (last.deleted) {
    preview = t('thread.deletedPlaceholder');
  } else if (last.bodyPreview) {
    preview = last.bodyPreview;
  } else if (last.hasAttachment) {
    preview = t('thread.attachmentAlt');
  } else {
    preview = '';
  }

  return (
    <li>
      <Link
        href={`/account/messages/${card.id}`}
        data-testid="conversation-row"
        data-conversation-id={card.id}
        data-unread={unread ? 'true' : 'false'}
        aria-label={unread ? t('unreadBadge', { count: card.unreadCount }) + ' — ' + name : name}
        className={cn(
          'flex items-center gap-3 py-3 transition-colors hover:bg-surface-alt/50',
          unread && 'bg-surface-alt/30',
        )}
      >
        <Avatar src={peer.avatarUrl ?? undefined} name={name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn('truncate text-sm', unread ? 'font-semibold text-text' : 'text-text')}
            >
              {name}
            </span>
            {card.lastMessageAt ? (
              <span className="ms-auto shrink-0 text-xs text-muted">
                {formatRelative(card.lastMessageAt)}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted">{preview}</p>
        </div>
        {unread ? (
          <Badge variant="primary" data-testid="conversation-unread">
            {t('unreadBadge', { count: card.unreadCount })}
          </Badge>
        ) : null}
      </Link>
    </li>
  );
}
