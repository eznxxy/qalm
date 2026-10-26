import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { ProjectSuitesController, SuitesController } from './suites.controller';
import { SuitesService } from './suites.service';
import { SuitesStore } from './suites.store';

/**
 * Suites feature module, docs/api-suites.md. AuthModule supplies the shared
 * AuthGuard/@Roles wiring; DbModule the pg pool.
 */
@Module({
  imports: [AuthModule, DbModule],
  controllers: [ProjectSuitesController, SuitesController],
  providers: [SuitesService, SuitesStore],
})
export class SuitesModule {}
