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
  AddRunItemsDto,
  AssignRunItemsDto,
  CreateRunDto,
  ListRunItemsQuery,
  ListRunsQuery,
  UpdateRunDto,
  UpdateRunItemDto,
} from './dto';
import { RunsService } from './runs.service';

/**
 * Runs of one project, docs/api-runs.md § Endpoints + § Role matrix:
 *   GET  /projects/:projectId/runs  any authenticated role
 *   POST /projects/:projectId/runs  admin, lead
 */
@UseGuards(AuthGuard)
@Controller('projects/:projectId/runs')
export class ProjectRunsController {
  constructor(private readonly runs: RunsService) {}

  @Get()
  async list(
    @CurrentUser() caller: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListRunsQuery,
  ) {
    return this.runs.list(caller, projectId, query);
  }

  @Roles('admin', 'lead')
  @Post()
  async create(
    @CurrentUser() caller: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateRunDto,
  ) {
    return { data: await this.runs.create(caller, projectId, dto) };
  }
}

/**
 * Single-run routes:
 *   GET    /runs/:id                          any authenticated role
 *   PATCH  /runs/:id                          admin, lead
 *   DELETE /runs/:id                          admin, lead (204)
 *   POST   /runs/:id/close · /reopen          admin, lead (200)
 *   GET    /runs/:id/items · /items/:itemId   any authenticated role
 *   POST   /runs/:id/items                    admin, lead (200)
 *   PATCH  /runs/:id/items/:itemId            admin, lead
 *   POST   /runs/:id/assign                   admin, lead (200)
 *   DELETE /runs/:id/items/:itemId            admin, lead (204)
 */
@UseGuards(AuthGuard)
@Controller('runs')
export class RunsController {
  constructor(private readonly runs: RunsService) {}

  @Get(':id/items')
  async listItems(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListRunItemsQuery,
  ) {
    return this.runs.listItems(caller, id, query);
  }

  @Get(':id/items/:itemId')
  async itemDetail(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return { data: await this.runs.itemDetail(caller, id, itemId) };
  }

  @Roles('admin', 'lead')
  @HttpCode(HttpStatus.OK)
  @Post(':id/items')
  async addItems(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddRunItemsDto,
  ) {
    return { data: await this.runs.addItems(caller, id, dto) };
  }

  @Roles('admin', 'lead')
  @Patch(':id/items/:itemId')
  async updateItem(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateRunItemDto,
  ) {
    return { data: await this.runs.updateItem(caller, id, itemId, dto) };
  }

  @Roles('admin', 'lead')
  @HttpCode(HttpStatus.OK)
  @Post(':id/assign')
  async assign(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignRunItemsDto,
  ) {
    return { data: await this.runs.assign(caller, id, dto) };
  }

  @Roles('admin', 'lead')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id/items/:itemId')
  async removeItem(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    await this.runs.removeItem(caller, id, itemId);
  }

  @Roles('admin', 'lead')
  @HttpCode(HttpStatus.OK)
  @Post(':id/close')
  async close(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.runs.close(caller, id) };
  }

  @Roles('admin', 'lead')
  @HttpCode(HttpStatus.OK)
  @Post(':id/reopen')
  async reopen(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.runs.reopen(caller, id) };
  }

  @Get(':id')
  async detail(@CurrentUser() caller: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.runs.detail(caller, id) };
  }

  @Roles('admin', 'lead')
  @Patch(':id')
  async update(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRunDto,
  ) {
    return { data: await this.runs.update(caller, id, dto) };
  }

  @Roles('admin', 'lead')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async remove(@CurrentUser() caller: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.runs.remove(caller, id);
  }
}