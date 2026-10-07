import { Module } from '@nestjs/common';
import { AdminUsersModule } from './users-admin/admin-users.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { ProjectsModule } from './projects/projects.module';

/**
 * Root module. Feature modules plug in here; the scaffold's health endpoint
 * stays a documented public exception to auth (api-conventions.md).
 */
@Module({
  imports: [
    ConfigModule.register(),
    DbModule,
    AuthModule,
    ProjectsModule,
    AdminUsersModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
