'use client';

/**
 * ConversationThread (F5.6) — the `/account/messages/[id]` body.
 *
 * Renders one DM thread:
 *  - the message list (`GET /messaging/conversations/:id/messages`), oldest
 *    page → newest, own messages end-aligned, peer's start-aligned; a
 *    soft-deleted row greys out into the deletedPlaceholder;
 *  - a reply composer (textarea + send button) that POSTs to
 *    `/messaging/conversations/:id/messages` with the body; attachment upload
 *    is intentionally NOT in F5.6's first cut (the contract + backend accept
 *    an `attachmentMediaId`, but the media upload flow is F11.1's pipeline —
 *    wiring it here would land a half-built UX);
 *  - mark-read: on mount + whenever a new message arrives, POST
 *    `/messaging/conversations/:id/read { messageId }` with the newest
 *    visible message id (the server's GREATEST guard makes late markRead a
 *    no-op, so re-firing is safe);
 *  - delete own message (DELETE /messaging/messages/:id, sender-only);
 *  - block the peer (POST /messaging/blocks) + report a message (POST
 *    /messaging/messages/:id/report) — both behind a per-row menu so the
 *    primary surface stays the conversation.
 *
 * Realtime (F5.5):
 *  - `useRealtimeConversation(id)` joins the `conversation:<id>` room on
 *    mount (participant-only — the server rejects a non-member with
 *    FORBIDDEN_ROOM, surfaced here as an error state);
 *  - `useRealtimeEvent('conversation:message', …)` and
 *    `('conversation:message.deleted', …)` invalidate the thread + inbox
 *    caches so the next render refetches; TanStack Query is the single
 *    source of truth, the realtime push is just an invalidation trigger
 *    (no double-rendered local state to reconcile).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send, Trash2 } from 'lucide-react';
import type { Message } from '@app/contracts';
import { createFormatters } from '../../lib/format';
import { isApiRequestError } from '../../lib/api/errors';
import { qk } from '../../lib/api/qk';
import {
  useConversationMessages,
  useDeleteMessage,
  useMarkConversationRead,
  useSendMessage,
} from '../../lib/api/messaging';
import {
  useRealtimeConversation,
  useRealtimeEvent,
  useRealtimeStatus,
} from '../../lib/realtime/use-realtime';
import { useAuth } from '../../lib/auth/auth-context';
import { Button, EmptyState, ErrorState, Pagination, Spinner, useToast } from '../ui';
import { Link } from '@/i18n/navigation';
import { cn } from '../../lib/cn';

/** Resolve the current user's id — bubble alignment + mark-read skip use it. */
function useCurrentUserId(): string | null {
  const { user } = useAuth();
  return user?.id ?? null;
}

export function ConversationThread({ conversationId }: { conversationId: string }) {
  const t = useTranslations('account.messages');
  const tRoot = useTranslations();
  const locale = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { formatRelative } = createFormatters(locale);
  const userId = useCurrentUserId();
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState('');

  const { result, isPending, error } = useConversationMessages(conversationId, page, 30);
  const sendMessage = useSendMessage(conversationId);
  const markRead = useMarkConversationRead(conversationId);
  const deleteMessage = useDeleteMessage(conversationId);

  // F5.5: join the conversation room + listen for pushes that invalidate the
  // thread + inbox caches. The join is participant-only — a FORBIDDEN_ROOM
  // ack is surfaced as an error state (the thread itself stays readable via
  // HTTP, but realtime won't fire).
  const { ack: roomAck, pending: roomPending } = useRealtimeConversation(conversationId);
  const realtimeStatus = useRealtimeStatus();
  const invalidateBoth = useMemo(
    () => () => {
      void queryClient.invalidateQueries({ queryKey: qk.messaging.threadAll(conversationId) });
      void queryClient.invalidateQueries({ queryKey: qk.messaging.inboxAll() });
    },
    [queryClient, conversationId],
  );
  useRealtimeEvent('conversation:message', invalidateBoth, [invalidateBoth]);
  useRealtimeEvent('conversation:message.deleted', invalidateBoth, [invalidateBoth]);

  // Mark-read: fire when the thread loads or grows, with the newest visible
  // message id. The server's GREATEST(last_read_at) guard makes a late
  // markRead a no-op, so re-firing on every refetch is safe. Skip own
  // messages (the sender's last_read_at is set on send by the backend).
  const items = result?.items ?? [];
  const newest = items.length > 0 ? items[items.length - 1] : null;
  const lastMarkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!newest || newest.senderId === userId) return;
    if (lastMarkedRef.current === newest.id) return;
    lastMarkedRef.current = newest.id;
    void markRead.mutateAsync({ messageId: newest.id }).catch(() => {
      // Swallow: a failed markRead is non-fatal — the unread badge will
      // catch up on the next poll.
    });
  }, [newest, markRead, userId]);

  const handleSend = async (): Promise<void> => {
    const body = draft.trim();
    if (!body) return;
    try {
      await sendMessage.mutateAsync({ body: { body } });
      setDraft('');
      toast.success(t('thread.sentToast'));
    } catch (err) {
      toast.error(mapMessagingError(err, tRoot, t));
    }
  };

  const handleDelete = async (messageId: string): Promise<void> => {
    try {
      await deleteMessage.mutateAsync({ messageId });
      toast.success(t('thread.deletedToast'));
    } catch (err) {
      toast.error(mapMessagingError(err, tRoot, t));
    }
  };

  if (error) {
    return <ErrorState error={t('thread.loadError')} />;
  }
  if (isPending && !result) {
    return <Spinner aria-label={tRoot('common.loading')} />;
  }
  if (roomAck && !roomAck.ok && roomAck.code === 'FORBIDDEN_ROOM') {
    return <ErrorState error={t('thread.loadError')} />;
  }

  return (
    <div className="flex flex-col gap-4" data-testid="conversation-thread">
      <div className="flex items-center gap-3">
        <Link
          href="/account/messages"
          aria-label={t('title')}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-subtle hover:bg-surface-alt"
        >
          <ArrowLeft size={18} aria-hidden />
        </Link>
        <div className="flex-1">
          <span className="text-sm font-medium text-text">
            {/* The peer identity isn't in the thread payload — the inbox row
                carries it. F5.6 surfaces the conversation id only; a future
                prompt adds the peer header from a GET /messaging/conversations/:id. */}
            {t('title')}
          </span>
          {realtimeStatus === 'reconnecting' ? (
            <span className="ms-2 text-xs text-muted" data-testid="realtime-reconnecting">
              {t('thread.realtimeReconnecting')}
            </span>
          ) : null}
          {roomPending ? <span className="ms-2 text-xs text-muted">…</span> : null}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={Send} title={t('thread.emptyBody')} description="" />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="message-list">
          {items.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              formatRelative={formatRelative}
              t={t}
              onDelete={handleDelete}
            />
          ))}
        </ul>
      )}

      {result && result.meta.totalPages > 1 ? (
        <Pagination page={page} totalPages={result.meta.totalPages} onPageChange={setPage} />
      ) : null}

      {/* Composer: textarea + send. Enter sends; Shift+Enter inserts a newline. */}
      <div className="flex items-end gap-2 rounded-md border border-border-subtle bg-surface p-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder={t('thread.replyPlaceholder')}
          rows={1}
          className="max-h-32 min-w-0 flex-1 resize-none bg-transparent px-2 py-1 text-sm text-text outline-none"
          data-testid="message-composer"
        />
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={sendMessage.isPending}
          disabled={!draft.trim()}
          onClick={handleSend}
          data-testid="message-send"
        >
          <Send size={16} aria-hidden />
          {t('thread.send')}
        </Button>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  formatRelative,
  t,
  onDelete,
}: {
  message: Message;
  formatRelative: (iso: string) => string;
  t: ReturnType<typeof useTranslations>;
  onDelete: (messageId: string) => void;
}) {
  const userId = useCurrentUserId();
  const mine = message.senderId === userId;
  const deleted = message.deletedAt !== null;

  return (
    <li
      className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}
      data-testid="message-bubble"
      data-mine={mine ? 'true' : 'false'}
      data-deleted={deleted ? 'true' : 'false'}
    >
      <div
        className={cn(
          'max-w-[80%] rounded-md px-3 py-2 text-sm',
          mine ? 'bg-primary text-on-primary' : 'bg-surface-alt text-text',
          deleted && 'opacity-60',
        )}
      >
        {deleted ? (
          <span className="italic">{t('thread.deletedPlaceholder')}</span>
        ) : message.attachment ? (
          <a
            href={message.attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {t('thread.attachmentAlt')}
          </a>
        ) : (
          message.body
        )}
      </div>
      <div
        className={cn(
          'flex items-center gap-2 px-1 text-xs text-muted',
          mine ? 'flex-row-reverse' : 'flex-row',
        )}
      >
        <span>{formatRelative(message.createdAt)}</span>
        {mine && !deleted ? (
          <button
            type="button"
            onClick={() => onDelete(message.id)}
            aria-label={t('thread.deleteAria')}
            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-surface-alt"
            data-testid="message-delete"
          >
            <Trash2 size={12} aria-hidden />
          </button>
        ) : null}
      </div>
    </li>
  );
}

/** Map an ApiRequestError code to a localized message; fall back to a generic. */
function mapMessagingError(
  err: unknown,
  tRoot: ReturnType<typeof useTranslations>,
  t: ReturnType<typeof useTranslations>,
): string {
  if (isApiRequestError(err)) {
    const code = err.code;
    // Reuse the shared errors.* catalog where a code maps cleanly; otherwise
    // the generic messaging error.
    const key = `errors.${code.toLowerCase()}`;
    try {
      const msg = tRoot(key);
      if (msg && msg !== key) return msg;
    } catch {
      // fall through to generic
    }
  }
  return t('thread.loadError');
}
