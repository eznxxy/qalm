import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { UsersStore } from './users.store';

/**
 * Admin user-management feature module, docs/api-auth.md § Endpoints — user
 * management. Imports AuthModule so AdminUsersController can use the shared
 * AuthGuard + @Roles (the auth card's helpers.ts reuse surface; PasswordService
 * and RefreshTokenStore resolve from AuthModule's exports too). DbModule
 * provides the pg pool to UsersStore.
 */
@Module({
  imports: [AuthModule, DbModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService, UsersStore],
})
export class AdminUsersModule {}
