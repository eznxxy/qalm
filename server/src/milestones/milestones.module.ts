import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { RunsModule } from '../runs/runs.module';
import { MilestonesController, ProjectMilestonesController } from './milestones.controller';
import { MilestonesService } from './milestones.service';
import { MilestonesStore } from './milestones.store';

/**
 * Milestones feature module, docs/api-milestones.md. A milestone is a
 * project-scoped checkpoint over runs: its `counts`/`run_count`/`status` are
 * computed on read from the shared runs schema (migration 20261027000003) by
 * reusing RunsStore's latest-result join, and attach/detach writes the run link
 * through RunsStore. AuthModule supplies the shared AuthGuard/@Roles wiring;
 * DbModule the pg pool.
 */
@Module({
  imports: [AuthModule, DbModule, RunsModule],
  controllers: [ProjectMilestonesController, MilestonesController],
  providers: [MilestonesService, MilestonesStore],
})
export class MilestonesModule {}