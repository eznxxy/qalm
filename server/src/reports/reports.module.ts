import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { ProjectReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportsStore } from './reports.store';

/**
 * Reports feature module, docs/api-project-overview.md. This slice ships one
 * read-only endpoint — the project overview's 14-day results trend — over the
 * runs/results schema (migration 20261028000001 adds its `created_at` index).
 * AuthModule supplies the shared AuthGuard wiring; DbModule the pg pool.
 */
@Module({
  imports: [AuthModule, DbModule],
  controllers: [ProjectReportsController],
  providers: [ReportsService, ReportsStore],
})
export class ReportsModule {}