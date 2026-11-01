import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
// Value import (not type-only): Nest reads the constructor parameter type at
// runtime via emitDecoratorMetadata — type-only would break DI (B1.3).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import { normalizePersianText, type CurrentUser, type UpdateProfileBody } from '@app/contracts';
import type { MediaFileRow } from '../../db/schema/media.js';
import type { UserRow } from '../../db/schema/users.js';
import { MEDIA_SERVICE } from '../media/media.service.js';
import type { MediaService } from '../media/media.service.js';
// Value import (constructor DI needs runtime metadata — eslint --fix must not
// convert this; see auth.service.ts for the same pattern).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MediaUrlService } from '../media/media-url.service.js';
import { UsersService } from '../users/users.service.js';
import { toCurrentUser } from '../users/current-user.mapper.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DI metadata
import { LocaleValidator } from '../i18n/locale.validator.js';
import { OAUTH_ACCOUNTS_REPOSITORY } from './oauth-accounts.repository.js';
import type { OauthAccountsRepositoryLike } from './oauth-accounts.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DI metadata
import { PasswordService } from './password.service.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { SessionService } from './session.service.js';

/** Domain event: the account was soft-deleted (audit subscribes in B1.11). */
export const USER_DELETED = 'user.deleted';

/** Username changes are allowed again this many days after the previous one. */
export const USERNAME_COOLDOWN_DAYS = 30;

/** DELETE /users/me requires a login no older than this when no password is set. */
export const FRESH_LOGIN_WINDOW_MS = 10 * 60 * 1000;

function unprocessable(message: string, details?: unknown): HttpException {
  return new HttpException(
    { code: 'UNPROCESSABLE', message, details },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

/**
 * Profile flows (B1.10). Lives in the auth module because every flow touches
 * sessions, password hashes, the login throttle or linked OAuth identities —
 * all auth-domain state (UsersModule cannot import AuthModule without a DI
 * cycle). Routes are still mounted under /users/me by ProfileController.
 */
@Injectable()
export class ProfileService {
  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(MEDIA_SERVICE) private readonly media: MediaService,
    private readonly mediaUrls: MediaUrlService,
    @Inject(SessionService) private readonly sessions: SessionService,
    private readonly passwords: PasswordService,
    @Inject(LoginThrottleService) private readonly throttle: LoginThrottleService,
    @Inject(OAUTH_ACCOUNTS_REPOSITORY) private readonly oauth: OauthAccountsRepositoryLike,
    private readonly localeValidator: LocaleValidator,
    private readonly events: EventEmitter2,
  ) {}

  /** GET /users/me — the signed-in user with a resolved avatar URL. */
  async getMe(userId: string): Promise<CurrentUser> {
    const row = await this.users.getById(userId);
    return toCurrentUser(row, await this.avatarUrl(row));
  }

  /** PATCH /users/me — trims + normalizes text, validates the locale. */
  async updateProfile(userId: string, body: UpdateProfileBody): Promise<CurrentUser> {
    const fields: {
      displayName?: string | null;
      bio?: string | null;
      locale?: string | null;
    } = {};

    if (body.displayName !== undefined) {
      fields.displayName = normalizePersianText(body.displayName.trim());
    }
    if (body.bio !== undefined) {
      fields.bio = body.bio === null ? null : normalizePersianText(body.bio.trim());
    }
    if (body.locale !== undefined) {
      const normalized = await this.localeValidator.normalize(body.locale);
      if (!normalized) {
        throw unprocessable('Unsupported locale', { locale: body.locale });
      }
      fields.locale = normalized;
    }

    const updated = await this.users.updateProfile(userId, fields);
    return toCurrentUser(updated, await this.avatarUrl(updated));
  }

  /** PUT /users/me/avatar — attach an owned, avatar-kind media row. */
  async setAvatar(userId: string, mediaId: string): Promise<CurrentUser> {
    const row = await this.users.getById(userId);

    // Ownership + kind + liveness are enforced through the same rules the
    // media module uses for attachments (markAttached checks owner + exists).
    let media: MediaFileRow;
    try {
      media = await this.media.markAttached(mediaId, userId);
    } catch {
      throw new HttpException('Avatar media not found or not yours', HttpStatus.FORBIDDEN);
    }
    if (media.kind !== 'avatar') {
      throw unprocessable('Media is not an avatar', { kind: media.kind });
    }

    const previous = row.avatarMediaId;
    await this.users.setAvatarMediaId(userId, media.id);
    // The previous avatar is no longer referenced: queue its removal.
    if (previous && previous !== media.id) {
      await this.media.deleteOwned(previous, { id: userId, role: row.role }).catch(() => undefined);
    }
    const updated = await this.users.getById(userId);
    return toCurrentUser(updated, await this.avatarUrl(updated));
  }

  /** DELETE /users/me/avatar — clear the avatar and queue the file removal. */
  async clearAvatar(userId: string): Promise<CurrentUser> {
    const row = await this.users.getById(userId);
    const previous = row.avatarMediaId;
    await this.users.setAvatarMediaId(userId, null);
    if (previous) {
      await this.media.deleteOwned(previous, { id: userId, role: row.role }).catch(() => undefined);
    }
    return toCurrentUser(row, null);
  }

  /** POST /users/me/username — unique + 30-day cooldown + rate limited upstream. */
  async changeUsername(userId: string, username: string, now = new Date()): Promise<CurrentUser> {
    const row = await this.users.getById(userId);

    if (row.usernameChangedAt) {
      const retryAt = new Date(
        row.usernameChangedAt.getTime() + USERNAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
      );
      if (retryAt.getTime() > now.getTime()) {
        throw unprocessable('Username was changed recently', { retryAt: retryAt.toISOString() });
      }
    }

    const holder = await this.users.getByUsername(username);
    if (holder && holder.id !== userId) {
      throw new HttpException(
        { code: 'CONFLICT', message: 'username_taken', details: { username } },
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.users.setUsername(userId, username);
    return toCurrentUser(updated, await this.avatarUrl(updated));
  }

  /**
   * POST /users/me/password. With an existing password `currentPassword` is
   * mandatory (wrong answers count toward the login lockout); OTP/Google
   * accounts set their FIRST password without one but must own a verified
   * identifier. All OTHER sessions are revoked; the current one survives.
   */
  async changePassword(
    userId: string,
    body: { currentPassword?: string; newPassword: string },
    sessionId: string,
  ): Promise<void> {
    const row = await this.users.getById(userId);

    if (row.passwordHash) {
      if (!body.currentPassword) {
        throw unprocessable('Current password is required');
      }
      const ok = await this.passwords.verify(row.passwordHash, body.currentPassword);
      if (!ok) {
        // Count toward the login lockout for this account's username.
        await this.throttle.recordFailure(row.username);
        throw new HttpException('Wrong password', HttpStatus.UNAUTHORIZED, {
          cause: new Error('wrong password'),
        });
      }
    } else {
      const hasVerifiedIdentifier = row.emailVerifiedAt !== null || row.phoneVerifiedAt !== null;
      if (!hasVerifiedIdentifier) {
        throw unprocessable('A verified email or phone is required to set a password');
      }
    }

    const hash = await this.passwords.hash(body.newPassword);
    await this.users.setPasswordHash(userId, hash);
    await this.sessions.revokeAllForUser(userId, sessionId);
  }

  /**
   * DELETE /users/me — soft delete + anonymization. Requires the password
   * when the account has one; otherwise the session must be younger than
   * FRESH_LOGIN_WINDOW_MS (a recent login proves presence). Content created
   * by the user is intentionally kept (shown as anonymous later).
   */
  async deleteAccount(
    userId: string,
    body: { password?: string; confirm: 'DELETE' },
    sessionId: string,
  ): Promise<void> {
    const row = await this.users.getById(userId);

    if (row.passwordHash) {
      if (!body.password) {
        throw unprocessable('Password is required to delete the account');
      }
      const ok = await this.passwords.verify(row.passwordHash, body.password);
      if (!ok) {
        await this.throttle.recordFailure(row.username);
        throw new HttpException('Wrong password', HttpStatus.UNAUTHORIZED, {
          cause: new Error('wrong password'),
        });
      }
    } else {
      const session = await this.sessions
        .listForUser(userId)
        .then((list) => list.find((s) => s.id === sessionId));
      const fresh =
        session !== undefined && Date.now() - session.createdAt.getTime() <= FRESH_LOGIN_WINDOW_MS;
      if (!fresh) {
        throw unprocessable('Log in again to delete an account without a password');
      }
    }

    const deleted = await this.users.anonymizeAndDelete(userId);
    await this.oauth.deleteForUser(userId);
    await this.sessions.revokeAllForUser(userId);
    if (row.avatarMediaId) {
      await this.media
        .deleteOwned(row.avatarMediaId, { id: userId, role: row.role })
        .catch(() => undefined);
    }
    this.events.emit(USER_DELETED, {
      userId,
      username: deleted.username, // anonymized name — no PII
      sessionId,
    });
  }

  /** avatarUrl from the linked media row (thumb preferred), null when unset. */
  private async avatarUrl(row: UserRow): Promise<string | null> {
    if (!row.avatarMediaId) return null;
    const media = await this.users.findAvatarMedia(row.id);
    if (!media || media.deletedAt) return null;
    return this.mediaUrls.urlForMedia(media);
  }
}
