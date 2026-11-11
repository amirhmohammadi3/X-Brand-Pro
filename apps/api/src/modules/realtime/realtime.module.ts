import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BusinessModule } from '../business/businesses.module.js';
import { UsersModule } from '../users/users.module.js';
import { RealtimeAuthService } from './realtime-auth.service.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeService } from './realtime.service.js';

/**
 * Realtime module (B5.5): the Socket.IO gateway + its auth chain + the
 * emit surface other modules push through. Imports Auth/Users/Business
 * ONLY for their exported services/repositories (no cycles — none of them
 * imports this module; B5.7's event subscribers will inject
 * RealtimeService from their own modules instead).
 */
@Module({
  imports: [AuthModule, UsersModule, BusinessModule],
  providers: [RealtimeService, RealtimeAuthService, RealtimeGateway],
  exports: [RealtimeService],
})
export class RealtimeModule {}
