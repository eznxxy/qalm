import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { CasesController, ProjectCasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { CasesStore } from './cases.store';

/**
 * Cases feature module, docs/api-cases.md. AuthModule supplies the shared
 * AuthGuard/@Roles wiring; DbModule the pg pool.
 */
@Module({
  imports: [AuthModule, DbModule],
  controllers: [ProjectCasesController, CasesController],
  providers: [CasesService, CasesStore],
})
export class CasesModule {}
