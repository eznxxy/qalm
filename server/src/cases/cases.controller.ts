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
import { BulkMoveCasesDto, CreateCaseDto, ListCaseHistoryQuery, ListCasesQuery, UpdateCaseDto } from './dto';
import { CasesService } from './cases.service';

/**
 * Cases of one project, docs/api-cases.md § Endpoints + § Role matrix:
 *   GET  /projects/:projectId/cases            any authenticated role
 *   POST /projects/:projectId/cases            admin, lead
 *   POST /projects/:projectId/cases/bulk-move  admin, lead (atomic)
 */
@UseGuards(AuthGuard)
@Controller('projects/:projectId/cases')
export class ProjectCasesController {
  constructor(private readonly cases: CasesService) {}

  @Get()
  async list(
    @CurrentUser() caller: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListCasesQuery,
  ) {
    return this.cases.list(caller, projectId, query);
  }

  @Roles('admin', 'lead')
  @Post()
  async create(
    @CurrentUser() caller: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateCaseDto,
  ) {
    return { data: await this.cases.create(caller, projectId, dto) };
  }

  @Roles('admin', 'lead')
  @HttpCode(HttpStatus.OK)
  @Post('bulk-move')
  async bulkMove(
    @CurrentUser() caller: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: BulkMoveCasesDto,
  ) {
    return { data: await this.cases.bulkMove(caller, projectId, dto) };
  }
}

/**
 * Single-case routes:
 *   GET    /cases/:id          any authenticated role
 *   GET    /cases/:id/history  any authenticated role (paginated audit trail)
 *   PATCH  /cases/:id          admin, lead
 *   DELETE /cases/:id          admin, lead (soft delete, 204)
 */
@UseGuards(AuthGuard)
@Controller('cases')
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Get(':id/history')
  async history(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListCaseHistoryQuery,
  ) {
    return this.cases.history(caller, id, query);
  }

  @Get(':id')
  async detail(@CurrentUser() caller: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.cases.detail(caller, id) };
  }

  @Roles('admin', 'lead')
  @Patch(':id')
  async update(
    @CurrentUser() caller: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCaseDto,
  ) {
    return { data: await this.cases.update(caller, id, dto) };
  }

  @Roles('admin', 'lead')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async remove(@CurrentUser() caller: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.cases.remove(caller, id);
  }
}
