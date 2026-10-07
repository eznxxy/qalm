import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { RateLimitService } from './rate-limit.service';
import { RefreshTokenStore } from './refresh-token.store';
import { TokensService } from './tokens.service';

/**
 * Auth feature module. Downstream modules (user management etc.) import this
 * and reuse its exported services, guard and decorators — see auth/helpers.ts
 * for the canonical re-export surface.
 */
@Module({
  imports: [DbModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    RateLimitService,
    RefreshTokenStore,
    TokensService,
    UsersService,
  ],
  exports: [
    AuthService,
    PasswordService,
    RateLimitService,
    RefreshTokenStore,
    TokensService,
    UsersService,
  ],
})
export class AuthModule {}
