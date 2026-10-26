import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { ProjectRunsController, RunsController } from './runs.controller';
import {
  AttachmentsController,
  ResultsController,
  RunItemResultsController,
} from './results.controller';
import { AttachmentStorage } from './attachments.storage';
import { ResultsService } from './results.service';
import { RunsService } from './runs.service';
import { RunsStore } from './runs.store';

/**
 * Runs, run-items, results and attachments feature module, docs/api-runs.md.
 * Plans, rollups and the case's Linked-runs feed arrive in the next backend
 * card (2.3) on the same schema and store. AuthModule supplies the shared
 * AuthGuard/@Roles wiring; DbModule the pg pool; ConfigModule is global and
 * provides STORAGE_DIR to AttachmentStorage.
 */
@Module({
  imports: [AuthModule, DbModule],
  controllers: [
    ProjectRunsController,
    RunsController,
    RunItemResultsController,
    ResultsController,
    AttachmentsController,
  ],
  providers: [RunsService, ResultsService, RunsStore, AttachmentStorage],
})
export class RunsModule {}