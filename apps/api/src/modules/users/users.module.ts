import { Module } from '@nestjs/common';
import { UsersRepository } from './users.repository.js';
import { UsersService, USERS_REPOSITORY } from './users.service.js';

/**
 * Users module (B1.2) — user model + RBAC domain. Endpoints arrive in B1.14
 * (admin management) and auth flows in B1.3/B1.7/B1.8; this module provides
 * the service those prompts build on.
 *
 * B1.12: the LocaleValidator moved to the (global) I18nModule — it validates
 * against the languages table now instead of a static allow-list.
 */
@Module({
  providers: [{ provide: USERS_REPOSITORY, useClass: UsersRepository }, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
