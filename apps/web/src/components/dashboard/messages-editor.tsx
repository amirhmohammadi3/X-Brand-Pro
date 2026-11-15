'use client';

/**
 * MessagesEditor (F7.6) — the `/dashboard/:businessId/messages` body.
 *
 * The owner's DM inbox shortcut inside the business dashboard. The messaging
 * backend (B5.6) is user-to-user: a DM conversation belongs to the OWNER as a
 * user, NOT to the business. There is no business-scoped conversation table,
 * so the dashboard messages section is an *owner-as-user* inbox console — the
 * owner lands on `/dashboard/:businessId/messages` from the sidebar and sees
 * their own DM inbox without leaving the dashboard.
 *
 * Each conversation links to the EXISTING user-side thread route
 * `/account/messages/<conversationId>` (F5.6): the thread page already owns
 * the realtime subscription, the composer, mark-read, delete and report
 * flows. Minting a dashboard-owned thread route would duplicate every one of
 * those for zero new data and a new authz surface — the dashboard's job here
 * is "see and jump into the conversation," not "re-host the chat." This is the
 * same reuse decision F7.4 made (the owner's reviews console reads the PUBLIC
 * list, no owner-specific endpoint).
 *
 * The inbox itself is the F5.6 `useMessagingInbox` hook (TanStack Query against
 * `GET /messaging/conversations`); the same key prefix the user-side inbox
 * uses, so a send from the thread page invalidates this list too. No new
 * backend endpoint, no new contract, no new migration.
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { MessageSquareOff } from 'lucide-react';
import type { ConversationCard } from '@app/contracts';
import { createFormatters } from '../../lib/format';
import { useMessagingInbox } from '../../lib/api/messaging';
import { Avatar, Badge, EmptyState, ErrorState, Heading, Pagination, Spinner } from '../ui';
import { Link } from '@/i18n/navigation';
import { cn } from '../../lib/cn';

const PAGE_SIZE = 20;

export function MessagesEditor({ businessId }: { businessId: string }) {
  const t = useTranslations('dashboard');
  const tRoot = useTranslations();
  const locale = useLocale();
  const [page, setPage] = useState(1);

  // The inbox is the owner's, not the business's. We deliberately ignore
  // `businessId` for the read — it is here only so the sidebar's active state
  // and the server page's ownership probe (GET /businesses/:id) stay in scope.
  void businessId;

  const { result, isPending, error } = useMessagingInbox(page, PAGE_SIZE, true);

  if (error) {
    return <ErrorState error={t('messages.loadError')} />;
  }
  if (isPending && !result) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner aria-label={tRoot('common.loading')} />
      </div>
    );
  }

  const items = result?.items ?? [];
  const meta = result?.meta;
  const { formatRelative } = createFormatters(locale);

  return (
    <div className="flex flex-col gap-4" data-testid="dashboard-messages">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Heading level="h2" className="text-lg">
          {t('messages.title')}
        </Heading>
        {meta ? (
          <span className="text-sm text-text-subtle">
            {t('messages.count', { total: meta.total })}
          </span>
        ) : null}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={MessageSquareOff}
          title={t('messages.emptyTitle')}
          description={t('messages.emptyBody')}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle">
          {items.map((card) => (
            <ConversationRow key={card.id} card={card} formatRelative={formatRelative} t={t} />
          ))}
        </ul>
      )}

      {meta && meta.totalPages > 1 ? (
        <Pagination page={meta.page} totalPages={meta.totalPages} onPageChange={setPage} />
      ) : null}
    </div>
  );
}

interface ConversationRowProps {
  card: ConversationCard;
  formatRelative: (iso: string) => string;
  t: ReturnType<typeof useTranslations>;
}

function ConversationRow({ card, formatRelative, t }: ConversationRowProps) {
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
    preview = t('messages.thread.deletedPlaceholder');
  } else if (last.bodyPreview) {
    preview = last.bodyPreview;
  } else if (last.hasAttachment) {
    preview = t('messages.thread.attachmentAlt');
  } else {
    preview = '';
  }

  return (
    <li>
      {/* The conversation lives on the user side (/account/messages/:id) — the
          dashboard is a jump-in shortcut, not a re-host of the thread UI. */}
      <Link
        href={`/account/messages/${card.id}`}
        data-testid="dashboard-conversation-row"
        data-conversation-id={card.id}
        data-unread={unread ? 'true' : 'false'}
        aria-label={
          unread ? `${t('messages.unreadBadge', { count: card.unreadCount })} — ${name}` : name
        }
        className={cn(
          'flex items-center gap-3 px-3 py-3 transition-colors hover:bg-surface-alt/50',
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
          <Badge variant="primary" data-testid="dashboard-conversation-unread">
            {t('messages.unreadBadge', { count: card.unreadCount })}
          </Badge>
        ) : null}
      </Link>
    </li>
  );
}
