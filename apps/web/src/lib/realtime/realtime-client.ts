'use client';

/**
 * Realtime client singleton (F5.5). One Socket.IO client per browser tab,
 * shared by every `useRealtime*` hook via a ref-counted connect/disconnect so
 * multiple subscribers don't open multiple sockets.
 *
 * Transport contract (B5.5, packages/contracts/src/realtime.ts):
 *  - path `/api/v1/socket.io` (same origin as the API → cookies ride along,
 *    so the `at` access-token cookie authenticates the handshake without a
 *    separate WS token);
 *  - `withCredentials: true` so the credentialed CORS policy the
 *    RealtimeIoAdapter installed accepts the cross-origin cookie when the API
 *    and the web app are on different origins in production;
 *  - reconnection with exponential backoff (1s → 30s cap, infinite attempts)
 *    is the platform default — we keep it ON and surface the connection
 *    state so the UI can show a "reconnecting" affordance;
 *  - the `user:<id>` room is auto-joined server-side on connect (the gateway
 *    handles it in OnGatewayConnection), so the client never emits a
 *    room:join for the user's own room — only for `business:` / `conversation:`.
 *
 * The client is created lazily on first use and torn down when the last
 * subscriber unsubscribes; it is never created on the server (Next SSR has no
 * `window` and no cookie jar to authenticate with).
 */
import { io, type Socket } from 'socket.io-client';
import {
  REALTIME_JOIN_EVENT,
  REALTIME_LEAVE_EVENT,
  realtimeAckSchema,
  type RealtimeAck,
} from '@app/contracts';
import { env } from '../env';

/** The connection states the UI surfaces (matches Socket.IO's lifecycle). */
export type RealtimeStatus =
  | 'idle' // never connected (no subscriber yet)
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'
  | 'disconnected';

let socket: Socket | null = null;
let refCount = 0;
let lastStatus: RealtimeStatus = 'idle';
const statusListeners = new Set<(status: RealtimeStatus) => void>();

function setStatus(next: RealtimeStatus): void {
  if (next === lastStatus) return;
  lastStatus = next;
  for (const listener of statusListeners) listener(next);
}

/** The Socket.IO path the API's RealtimeIoAdapter mounts the server at. */
const WS_PATH = '/api/v1/socket.io';

/** Build the URL socket.io should connect to (origin only; path is set below). */
function socketUrl(): string {
  // env.NEXT_PUBLIC_API_URL is the full API base (`.../api/v1`); the socket
  // needs the ORIGIN only (socket.io appends the configured path itself).
  const api = env.NEXT_PUBLIC_API_URL.replace(/\/api\/v1\/?$/, '');
  return api;
}

/** Lazily create the singleton socket and wire its status transitions. */
function ensureSocket(): Socket {
  if (socket) return socket;
  const created = io(socketUrl(), {
    path: WS_PATH,
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 30_000,
    timeout: 20_000,
    // No `auth.token` — the `at` cookie authenticates the handshake (same
    // origin in dev; credentialed CORS in prod). Native clients without a
    // cookie jar would pass `auth: { token }` here.
    auth: {},
  });

  created.on('connect', () => setStatus('connected'));
  created.io.on('reconnect_attempt', () => setStatus('reconnecting'));
  created.on('disconnect', () => {
    // A `io.client` initiated disconnect (page hide / manual) → disconnected;
    // a server-side disconnect is also surfaced here.
    setStatus(socket?.active ? 'reconnecting' : 'disconnected');
  });
  created.io.on('error', () => setStatus('error'));
  created.on('connect_error', () => setStatus('error'));

  socket = created;
  return created;
}

/** Acquire the socket (ref-counted). Returns null on the server (no window). */
export function acquireRealtime(): Socket | null {
  if (typeof window === 'undefined') return null;
  refCount += 1;
  if (refCount === 1) {
    lastStatus = 'connecting';
    const s = ensureSocket();
    if (!s.connected) s.connect();
    // Notify any subscribers that already attached before connect fired.
    setStatus(s.connected ? 'connected' : 'connecting');
  }
  return socket;
}

/** Release the socket. The last subscriber tears it down cleanly. */
export function releaseRealtime(): void {
  if (typeof window === 'undefined') return;
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && socket) {
    const s = socket;
    socket = null;
    lastStatus = 'idle';
    s.removeAllListeners();
    s.io.removeAllListeners();
    s.disconnect();
  }
}

/** Subscribe to connection-status changes (called immediately with the current status). */
export function subscribeRealtimeStatus(listener: (status: RealtimeStatus) => void): () => void {
  statusListeners.add(listener);
  listener(lastStatus);
  return () => {
    statusListeners.delete(listener);
  };
}

/**
 * Emit `room:join` and resolve with the parsed ack. The server enforces
 * membership (FORBIDDEN_ROOM if the caller does not own/participate in the
 * room), so a rejection is a typed `RealtimeAck`, never a thrown error.
 */
export function joinRoom(socket: Socket, room: string): Promise<RealtimeAck> {
  return new Promise((resolve) => {
    socket.emit(REALTIME_JOIN_EVENT, { room }, (raw: unknown) => {
      const parsed = realtimeAckSchema.safeParse(raw);
      resolve(
        parsed.success ? parsed.data : { ok: false, code: 'BAD_ROOM', message: 'invalid ack' },
      );
    });
  });
}

/** Emit `room:leave` (fire-and-forget — the ack is not awaited by callers). */
export function leaveRoom(socket: Socket, room: string): void {
  socket.emit(REALTIME_LEAVE_EVENT, { room });
}

/** Test-only: reset the singleton between vitest cases. */
export function __resetRealtimeForTest(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.io.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  refCount = 0;
  lastStatus = 'idle';
  statusListeners.clear();
}
