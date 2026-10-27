import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { RunsModule } from '../runs/runs.module';
import { ProjectPlansController, PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { PlansStore } from './plans.store';

/**
 * Plans feature module, docs/api-plans.md. A plan is a thin container over
 * runs; its `counts`/`run_count` are computed on read from the shared runs
 * schema (migration 20261026000001) by reusing RunsStore's latest-result join,
 * and a create inserts the plan's first runs through RunsStore. AuthModule
 * supplies the shared AuthGuard/@Roles wiring; DbModule the pg pool.
 */
@Module({
  imports: [AuthModule, DbModule, RunsModule],
  controllers: [ProjectPlansController, PlansController],
  providers: [PlansService, PlansStore],
})
export class PlansModule {}