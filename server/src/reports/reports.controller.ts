import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, AuthUser, CurrentUser } from '../auth/current-user';
import { ReportSummaryQuery, TrendQuery } from './reports.dto';
import { ReportsService } from './reports.service';

/**
 * Project reports. The trend route is documented in
 * docs/api-project-overview.md § Endpoint; the summary (same trend body plus
 * filtered run progress) in docs/api-reports.md § Endpoint:
 *   GET /projects/:projectId/reports/trend    any authenticated role
 *   GET /projects/:projectId/reports/summary  any authenticated role
 * Read-only; every role may read results already. The archived-project rule
 * (Admin sees it, everyone else gets 404) is applied in the service.
 */
@UseGuards(AuthGuard)
@Controller('projects/:projectId/reports')
export class ProjectReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('trend')
  async trend(
    @CurrentUser() caller: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: TrendQuery,
  ) {
    return { data: await this.reports.trend(caller, projectId, query) };
  }

  @Get('summary')
  async summary(
    @CurrentUser() caller: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ReportSummaryQuery,
  ) {
    return { data: await this.reports.summary(caller, projectId, query) };
  }
}