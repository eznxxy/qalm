import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';

/**
 * Root module. Feature modules plug in here; the scaffold's health endpoint
 * stays a documented public exception to auth (api-conventions.md).
 */
@Module({
  imports: [ConfigModule.register(), DbModule, AuthModule],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
