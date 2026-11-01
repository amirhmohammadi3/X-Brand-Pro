import { currentUserSchema, type CurrentUser } from '@app/contracts';
import type { UserRow } from '../../db/schema/users.js';

/**
 * Shared CurrentUser builder (B1.10). Auth flows (register/login/refresh/OTP)
 * pass no avatarUrl — a fresh or unchanged profile renders its avatar lazily;
 * GET /users/me resolves the avatar URL from the media row before calling.
 */
export function toCurrentUser(row: UserRow, avatarUrl: string | null = null): CurrentUser {
  return currentUserSchema.parse({
    id: row.id,
    username: row.username,
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: row.status,
    displayName: row.displayName,
    bio: row.bio,
    locale: row.locale,
    avatarUrl,
    hasPassword: row.passwordHash !== null,
    emailVerified: row.emailVerifiedAt !== null,
    phoneVerified: row.phoneVerifiedAt !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
