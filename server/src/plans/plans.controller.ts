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
import { CreatePlanDto, ListPlansQuery, UpdatePlanDto } from './dto';
import { PlansService } from './plans.service';

/**
 * Plans of one project, docs/api-plans.md § Endpoints + § Role matrix:
 *   GET  /projects/:projectId/plans  any authenticated role
 *   POST /projects/:projectId/plans  admin, lead
 */
@UseGuards(AuthGuard)
@Controller('projects/:projectId/plans')
export class ProjectPlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  async list(
    @CurrentUser() caller: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListPlansQuery,
  ) {
    return this.plans.list(caller, projectId, query);
  }

  @Roles('admin', 'lead')
  @Post()
  async create(
    @CurrentUser() caller: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreatePlanDto,
  ) {
    return { data: await this.plans.create(caller, projectId, dto) };
  }
}

/**
 * Single-plan routes, docs/api-plans.md § Role matrix:
 *   GET    /plans/:id  any authenticated role
 *   PATCH  /plans/:id  admin, lead
 *   DELETE /plans/:id  admin, lead (204)
 */
@UseGuards(AuthGuard)
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get(':id')
  async detail(@CurrentUser() caller: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.plans.detail(caller, id) };
  }

  @Roles('admin', 'lead')
  @Patch(':id')
  async update(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
  ) {
    return { data: await this.plans.update(caller, id, dto) };
  }

  @Roles('admin', 'lead')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async remove(@CurrentUser() caller: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.plans.remove(caller, id);
  }
}