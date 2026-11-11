import { describe, expect, it, vi } from 'vitest';
import { RealtimeAuthService } from '../src/modules/realtime/realtime-auth.service.js';
import {
  parseRealtimeRoom,
  realtimeBusinessRoom,
  realtimeConversationRoom,
  realtimeUserRoom,
} from '@app/contracts';
import type { TokenService } from '../src/modules/auth/token.service.js';
import type { SessionService } from '../src/modules/auth/session.service.js';
import type { UsersService } from '../src/modules/users/users.service.js';
import type { UserRow } from '../src/db/schema/users.js';

/**
 * B5.5 unit tests — the pure pieces of the realtime gateway:
 *  1. RealtimeAuthService.authenticate: the handshake auth chain mirrors
 *     JwtAuthGuard exactly (token → session liveness → effective status),
 *     and ANY failure is a null — the WS equivalent of 401.
 *  2. contracts.parseRealtimeRoom: the server-enforced room grammar. These
 *     cases are the boundary between "client-provided string" and "room the
 *     gateway will ever touch".
 */

const UID = '11111111-1111-4111-8111-111111111111';

function makeTokens(verify: (token: string) => Promise<unknown>): TokenService {
  return { verifyAccess: verify } as unknown as TokenService;
}

function makeSessions(active: boolean): SessionService {
  return { isActive: vi.fn(async () => active) } as unknown as SessionService;
}

function makeUsers(row: Partial<UserRow> | null): UsersService {
  return {
    getById: vi.fn(async () => row),
    effectiveStatus: (r: Partial<UserRow>) =>
      r?.status === 'blocked' &&
      r?.bannedUntil !== null &&
      r?.bannedUntil !== undefined &&
      r.bannedUntil.getTime() > Date.now()
        ? 'blocked'
        : r?.status === 'blocked'
          ? 'active'
          : (r?.status ?? 'active'),
  } as unknown as UsersService;
}

function makeUserRow(status: string, bannedUntil: Date | null = null): Partial<UserRow> {
  return { id: UID, status, bannedUntil } as Partial<UserRow>;
}

describe('B5.5 RealtimeAuthService.authenticate', () => {
  it('returns null when no token is presented', async () => {
    const svc = new RealtimeAuthService(
      makeTokens(async () => {
        throw new Error('must not be called');
      }),
      makeSessions(true),
      makeUsers(makeUserRow('active')),
    );
    await expect(svc.authenticate(undefined)).resolves.toBeNull();
    await expect(svc.authenticate('')).resolves.toBeNull();
  });

  it('returns null when the access token is invalid or expired', async () => {
    const svc = new RealtimeAuthService(
      makeTokens(async () => null),
      makeSessions(true),
      makeUsers(makeUserRow('active')),
    );
    await expect(svc.authenticate('garbage')).resolves.toBeNull();
  });

  it('returns null when the session is revoked (liveness check fails)', async () => {
    const verify = vi.fn(async () => ({ sub: UID, sid: 's1', role: 'user', jti: 'j' }));
    const sessions = makeSessions(false);
    const svc = new RealtimeAuthService(
      makeTokens(verify),
      sessions,
      makeUsers(makeUserRow('active')),
    );
    await expect(svc.authenticate('tok')).resolves.toBeNull();
    expect(sessions.isActive).toHaveBeenCalledWith('s1');
  });

  it('returns null when the user is banned (effective status blocked)', async () => {
    const svc = new RealtimeAuthService(
      makeTokens(async () => ({ sub: UID, sid: 's1', role: 'user', jti: 'j' })),
      makeSessions(true),
      makeUsers(makeUserRow('blocked', new Date(Date.now() + 3_600_000))),
    );
    await expect(svc.authenticate('tok')).resolves.toBeNull();
  });

  it('returns null when the user row no longer exists', async () => {
    const svc = new RealtimeAuthService(
      makeTokens(async () => ({ sub: UID, sid: 's1', role: 'user', jti: 'j' })),
      makeSessions(true),
      makeUsers(null),
    );
    await expect(svc.authenticate('tok')).resolves.toBeNull();
  });

  it('returns the identity (same shape as request.user) when every check passes', async () => {
    const svc = new RealtimeAuthService(
      makeTokens(async () => ({ sub: UID, sid: 's1', role: 'owner', jti: 'j' })),
      makeSessions(true),
      makeUsers(makeUserRow('active')),
    );
    await expect(svc.authenticate('tok')).resolves.toEqual({
      id: UID,
      role: 'owner',
      status: 'active',
      sessionId: 's1',
    });
  });
});

describe('B5.5 contracts room grammar (parseRealtimeRoom)', () => {
  it('accepts user, business and conversation rooms with strict lowercase uuids', () => {
    expect(parseRealtimeRoom(realtimeUserRoom(UID))).toEqual({ kind: 'user', id: UID });
    const BID = '22222222-2222-4222-8222-222222222222';
    expect(parseRealtimeRoom(realtimeBusinessRoom(BID))).toEqual({ kind: 'business', id: BID });
    // B5.6: conversation rooms are grammar-valid; MEMBERSHIP is the gateway's
    // job (isParticipant), not the parser's.
    expect(parseRealtimeRoom(realtimeConversationRoom(BID))).toEqual({
      kind: 'conversation',
      id: BID,
    });
  });

  it('rejects every non-conforming string (never joins a client-invented room)', () => {
    const BAD = [
      '',
      'user',
      'user:',
      'user:ABCDEFAB-CDEF-4ABC-8ABC-ABCDEFABCDEF', // uppercase hex — invalid
      'user:11111111-1111-4111-8111-11111111111g', // 'g' is not hex
      'conversation:11111111-1111-4111-8111-11111111111g', // conversation kind, bad hex
      'conversation:not-a-uuid', // conversation kind, not a uuid
      'group:11111111-1111-4111-8111-111111111111', // unknown kind (B5.6 has no group DMs)
      'socket:1',
      'global',
      `user:${UID} extra`,
      '*',
    ];
    for (const room of BAD) expect(parseRealtimeRoom(room)).toBeNull();
  });

  it('rejects non-string payloads defensively', () => {
    // The gateway pre-narrows to string; parse still never explodes.
    expect(parseRealtimeRoom(String(undefined))).toBeNull();
  });
});
