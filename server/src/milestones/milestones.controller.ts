import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, AuthUser, CurrentUser, Roles } from '../auth/current-user';
import {
  AttachMilestoneRunsDto,
  CreateMilestoneDto,
  ListMilestonesQuery,
  UpdateMilestoneDto,
} from './dto';
import { MilestonesService } from './milestones.service';

/**
 * Milestones of one project, docs/api-milestones.md § Endpoints + § Role
 * matrix:
 *   GET  /projects/:projectId/milestones  any authenticated role
 *   POST /projects/:projectId/milestones  admin, lead
 */
@UseGuards(AuthGuard)
@Controller('projects/:projectId/milestones')
export class ProjectMilestonesController {
  constructor(private readonly milestones: MilestonesService) {}

  @Get()
  async list(
    @CurrentUser() caller: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListMilestonesQuery,
  ) {
    return this.milestones.list(caller, projectId, query);
  }

  @Roles('admin', 'lead')
  @Post()
  async create(
    @CurrentUser() caller: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateMilestoneDto,
  ) {
    return { data: await this.milestones.create(caller, projectId, dto) };
  }
}

/**
 * Single-milestone routes, docs/api-milestones.md § Role matrix:
 *   GET    /milestones/:id                any authenticated role
 *   PATCH  /milestones/:id                admin, lead
 *   DELETE /milestones/:id                admin, lead (204; runs detached)
 *   POST   /milestones/:id/runs           admin, lead (200 { attached })
 *   DELETE /milestones/:id/runs/:runId    admin, lead (204)
 */
@UseGuards(AuthGuard)
@Controller('milestones')
export class MilestonesController {
  constructor(private readonly milestones: MilestonesService) {}

  @Get(':id')
  async detail(@CurrentUser() caller: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.milestones.detail(caller, id) };
  }

  @Roles('admin', 'lead')
  @Patch(':id')
  async update(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMilestoneDto,
  ) {
    return { data: await this.milestones.update(caller, id, dto) };
  }

  @Roles('admin', 'lead')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async remove(@CurrentUser() caller: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.milestones.remove(caller, id);
  }

  @Roles('admin', 'lead')
  @HttpCode(HttpStatus.OK)
  @Post(':id/runs')
  async attachRuns(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AttachMilestoneRunsDto,
  ) {
    return { data: await this.milestones.attachRuns(caller, id, dto) };
  }

  @Roles('admin', 'lead')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id/runs/:runId')
  async detachRun(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    await this.milestones.detachRun(caller, id, runId);
  }
}