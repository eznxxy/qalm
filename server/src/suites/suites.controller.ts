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
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, AuthUser, CurrentUser, Roles } from '../auth/current-user';
import { CreateSuiteDto, ReorderSuitesDto, UpdateSuiteDto } from './dto';
import { SuitesService } from './suites.service';

/**
 * Suites of one project, docs/api-suites.md § Endpoints + § Role matrix:
 *   GET   /projects/:projectId/suites        any authenticated role
 *   POST  /projects/:projectId/suites        admin, lead
 *   PATCH /projects/:projectId/suites/order  admin, lead (atomic drag reorder)
 */
@UseGuards(AuthGuard)
@Controller('projects/:projectId/suites')
export class ProjectSuitesController {
  constructor(private readonly suites: SuitesService) {}

  @Get()
  async tree(
    @CurrentUser() caller: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return { data: await this.suites.tree(caller, projectId) };
  }

  @Roles('admin', 'lead')
  @Post()
  async create(
    @CurrentUser() caller: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateSuiteDto,
  ) {
    return { data: await this.suites.create(caller, projectId, dto) };
  }

  @Roles('admin', 'lead')
  @HttpCode(HttpStatus.OK)
  @Patch('order')
  async reorder(
    @CurrentUser() caller: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: ReorderSuitesDto,
  ) {
    return { data: await this.suites.reorder(caller, projectId, dto) };
  }
}

/**
 * Single-suite routes:
 *   GET    /suites/:id  any authenticated role (with the breadcrumb path)
 *   PATCH  /suites/:id  admin, lead
 *   DELETE /suites/:id  admin, lead (204 only when the suite is empty)
 */
@UseGuards(AuthGuard)
@Controller('suites')
export class SuitesController {
  constructor(private readonly suites: SuitesService) {}

  @Get(':id')
  async detail(@CurrentUser() caller: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.suites.detail(caller, id) };
  }

  @Roles('admin', 'lead')
  @Patch(':id')
  async update(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSuiteDto,
  ) {
    return { data: await this.suites.update(caller, id, dto) };
  }

  @Roles('admin', 'lead')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async remove(@CurrentUser() caller: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.suites.remove(caller, id);
  }
}
