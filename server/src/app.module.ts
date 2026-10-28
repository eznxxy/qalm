import { Module } from '@nestjs/common';
import { AdminUsersModule } from './users-admin/admin-users.module';
import { AuthModule } from './auth/auth.module';
import { CasesModule } from './cases/cases.module';
import { ConfigModule } from './config.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { MilestonesModule } from './milestones/milestones.module';
import { PlansModule } from './plans/plans.module';
import { ProjectsModule } from './projects/projects.module';
import { ReportsModule } from './reports/reports.module';
import { RunsModule } from './runs/runs.module';
import { SuitesModule } from './suites/suites.module';

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
    SuitesModule,
    CasesModule,
    RunsModule,
    PlansModule,
    MilestonesModule,
    ReportsModule,
    AdminUsersModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
