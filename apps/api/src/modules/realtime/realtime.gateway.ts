import { Inject, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import {
  REALTIME_JOIN_EVENT,
  REALTIME_LEAVE_EVENT,
  parseRealtimeRoom,
  realtimeUserRoom,
  type RealtimeAck,
} from '@app/contracts';
import { REDIS, type RedisLike } from '../../redis/redis.client.js';
import {
  BUSINESSES_REPOSITORY,
  type BusinessesRepositoryLike,
} from '../business/businesses.repository.js';
// Value imports (not type-only): Nest reads the injected classes' types at
// runtime via emitDecoratorMetadata — type-only would break DI.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { RealtimeAuthService, type RealtimeUser } from './realtime-auth.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { RealtimeService } from './realtime.service.js';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';

/**
 * Minimal cookie-header parser for the WS handshake. Deliberately local:
 * cookie-parser 1.x does not export a parser function, and pulling the
 * `cookie` package in just for this would add a dependency for ten lines.
 * Values are URL-decoded (browser cookie serialization); names are kept
 * verbatim (the app's cookie names are plain ASCII).
 */
function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}

const logSilent = (): void => undefined;

/**
 * Structural type for the adapter's two duplicated clients — the exact
 * surface the gateway touches (`on`, `connect`, `disconnect`), so ioredis's
 * dual-mode generics never leak into this file (same philosophy as the
 * RedisLike interface).
 */
interface AdapterRedisLike {
  on(event: 'error', listener: () => void): unknown;
  connect(): Promise<void>;
  disconnect(): void;
}

/** The optional ioredis-only surface the gateway probes REDIS for. */
interface IoredisCarrier {
  redis?: {
    duplicate(overrides?: Record<string, unknown>): AdapterRedisLike;
  };
}

/**
 * The realtime gateway (B5.5): one authenticated Socket.IO server for the
 * whole platform, mounted at `/api/v1/socket.io` (see RealtimeIoAdapter).
 *
 * Auth (handshake middleware — a socket NEVER connects without an identity):
 * token from `Authorization: Bearer`, the `at` cookie, or
 * `handshake.auth.token` (native clients without a cookie jar) → the same
 * verify/liveness/status chain as JwtAuthGuard (RealtimeAuthService). A
 * rejected handshake gets UNAUTHENTICATED.
 *
 * Rooms (server-enforced, never client-chosen strings):
 *  - `user:<id>`  — auto-joined on connect; own room only.
 *  - `business:<id>` — joined on demand (room:join); owner-only via the
 *    businesses repository (the ownerId relationship drives ownership, not
 *    the role tag — AGENTS.md contracts note).
 *  Room grammar + ack codes live in contracts/realtime.ts; unknown kinds
 *  are rejected at parse level (B5.6 adds `conversation:<id>` there).
 *
 * Redis adapter (fail-soft): on boot, two deduplicated ioredis clients are
 * attached as pub/sub so `emitToUser` reaches sockets on ANY instance.
 * If Redis is unavailable the gateway falls back to the in-memory adapter —
 * single-instance delivery only, boot never crashes (same fail-soft stance
 * as CacheService/RateLimiterService). Rejection errors are swallowed to
 * keep ioredis's reconnect loop from becoming an unhandled 'error' event.
 */
@WebSocketGateway()
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnApplicationShutdown
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private pubClient: AdapterRedisLike | null = null;
  private subClient: AdapterRedisLike | null = null;

  constructor(
    private readonly auth: RealtimeAuthService,
    private readonly realtime: RealtimeService,
    @Inject(BUSINESSES_REPOSITORY) private readonly businesses: BusinessesRepositoryLike,
    @Inject(REDIS) private readonly redis: RedisLike,
  ) {}

  @WebSocketServer()
  server!: Server;

  afterInit(server: Server): void {
    this.realtime.registerServer(server);

    // Handshake auth — rejects before any connection event fires.
    server.use(async (socket, next) => {
      try {
        const headers = socket.handshake.headers;
        const authHeader = headers.authorization;
        const bearer =
          typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
            ? authHeader.slice('Bearer '.length).trim()
            : undefined;
        const cookies = parseCookieHeader(headers.cookie);
        const token = bearer || cookies.at || socket.handshake.auth?.token;
        const user = await this.auth.authenticate(token);
        if (!user) {
          next(new Error('UNAUTHENTICATED'));
          return;
        }
        socket.data.user = user;
        next();
      } catch (err) {
        this.logger.error(`Handshake auth failed unexpectedly: ${String(err)}`);
        next(new Error('UNAUTHENTICATED'));
      }
    });

    this.attachRedisAdapter(server);
  }

  async handleConnection(client: Socket): Promise<void> {
    const user = client.data.user as RealtimeUser | undefined;
    if (!user) {
      // Handshake middleware already rejects; this is belt-and-braces for
      // any future path that bypasses it (e.g. a namespace override).
      client.disconnect(true);
      return;
    }
    await client.join(realtimeUserRoom(user.id));
    this.logger.debug(`Realtime connect user=${user.id} sockets=${this.socketCount()}`);
  }

  handleDisconnect(client: Socket): void {
    const user = client.data.user as RealtimeUser | undefined;
    this.logger.debug(`Realtime disconnect user=${user?.id ?? 'unknown'}`);
  }

  @SubscribeMessage(REALTIME_JOIN_EVENT)
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<RealtimeAck> {
    return this.joinRoom(client, payload);
  }

  @SubscribeMessage(REALTIME_LEAVE_EVENT)
  async handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<RealtimeAck> {
    const room = this.roomName(payload);
    const parsed = parseRealtimeRoom(room);
    if (!parsed) return this.nack('BAD_ROOM', 'Unknown room');
    await client.leave(room);
    return { ok: true, room };
  }

  /**
   * Join with the full ACL. Leaving is always allowed for a well-formed
   * room; joining needs: your own user room, or an owned business room.
   */
  private async joinRoom(client: Socket, payload: unknown): Promise<RealtimeAck> {
    const user = client.data.user as RealtimeUser | undefined;
    if (!user) return this.nack('BAD_ROOM', 'Not authenticated');

    const room = this.roomName(payload);
    const parsed = parseRealtimeRoom(room);
    if (!parsed) return this.nack('BAD_ROOM', 'Unknown room');

    const allowed =
      parsed.kind === 'user' ? parsed.id === user.id : await this.ownsBusiness(user.id, parsed.id);
    if (!allowed) return this.nack('FORBIDDEN_ROOM', 'Not allowed to join this room');

    await client.join(room);
    return { ok: true, room };
  }

  /** Ownership check via the businesses repository (single-row read). */
  private async ownsBusiness(userId: string, businessId: string): Promise<boolean> {
    const detail = await this.businesses.findById(businessId);
    return detail?.ownerId === userId && detail.ownerId !== null;
  }

  /** Extract the room string from an arbitrary client payload. */
  private roomName(payload: unknown): string {
    if (typeof payload !== 'object' || payload === null) return '';
    const room = (payload as Record<string, unknown>).room;
    return typeof room === 'string' ? room : '';
  }

  private nack(code: 'BAD_ROOM' | 'FORBIDDEN_ROOM', message: string): RealtimeAck {
    return { ok: false, code, message };
  }

  private socketCount(): number {
    return this.server?.sockets?.sockets?.size ?? 0;
  }

  /**
   * Fail-soft Redis adapter: two deduplicated clients (pub + sub) over the
   * EXISTING Redis connection — one extra socket pair, not two more pools.
   * The duplicates drop the app key prefix (adapter channel names must be
   * identical across every instance) and lift maxRetriesPerRequest so a
   * reconnecting adapter client never rejects an in-flight publish.
   */
  private attachRedisAdapter(server: Server): void {
    const carrier = this.redis as unknown as IoredisCarrier;
    if (!carrier.redis || typeof carrier.redis.duplicate !== 'function') {
      this.logger.log('Realtime: in-memory adapter (no ioredis instance available)');
      return;
    }
    const pub = carrier.redis.duplicate({ keyPrefix: '', maxRetriesPerRequest: null });
    const sub = carrier.redis.duplicate({ keyPrefix: '', maxRetriesPerRequest: null });
    pub.on('error', logSilent);
    sub.on('error', logSilent);
    void Promise.all([pub.connect(), sub.connect()])
      .then(() => {
        server.adapter(createAdapter(pub, sub));
        this.pubClient = pub;
        this.subClient = sub;
        this.logger.log('Realtime: Redis adapter attached (cross-instance emit active)');
      })
      .catch(() => {
        pub.disconnect();
        sub.disconnect();
        this.logger.warn('Realtime: Redis adapter unavailable — staying in-memory');
      });
  }

  onApplicationShutdown(): void {
    // Only the DUPLICATED clients are ours to clean up — the shared pub
    // client's lifecycle belongs to RedisService.onApplicationShutdown.
    this.pubClient?.disconnect();
    this.subClient?.disconnect();
    this.pubClient = null;
    this.subClient = null;
  }
}
