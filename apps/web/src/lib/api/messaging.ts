'use client';

/**
 * Messaging API hooks (F5.6). Every JSON call goes through the shared
 * `apiFetch` (envelope-validated with the B5.6 contract schemas) and
 * TanStack Query via `useApiMutation`.
 *
 * Cache strategy:
 * - the inbox is keyed by page+pageSize; a new message or a mark-read
 *   invalidates the whole `qk.messaging.inboxAll()` subtree so the unread
 *   badges and the sort order move together;
 * - one thread is keyed by conversation id + page; sending / deleting /
 *   marking-read invalidates BOTH that thread and the inbox (the inbox's
 *   last-message preview and unread count depend on the same rows);
 * - the blocks list is keyed once per user; block/unblock invalidates it.
 *
 * Realtime (F5.5): the conversation page subscribes to
 * `conversation:message` / `conversation:message.deleted` events and
 * invalidates the thread + inbox on every push — the TanStack cache is the
 * single source of truth, the realtime event is just an invalidation
 * trigger (no double-rendered local state).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  blockResultSchema,
  blocksResultSchema,
  createConversationBodySchema,
  createConversationResultSchema,
  deleteMessageResultSchema,
  inboxResultSchema,
  markReadBodySchema,
  markReadResultSchema,
  reportMessageBodySchema,
  reportMessageResultSchema,
  sendMessageBodySchema,
  conversationMessagesResultSchema,
  type BlockResult,
  type BlocksResult,
  type CreateConversationBody,
  type CreateConversationResult,
  type DeleteMessageResult,
  type InboxResult,
  type MarkReadBody,
  type MarkReadResult,
  type ReportMessageBody,
  type ReportMessageResult,
  type SendMessageBody,
  type ConversationMessagesResult,
} from '@app/contracts';
import { apiFetch } from './client';
import { useApiMutation } from './use-api-mutation';
import { qk } from './qk';

/** Inbox + thread page sizes (≤ 100 per the pagination contract). */
export const MESSAGING_INBOX_PAGE_SIZE = 20;
export const MESSAGING_THREAD_PAGE_SIZE = 30;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** `GET /messaging/conversations` — the inbox, most recently active first. */
export function useMessagingInbox(
  page: number,
  pageSize: number = MESSAGING_INBOX_PAGE_SIZE,
  enabled = true,
): {
  result: InboxResult | null;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<InboxResult>({
    queryKey: qk.messaging.inbox(page, pageSize),
    queryFn: async () => {
      const res = await apiFetch('/messaging/conversations', inboxResultSchema, {
        query: { page, pageSize },
      });
      return res.data;
    },
    enabled,
    staleTime: 30_000,
  });
  return { result: query.data ?? null, isPending: query.isPending, error: query.error };
}

/** `GET /messaging/conversations/:id/messages` — one thread page (oldest→newest). */
export function useConversationMessages(
  conversationId: string | null,
  page: number,
  pageSize: number = MESSAGING_THREAD_PAGE_SIZE,
): {
  result: ConversationMessagesResult | null;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<ConversationMessagesResult>({
    queryKey: qk.messaging.thread(conversationId ?? '', page, pageSize),
    queryFn: async () => {
      const res = await apiFetch(
        `/messaging/conversations/${encodeURIComponent(conversationId!)}/messages`,
        conversationMessagesResultSchema,
        { query: { page, pageSize } },
      );
      return res.data;
    },
    enabled: conversationId !== null,
    staleTime: 15_000,
  });
  return { result: query.data ?? null, isPending: query.isPending, error: query.error };
}

/** `GET /messaging/blocks` — the caller's blocked users. */
export function useMessagingBlocks(enabled = true): {
  result: BlocksResult | null;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<BlocksResult>({
    queryKey: qk.messaging.blocks(),
    queryFn: async () => {
      const res = await apiFetch('/messaging/blocks', blocksResultSchema);
      return res.data;
    },
    enabled,
    staleTime: 60_000,
  });
  return { result: query.data ?? null, isPending: query.isPending, error: query.error };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** `POST /messaging/conversations { peerId }` — get-or-create a DM. */
export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useApiMutation<CreateConversationResult, { body: CreateConversationBody }>(
    async ({ body }) => {
      const res = await apiFetch('/messaging/conversations', createConversationResultSchema, {
        method: 'POST',
        body: createConversationBodySchema.parse(body),
      });
      return res.data;
    },
    {
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: qk.messaging.inboxAll() });
      },
    },
  );
}

/** `POST /messaging/conversations/:id/messages` — send a body or attachment. */
export function useSendMessage(conversationId: string) {
  const queryClient = useQueryClient();
  return useApiMutation<ConversationMessagesResult['items'][number], { body: SendMessageBody }>(
    async ({ body }) => {
      const res = await apiFetch(
        `/messaging/conversations/${encodeURIComponent(conversationId)}/messages`,
        sendMessageResponseSchema,
        { method: 'POST', body: sendMessageBodySchema.parse(body) },
      );
      return res.data;
    },
    {
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: qk.messaging.threadAll(conversationId) });
        void queryClient.invalidateQueries({ queryKey: qk.messaging.inboxAll() });
      },
    },
  );
}

/** The POST /messages response is one `message` row (the contract exports it
 *  as `messageSchema`; re-import here to avoid a circular type reference). */
import { messageSchema } from '@app/contracts';
const sendMessageResponseSchema = messageSchema;

/** `POST /messaging/conversations/:id/read { messageId }` — read receipt. */
export function useMarkConversationRead(conversationId: string) {
  const queryClient = useQueryClient();
  return useApiMutation<MarkReadResult, MarkReadBody>(
    async (body) => {
      const res = await apiFetch(
        `/messaging/conversations/${encodeURIComponent(conversationId)}/read`,
        markReadResultSchema,
        { method: 'POST', body: markReadBodySchema.parse(body) },
      );
      return res.data;
    },
    {
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: qk.messaging.threadAll(conversationId) });
        void queryClient.invalidateQueries({ queryKey: qk.messaging.inboxAll() });
      },
    },
  );
}

/** `DELETE /messaging/messages/:id` — soft delete (sender-only). */
export function useDeleteMessage(conversationId: string) {
  const queryClient = useQueryClient();
  return useApiMutation<DeleteMessageResult, { messageId: string }>(
    async ({ messageId }) => {
      const res = await apiFetch(
        `/messaging/messages/${encodeURIComponent(messageId)}`,
        deleteMessageResultSchema,
        { method: 'DELETE' },
      );
      return res.data;
    },
    {
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: qk.messaging.threadAll(conversationId) });
        void queryClient.invalidateQueries({ queryKey: qk.messaging.inboxAll() });
      },
    },
  );
}

/** `POST /messaging/messages/:id/report { reason, details? }`. */
export function useReportMessage() {
  return useApiMutation<ReportMessageResult, { messageId: string; body: ReportMessageBody }>(
    async ({ messageId, body }) => {
      const res = await apiFetch(
        `/messaging/messages/${encodeURIComponent(messageId)}/report`,
        reportMessageResultSchema,
        { method: 'POST', body: reportMessageBodySchema.parse(body) },
      );
      return res.data;
    },
  );
}

/** `POST /messaging/blocks { userId }` — block a user. */
export function useBlockUser() {
  const queryClient = useQueryClient();
  return useApiMutation<BlockResult, { userId: string }>(
    async ({ userId }) => {
      const res = await apiFetch('/messaging/blocks', blockResultSchema, {
        method: 'POST',
        body: { userId },
      });
      return res.data;
    },
    {
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: qk.messaging.blocksAll() });
      },
    },
  );
}

/** `DELETE /messaging/blocks/:userId` — unblock. */
export function useUnblockUser() {
  const queryClient = useQueryClient();
  return useApiMutation<BlockResult, { userId: string }>(
    async ({ userId }) => {
      const res = await apiFetch(
        `/messaging/blocks/${encodeURIComponent(userId)}`,
        blockResultSchema,
        { method: 'DELETE' },
      );
      return res.data;
    },
    {
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: qk.messaging.blocksAll() });
      },
    },
  );
}
