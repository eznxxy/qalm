import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectsStore } from './projects.store';

/**
 * Projects feature module, docs/api-projects.md. Imports AuthModule so
 * ProjectsController can use the shared AuthGuard (Reflector + TokensService
 * resolve from AuthModule's exports) — the auth card's helpers.ts reuse
 * surface. DbModule provides the pg pool to ProjectsStore.
 */
@Module({
  imports: [AuthModule, DbModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsStore],
})
export class ProjectsModule {}
