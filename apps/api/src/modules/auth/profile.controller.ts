import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  changePasswordBodySchema,
  changeUsernameBodySchema,
  deleteAccountBodySchema,
  setAvatarBodySchema,
  updateProfileBodySchema,
  type ChangePasswordBody,
  type ChangeUsernameBody,
  type CurrentUser,
  type DeleteAccountBody,
  type SetAvatarBody,
  type UpdateProfileBody,
} from '@app/contracts';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedHttpRequest } from './jwt-auth.guard.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DI metadata
import { ProfileService } from './profile.service.js';
import { Req } from '@nestjs/common';

/**
 * Profile endpoints (B1.10), mounted at /api/v1/users/me. All routes require
 * authentication (no @Public); the global JwtAuthGuard resolves req.user and
 * the CSRF guard already ran for cookie-authenticated state changes.
 */
@Controller('users/me')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  getMe(@Req() req: AuthenticatedHttpRequest): Promise<CurrentUser> {
    return this.profile.getMe(this.userId(req));
  }

  @Patch()
  updateProfile(
    @Req() req: AuthenticatedHttpRequest,
    @Body(new ZodValidationPipe(updateProfileBodySchema)) body: UpdateProfileBody,
  ): Promise<CurrentUser> {
    return this.profile.updateProfile(this.userId(req), body);
  }

  @Put('avatar')
  setAvatar(
    @Req() req: AuthenticatedHttpRequest,
    @Body(new ZodValidationPipe(setAvatarBodySchema)) body: SetAvatarBody,
  ): Promise<CurrentUser> {
    return this.profile.setAvatar(this.userId(req), body.mediaId);
  }

  @Delete('avatar')
  @HttpCode(HttpStatus.OK)
  clearAvatar(@Req() req: AuthenticatedHttpRequest): Promise<CurrentUser> {
    return this.profile.clearAvatar(this.userId(req));
  }

  @Post('username')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'users.change_username', limit: 5, windowSec: 24 * 60 * 60, scope: 'user' })
  changeUsername(
    @Req() req: AuthenticatedHttpRequest,
    @Body(new ZodValidationPipe(changeUsernameBodySchema)) body: ChangeUsernameBody,
  ): Promise<CurrentUser> {
    return this.profile.changeUsername(this.userId(req), body.username);
  }

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ name: 'users.change_password', limit: 5, windowSec: 15 * 60, scope: 'user' })
  async changePassword(
    @Req() req: AuthenticatedHttpRequest,
    @Body(new ZodValidationPipe(changePasswordBodySchema)) body: ChangePasswordBody,
  ): Promise<void> {
    await this.profile.changePassword(this.userId(req), body, this.sessionId(req));
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAccount(
    @Req() req: AuthenticatedHttpRequest,
    @Body(new ZodValidationPipe(deleteAccountBodySchema)) body: DeleteAccountBody,
  ): Promise<void> {
    await this.profile.deleteAccount(this.userId(req), body, this.sessionId(req));
  }

  private userId(req: AuthenticatedHttpRequest): string {
    return req.user?.id ?? '';
  }

  private sessionId(req: AuthenticatedHttpRequest): string {
    return req.user?.sessionId ?? '';
  }
}
