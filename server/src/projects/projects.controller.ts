import {
  Body,
  Controller,
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
import {
  AuthGuard,
  AuthUser,
  CurrentUser,
  Roles,
} from '../auth/current-user';
import { CreateProjectDto, ListProjectsQuery, UpdateProjectDto } from './dto';
import { ProjectsService } from './projects.service';

/**
 * Projects endpoints, docs/api-projects.md § Endpoints + § Role matrix:
 *   GET  /projects            any authenticated role (archived → Admin only)
 *   POST /projects            admin, lead
 *   GET  /projects/:id        any authenticated role (archived invisible to non-Admins)
 *   PATCH /projects/:id       admin
 *   POST /projects/:id/archive  admin, lead
 *   POST /projects/:id/restore  admin
 * There is deliberately NO DELETE route (data-safety rule).
 */
@UseGuards(AuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() caller: AuthUser, @Query() query: ListProjectsQuery) {
    return this.projects.list(caller, query);
  }

  @Roles('admin', 'lead')
  @Post()
  async create(@CurrentUser() caller: AuthUser, @Body() dto: CreateProjectDto) {
    return { data: await this.projects.create(caller, dto) };
  }

  @Get(':id')
  async detail(@CurrentUser() caller: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.projects.findVisible(id, caller) };
  }

  @Roles('admin')
  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProjectDto) {
    return { data: await this.projects.update(id, dto) };
  }

  @Roles('admin', 'lead')
  @HttpCode(HttpStatus.OK)
  @Post(':id/archive')
  async archive(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.projects.archive(id) };
  }

  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @Post(':id/restore')
  async restore(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.projects.restore(id) };
  }
}
