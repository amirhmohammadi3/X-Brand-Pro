import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { UsersService } from '../src/modules/users/users.service.js';
import type { UsersRepositoryLike } from '../src/modules/users/users.repository.js';
import type { SessionsRepositoryLike } from '../src/modules/auth/session.repository.js';
import type { UserRow } from '../src/db/schema/users.js';
import type { SessionRow } from '../src/db/schema/sessions.js';
import type { UserRole } from '@app/contracts';

/**
 * Auth test utilities (B1.3): in-memory fakes for the two repositories the
 * auth flows touch, a createUser factory that hashes like production, and a
 * loginAs helper returning cookies + bearer token for supertest flows.
 */

export function makeMemoryUserRepo(
  initial: UserRow[] = [],
): UsersRepositoryLike & { rows: Map<string, UserRow> } {
  const rows = new Map<string, UserRow>(initial.map((r) => [r.id, r]));
  return {
    rows,
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findByUsername(username) {
      return [...rows.values()].find((r) => r.username === username) ?? null;
    },
    async findByEmail(email) {
      return [...rows.values()].find((r) => r.email === email) ?? null;
    },
    async findByPhone(phone) {
      return [...rows.values()].find((r) => r.phone === phone) ?? null;
    },
    async findByIdentifier(identifier) {
      return (
        [...rows.values()].find(
          (r) => r.username === identifier || r.email === identifier || r.phone === identifier,
        ) ?? null
      );
    },
    async create(params) {
      const created: UserRow = {
        id: randomUUID(),
        username: params.username,
        email: params.email ?? null,
        phone: params.phone ?? null,
        passwordHash: params.passwordHash ?? null,
        role: params.role ?? 'user',
        status: 'active',
        displayName: params.displayName ?? null,
        locale: params.locale ?? null,
        emailVerifiedAt: params.emailVerified ? new Date() : null,
        phoneVerifiedAt: params.phoneVerified ? new Date() : null,
        bannedUntil: null,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSeenAt: null,
      };
      rows.set(created.id, created);
      return created;
    },
    async updateRole(id, role) {
      const r = rows.get(id);
      if (!r) return null;
      const updated = { ...r, role, updatedAt: new Date() };
      rows.set(id, updated);
      return updated;
    },
    async updateStatus(id, status) {
      const r = rows.get(id);
      if (!r) return null;
      const updated = { ...r, status, updatedAt: new Date() };
      rows.set(id, updated);
      return updated;
    },
    async countByRole(role, status) {
      return [...rows.values()].filter(
        (r) => r.role === role && (status ? r.status === status : true),
      ).length;
    },
    async touchLastSeen(id) {
      const r = rows.get(id);
      if (r) rows.set(id, { ...r, lastSeenAt: new Date() });
    },
    async setPasswordHash(id, passwordHash) {
      const r = rows.get(id);
      if (r) rows.set(id, { ...r, passwordHash, updatedAt: new Date() });
    },
    async recordLogin(id) {
      const r = rows.get(id);
      if (r)
        rows.set(id, {
          ...r,
          lastLoginAt: new Date(),
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        });
    },
    async attachIdentifier(params) {
      for (const [id, r] of rows) {
        if (id === params.userId) continue;
        const holderValue = params.channel === 'email' ? r.email : r.phone;
        if (holderValue !== params.target) continue;
        const verified =
          params.channel === 'email' ? r.emailVerifiedAt !== null : r.phoneVerifiedAt !== null;
        if (verified) return 'conflict' as const;
        // Unverified holder loses the identifier (OTP-proven ownership).
        rows.set(id, {
          ...r,
          ...(params.channel === 'email' ? { email: null } : { phone: null }),
          updatedAt: new Date(),
        });
      }
      const me = rows.get(params.userId);
      if (me) {
        rows.set(params.userId, {
          ...me,
          ...(params.channel === 'email'
            ? { email: params.target, emailVerifiedAt: new Date() }
            : { phone: params.target, phoneVerifiedAt: new Date() }),
          updatedAt: new Date(),
        });
      }
      return 'attached' as const;
    },
  };
}

export function makeMemorySessionRepo(): SessionsRepositoryLike & {
  rows: Map<string, SessionRow>;
} {
  const rows = new Map<string, SessionRow>();
  return {
    rows,
    async insert(row) {
      const created: SessionRow = {
        id: randomUUID(),
        userId: row.userId,
        familyId: row.familyId,
        refreshHash: row.refreshHash,
        userAgent: row.userAgent,
        ip: row.ip,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        expiresAt: row.expiresAt,
        revokedAt: null,
        revokedReason: null,
        replacedBy: null,
      };
      rows.set(created.id, created);
      return created;
    },
    async findByRefreshHash(hash) {
      return [...rows.values()].find((r) => r.refreshHash === hash) ?? null;
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async markReplaced(id, replacedBy) {
      const r = rows.get(id);
      if (r) rows.set(id, { ...r, replacedBy });
    },
    async revoke(id, reason) {
      const r = rows.get(id);
      if (r && r.revokedAt === null)
        rows.set(id, { ...r, revokedAt: new Date(), revokedReason: reason });
    },
    async revokeFamily(familyId, reason, exceptId) {
      let count = 0;
      for (const [id, r] of rows) {
        if (r.familyId !== familyId || r.revokedAt !== null) continue;
        if (exceptId && id === exceptId) continue;
        rows.set(id, { ...r, revokedAt: new Date(), revokedReason: reason });
        count += 1;
      }
      return count;
    },
    async listActiveForUser(userId) {
      return [...rows.values()].filter((r) => r.userId === userId && r.revokedAt === null);
    },
    async touchUsed(id, when) {
      const r = rows.get(id);
      if (r) rows.set(id, { ...r, lastUsedAt: when });
    },
  };
}

/** Factory: creates a user with an argon2-hashed password (like prod). */
export async function createUser(
  app: INestApplication,
  params: {
    username: string;
    password: string;
    email?: string;
    phone?: string;
    role?: UserRole;
    status?: 'active' | 'blocked';
  },
): Promise<UserRow> {
  const users = app.get(UsersService);
  const passwords = app.get(PasswordService);
  const passwordHash = await passwords.hash(params.password);
  return users.create({
    username: params.username,
    email: params.email ?? null,
    phone: params.phone ?? null,
    passwordHash,
    role: params.role ?? 'user',
  });
}

export interface LoginSession {
  cookies: string[];
  bearer: string;
  body: Record<string, unknown>;
}

/** Login through the real HTTP endpoint; returns cookies + bearer token. */
export async function loginAs(
  app: INestApplication,
  identifier: string,
  password: string,
): Promise<LoginSession> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ identifier, password });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`loginAs failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return {
    cookies: extractCookies(res),
    bearer: bearerFromCookies(extractCookies(res)),
    body: res.body as Record<string, unknown>,
  };
}

/** supertest set-cookie headers → `name=value` strings for a Cookie header. */
export function extractCookies(res: request.Response): string[] {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c) => c.split(';')[0]);
}

export function bearerFromCookies(cookies: string[]): string {
  const at = cookies.find((c) => c.startsWith('at='));
  if (!at) throw new Error('no `at` cookie in response');
  return `Bearer ${decodeURIComponent(at.slice('at='.length))}`;
}

/** Find a cookie value by name from an extractCookies() result. */
export function cookieValue(cookies: string[], name: string): string {
  const found = cookies.find((c) => c.startsWith(`${name}=`));
  if (!found) throw new Error(`no \`${name}\` cookie in response`);
  return decodeURIComponent(found.slice(name.length + 1));
}
