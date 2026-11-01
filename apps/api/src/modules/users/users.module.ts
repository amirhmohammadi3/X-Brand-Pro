import { Module } from '@nestjs/common';
import { UsersRepository } from './users.repository.js';
import { UsersService, USERS_REPOSITORY } from './users.service.js';
import { UsersJobsInit } from './users.jobs.js';

/**
 * Users module (B1.2) — user model + RBAC domain. The admin ENDPOINTS live
 * in the auth module (UsersAdminController) because they revoke sessions
 * synchronously and UsersModule cannot import AuthModule without a DI
 * cycle — same reason ProfileService lives there (B1.10).
 *
 * B1.12: the LocaleValidator moved to the (global) I18nModule — it validates
 * against the languages table now instead of a static allow-list.
 * B1.14: registers the users:expire-bans repeatable on the maintenance queue.
 */
@Module({
  providers: [
    { provide: USERS_REPOSITORY, useClass: UsersRepository },
    UsersService,
    UsersJobsInit,
  ],
  exports: [UsersService],
})
export class UsersModule {}
