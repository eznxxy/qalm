import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { CaseRunsController, ProjectRunsController, RunsController } from './runs.controller';
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
 * Runs, run-items, results, attachments and the case's Linked-runs feed feature
 * module, docs/api-runs.md. Plans and their rollups live in PlansModule on the
 * same schema and store. AuthModule supplies the shared AuthGuard/@Roles wiring;
 * DbModule the pg pool; ConfigModule is global and provides STORAGE_DIR to
 * AttachmentStorage.
 */
@Module({
  imports: [AuthModule, DbModule],
  controllers: [
    ProjectRunsController,
    RunsController,
    CaseRunsController,
    RunItemResultsController,
    ResultsController,
    AttachmentsController,
  ],
  providers: [RunsService, ResultsService, RunsStore, AttachmentStorage],
})
export class RunsModule {}