import { Inject, Injectable } from '@nestjs/common';
import { AuthUser } from '../auth/current-user';
import { ApiError } from '../errors';
import { buildListMeta } from '../projects/projects.service';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '../runs/runs.constants';
import { SUMMARY_DEFAULT_DAYS, TREND_DEFAULT_DAYS } from './reports.constants';
import { trendWindow } from './reports.dates';
import { ReportSummaryQuery, TrendQuery } from './reports.dto';
import { resolveReportFilters, toReportFiltersDto } from './reports.filters';
import { ReportsStore } from './reports.store';
import { ReportSummaryDto, TrendDto, toReportSummaryDto, toTrendDto } from './reports.types';

/**
 * Business rules for the reports endpoints, docs/api-project-overview.md. Role
 * checks live in the controller (AuthGuard); the archived-project rule lives
 * here and mirrors PlansService, RunsService and MilestonesService so every
 * project-scoped read answers the same way.
 *
 * The window is resolved once per request in UTC, so a request that runs across
 * midnight UTC still returns a self-consistent `from`/`to`.
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(ReportsStore) private readonly store: ReportsStore) {}

  async trend(
    caller: AuthUser,
    projectId: string,
    query: TrendQuery,
  ): Promise<TrendDto> {
    await this.requireProject(projectId, caller);
    const window = trendWindow(query.days ?? TREND_DEFAULT_DAYS, new Date());
    const rows = await this.store.trend(projectId, window.from, window.to);
    return toTrendDto(projectId, window, rows);
  }

  /**
   * Trend plus run progress over the same filters, docs/api-reports.md. One
   * resolved window and one filter object feed all four reads, so the tiles and
   * the table can never describe different sets of runs.
   */
  async summary(
    caller: AuthUser,
    projectId: string,
    query: ReportSummaryQuery,
  ): Promise<ReportSummaryDto> {
    await this.requireProject(projectId, caller);
    const window = trendWindow(query.days ?? SUMMARY_DEFAULT_DAYS, new Date());
    const filter = resolveReportFilters(query);
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const [trendRows, total, progressRows, items] = await Promise.all([
      this.store.trend(projectId, window.from, window.to, filter),
      this.store.countRuns(projectId, filter),
      this.store.progress(
        projectId,
        filter,
        window.from,
        window.to,
        limit,
        (page - 1) * limit,
      ),
      this.store.progressItems(projectId, filter),
    ]);
    return toReportSummaryDto(
      projectId,
      window,
      toReportFiltersDto(query),
      trendRows,
      progressRows,
      buildListMeta(total, page, limit),
      items,
    );
  }

  /**
   * Contract visibility: unknown project → 404; an archived project is 404 for
   * every non-Admin, including reads (docs/api-projects.md). There is no write
   * path in this slice.
   */
  private async requireProject(projectId: string, caller: AuthUser): Promise<void> {
    const project = await this.store.findProject(projectId);
    if (!project) throw new ApiError('NOT_FOUND', 'Project not found.');
    if (project.status !== 'archived') return;
    if (caller.role !== 'admin') {
      throw new ApiError('NOT_FOUND', 'Project not found.');
    }
  }
}