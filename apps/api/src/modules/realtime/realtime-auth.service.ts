import { Inject, Injectable } from '@nestjs/common';
import type { UserRole } from '@app/contracts';
import { SessionService } from '../auth/session.service.js';
import { TokenService } from '../auth/token.service.js';
import { UsersService } from '../users/users.service.js';

/**
 * Identity attached to every authenticated realtime socket — deliberately
 * the SAME shape the HTTP guards put on `request.user`, so later prompts
 * (B5.6 rooms, B5.7 event routing) can apply one mental model everywhere.
 */
export interface RealtimeUser {
  id: string;
  role: UserRole;
  status: string;
  sessionId: string;
}

/**
 * Handshake authentication (B5.5) — the WebSocket twin of JwtAuthGuard, in
 * one place so the gateway middleware stays thin. The chain is EXACTLY the
 * HTTP guard's chain (B1.3), deliberately reusing the same services:
 *  1. verify the access token (HS256, short-lived) → claims {sub, sid, role}
 *  2. session liveness (SessionService.isActive — Redis 60s cache, DB truth;
 *     a revoked session stops new handshakes immediately)
 *  3. user status via UsersService (effective status — expired bans count
 *     as active, mirroring the guard's cached-effective-status rule)
 * Any failure returns null → the handshake is rejected. No separate "ws
 * token" exists: revoking a session revokes its sockets too.
 */
@Injectable()
export class RealtimeAuthService {
  constructor(
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  async authenticate(accessToken: string | undefined): Promise<RealtimeUser | null> {
    if (!accessToken) return null;

    const claims = await this.tokens.verifyAccess(accessToken);
    if (!claims) return null;

    const active = await this.sessions.isActive(claims.sid);
    if (!active) return null;

    // getById throws NotFound for a deleted user — for handshakes that is
    // just "unauthenticated", never a 500-shaped exception.
    let row: Awaited<ReturnType<UsersService['getById']>>;
    try {
      row = await this.users.getById(claims.sub);
    } catch {
      return null;
    }
    if (!row || this.users.effectiveStatus(row) !== 'active') return null;

    return {
      id: claims.sub,
      role: claims.role as UserRole,
      status: 'active',
      sessionId: claims.sid,
    };
  }
}
