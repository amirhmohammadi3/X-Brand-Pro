import { z } from 'zod';
import { uuidSchema } from './primitives.js';

/**
 * Realtime gateway protocol (B5.5) — the ONLY contract between the Socket.IO
 * server and every client (web app now, more later). Kept in contracts so
 * the server cannot rename an event or a room grammar without breaking the
 * shared package the web app compiles against.
 *
 * Transport facts (server-owned, not negotiated per client):
 * - Socket.IO over the API origin, path `/api/v1/socket.io` (behind the same
 *   global prefix as HTTP; cookies are not scoped by path rules here).
 * - Handshake auth: the access token arrives as the `at` cookie OR
 *   `auth.token` in socket.handshake.auth (native/SSR clients without a
 *   cookie jar) — the SAME token the HTTP guards accept, verified against
 *   the SAME session/user state. No separate "ws token" exists, so revoking
 *   a session revokes the socket too.
 * - Rooms are SERVER-ENFORCED namespaces, never client-controlled strings:
 *   `user:<uuid>` (auto-joined on connect, own-only) and `business:<uuid>`
 *   (join on demand, owner-only). Unknown kinds are rejected; B5.6 adds
 *   `conversation:<uuid>` when the messaging domain defines membership.
 * - The Redis adapter fans one server's emits out to every gateway instance,
 *   so `emitToUser` works no matter which pod holds the target socket.
 */

/** Client → server: join a room (server answers with an ack). */
export const REALTIME_JOIN_EVENT = 'room:join' as const;
/** Client → server: leave a room (server answers with an ack). */
export const REALTIME_LEAVE_EVENT = 'room:leave' as const;
/** Server → client: a request failed (bad room grammar, not a member...). */
export const REALTIME_ERROR_EVENT = 'realtime:error' as const;

/** Ack shape for room:join / room:leave — ok=false carries a stable code. */
export const realtimeAckSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), room: z.string().min(1) }),
  z.object({
    ok: z.literal(false),
    code: z.enum(['BAD_ROOM', 'FORBIDDEN_ROOM']),
    message: z.string().min(1),
  }),
]);
export type RealtimeAck = z.infer<typeof realtimeAckSchema>;

/**
 * The room kinds that exist today. `conversation` arrived with B5.6 — a
 * participant-only room per DM (membership is checked against
 * conversation_participants on every join/leave, never trusted from the
 * client).
 */
export const REALTIME_ROOM_KINDS = ['user', 'business', 'conversation'] as const;
export type RealtimeRoomKind = (typeof REALTIME_ROOM_KINDS)[number];

/**
 * The strict room grammar: `<kind>:<uuid>`. Everything else (wildcards,
 * `socket:<id>`, global rooms) is client-invisible — the gateway never
 * joins a socket into a room it did not derive from this parser.
 */
export const realtimeRoomSchema = z
  .string()
  .regex(
    /^(user|business|conversation):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );

/** Parse a room string into its parts, or null when the grammar is violated. */
export function parseRealtimeRoom(room: string): { kind: RealtimeRoomKind; id: string } | null {
  const match =
    /^(user|business|conversation):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(
      room,
    );
  const kind = match?.[1];
  const id = match?.[2];
  if ((kind !== 'user' && kind !== 'business' && kind !== 'conversation') || !id) return null;
  return { kind, id };
}

/** Canonical room builders — the single spelling for both apps. */
export function realtimeUserRoom(userId: string): string {
  return `user:${userId}`;
}
export function realtimeBusinessRoom(businessId: string): string {
  return `business:${businessId}`;
}
export function realtimeConversationRoom(conversationId: string): string {
  return `conversation:${conversationId}`;
}

/** Client payload for room:join / room:leave (same shape both ways). */
export const roomRequestSchema = z.object({ room: realtimeRoomSchema });
export type RoomRequest = z.infer<typeof roomRequestSchema>;

/** What the handshake must carry when there is no cookie (auth.token). */
export const realtimeHandshakeAuthSchema = z.object({ token: z.string().min(1).optional() });
export type RealtimeHandshakeAuth = z.infer<typeof realtimeHandshakeAuthSchema>;

/** Server → client event names reserved for platform pushes (B5.6/B5.7 use them). */
export const REALTIME_EVENTS = {
  notification: 'notification',
  /** A new message landed in a conversation the socket follows (B5.6). */
  conversationMessage: 'conversation:message',
  /** A message was soft-deleted by its sender (B5.6 — the bubble greys out). */
  conversationMessageDeleted: 'conversation:message.deleted',
} as const;

/** uuidSchema reuse guard: room uuids use the same strictness as API ids. */
const _roomUuidCheck = uuidSchema.safeParse('00000000-0000-4000-8000-000000000000');
if (!_roomUuidCheck.success) throw new Error('realtime: uuidSchema drifted');
