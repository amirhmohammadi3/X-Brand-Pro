import { Controller, Get, Param, Query } from '@nestjs/common';
import { pageQuerySchema, type PageQuery } from '@app/contracts';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PublicProfileService } from './public-profile.service.js';

/**
 * Public user-profile endpoints (B4.10) — mounted on the reviews module
 * because the profile's trust block IS a reviews-domain aggregate (the same
 * B4.7 precedent that put GET /users/me/reputation here). Route order is
 * guaranteed by AppModule import order: AuthModule's ProfileController
 * ('users/me') registers BEFORE this controller, so GET /users/me still
 * resolves the caller's own profile and never lands in `:username`.
 */
@Controller()
export class UsersPublicController {
  constructor(private readonly profiles: PublicProfileService) {}

  /** Public profile: identity + trust signals + join date (privacy-minimal). */
  @Public()
  @Get('users/:username')
  @RateLimit({ name: 'users.profile.read', limit: 60, windowSec: 60 })
  async getProfile(@Param('username') username: string) {
    return this.profiles.getProfile(username);
  }

  /** The user's APPROVED reviews, newest first (pending/rejected stay private). */
  @Public()
  @Get('users/:username/reviews')
  @RateLimit({ name: 'reviews.read', limit: 60, windowSec: 60 })
  async listReviews(
    @Param('username') username: string,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
  ) {
    return this.profiles.listReviews(username, query);
  }
}
