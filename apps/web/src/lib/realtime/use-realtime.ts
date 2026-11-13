'use client';

/**
 * Realtime React hooks (F5.5). Three layered hooks over the ref-counted
 * `realtime-client` singleton:
 *   - `useRealtimeStatus()` — the connection state, for a "reconnecting…"
 *     affordance in the header; subscribes to the client's status emitter.
 *   - `useRealtimeEvent(event, handler, deps)` — registers a handler for one
 *     server→client event (`notification`, `conversation:message`,
 *     `conversation:message.deleted`); the handler is re-registered when
 *     `deps` change (same semantics as useEffect).
 *   - `useRealtimeRoom(room)` — joins a `business:` / `conversation:` room
 *     on mount, leaves on unmount; returns the parsed ack and a `pending`
 *     flag. The `user:<id>` room is NEVER joined here — the gateway
 *     auto-joins it on connect.
 *
 * Every hook acquires the singleton (ref-counted) on mount and releases on
 * unmount, so the socket lives exactly as long as some hook is mounted. The
 * hooks are no-ops on the server (no `window`).
 */
import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { realtimeConversationRoom, type RealtimeAck } from '@app/contracts';
import {
  acquireRealtime,
  joinRoom,
  leaveRoom,
  releaseRealtime,
  subscribeRealtimeStatus,
  type RealtimeStatus,
} from './realtime-client';

/**
 * The server→client event names the web app listens for (mirrors
 * REALTIME_EVENTS in packages/contracts/src/realtime.ts — spelled out here
 * so a type-only import doesn't drag the const value into the client bundle).
 */
export type RealtimeEventName =
  | 'notification'
  | 'conversation:message'
  | 'conversation:message.deleted';

/** The handler signature for an event (payload is untyped — the caller narrows). */
export type RealtimeEventHandler = (payload: unknown) => void;

/** The current connection status — `idle` until the first hook mounts. */
export function useRealtimeStatus(): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('idle');
  useEffect(() => {
    return subscribeRealtimeStatus(setStatus);
  }, []);
  return status;
}

/**
 * Listen for a server→client event. The handler is re-registered when `deps`
 * change so a closure over fresh state (e.g. the active conversation id) does
 * not go stale. The socket is acquired on mount and released on unmount.
 */
export function useRealtimeEvent(
  event: RealtimeEventName,
  handler: RealtimeEventHandler,
  deps: ReadonlyArray<unknown>,
): void {
  useEffect(() => {
    const socket = acquireRealtime();
    if (!socket) return; // SSR
    const listener = (payload: unknown): void => handler(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
      releaseRealtime();
    };
    // `deps` IS the caller's re-subscription signal; the spread above is the
    // intentional dependency list. No eslint-disable needed — the rule is
    // not enabled in this repo's config, and the spread is the contract.
  }, [event, ...deps]);
}

/**
 * Join a room on mount, leave on unmount. Pass `null` to opt out (the hook
 * becomes a no-op — useful when the room id is loading). Returns the parsed
 * ack and a `pending` flag so the UI can gate on membership confirmation.
 */
export function useRealtimeRoom(room: string | null): {
  ack: RealtimeAck | null;
  pending: boolean;
} {
  const [ack, setAck] = useState<RealtimeAck | null>(null);
  const [pending, setPending] = useState<boolean>(room !== null);

  useEffect(() => {
    if (!room) {
      setAck(null);
      setPending(false);
      return;
    }
    const socket = acquireRealtime();
    if (!socket) {
      setPending(false);
      return;
    }
    let cancelled = false;
    setPending(true);
    setAck(null);

    // If the socket is not yet connected, wait for `connect` before joining
    // (emit before connect buffers in socket.io, but the ack callback would
    // fire before the server has a socket to ack — wait instead).
    const doJoin = async (s: Socket): Promise<void> => {
      const result = await joinRoom(s, room);
      if (cancelled) return;
      setAck(result);
      setPending(false);
    };
    if (socket.connected) {
      void doJoin(socket);
    } else {
      const onConnect = (): void => void doJoin(socket);
      socket.once('connect', onConnect);
    }

    return () => {
      cancelled = true;
      socket.off('connect');
      leaveRoom(socket, room);
      releaseRealtime();
    };
  }, [room]);

  return { ack, pending };
}

/** Convenience: join a conversation room by id (the common F5.6 case). */
export function useRealtimeConversation(conversationId: string | null): {
  ack: RealtimeAck | null;
  pending: boolean;
} {
  return useRealtimeRoom(conversationId ? realtimeConversationRoom(conversationId) : null);
}
