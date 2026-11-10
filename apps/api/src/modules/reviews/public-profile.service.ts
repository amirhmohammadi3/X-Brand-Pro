import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { PageQuery, PublicProfile, PublicProfileReviewsResult } from '@app/contracts';
import { reputationLevelFor } from '@app/contracts';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { UsersService } from '../users/users.service.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MediaUrlService } from '../media/media-url.service.js';
import { REVIEWS_REPOSITORY, type ReviewsRepositoryLike } from './reviews.repository.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ReviewsService } from './reviews.service.js';

function notFoundException(what: string, id: string): HttpException {
  return new HttpException(
    {
      code: 'NOT_FOUND' as const,
      messageKey: 'errors.not_found',
      message: `${what} ${id} not found`,
      details: { entity: what.toLowerCase(), id },
    },
    HttpStatus.NOT_FOUND,
  );
}

/**
 * The PUBLIC user profile (B4.10) — the F4.8 page's data source. Composition
 * only, one module boundary respected: identity comes from the users module's
 * exported `UsersService` (`getByUsername` + `findAvatarMedia`), the trust
 * signals from the reviews repository's live `reputationStats` (the same
 * three indexed scans as GET /users/me/reputation — never the possibly stale
 * denormalised score) and the reviews list from `ReviewsService`'s
 * approved-only slice.
 *
 * Privacy rules: a missing username 404s; a `blocked`/`deleted` user 404s
 * TOO (existence is never leaked — the same 404-never-leak rule as
 * businesses); no email/phone/reputation-points ever leave the server (the
 * public page shows the LEVEL, the raw score stays self-only on
 * GET /users/me/reputation).
 */
@Injectable()
export class PublicProfileService {
  constructor(
    private readonly users: UsersService,
    @Inject(REVIEWS_REPOSITORY) private readonly repo: ReviewsRepositoryLike,
    private readonly reviews: ReviewsService,
    private readonly mediaUrls: MediaUrlService,
  ) {}

  /** Resolve the visible profile or 404 (unknown AND blocked/deleted alike). */
  private async resolveActiveUser(username: string) {
    const user = await this.users.getByUsername(username);
    if (!user || user.status !== 'active') {
      throw notFoundException('User', username);
    }
    return user;
  }

  async getProfile(username: string): Promise<PublicProfile> {
    const user = await this.resolveActiveUser(username);
    const [stats, avatarMedia] = await Promise.all([
      this.repo.reputationStats(user.id),
      this.users.findAvatarMedia(user.id),
    ]);
    return {
      username: user.username,
      displayName: user.displayName,
      avatarUrl: avatarMedia ? this.mediaUrls.urlForMedia(avatarMedia) : null,
      level: reputationLevelFor(user.reputationPoints),
      stats,
      joinedAt: user.createdAt.toISOString(),
    };
  }

  async listReviews(username: string, query: PageQuery): Promise<PublicProfileReviewsResult> {
    const user = await this.resolveActiveUser(username);
    return this.reviews.listApprovedByUser(user.id, query);
  }
}
