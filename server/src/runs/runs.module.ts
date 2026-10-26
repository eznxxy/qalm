import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { ProjectRunsController, RunsController } from './runs.controller';
import { RunsService } from './runs.service';
import { RunsStore } from './runs.store';

/**
 * Runs & run-items feature module, docs/api-runs.md. Results, attachments and
 * the case's Linked-runs feed arrive in the next backend cards (2.2 / 2.3) on
 * the same schema and store. AuthModule supplies the shared AuthGuard/@Roles
 * wiring; DbModule the pg pool.
 */
@Module({
  imports: [AuthModule, DbModule],
  controllers: [ProjectRunsController, RunsController],
  providers: [RunsService, RunsStore],
})
export class RunsModule {}