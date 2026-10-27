import { Inject, Injectable } from '@nestjs/common';
import { AuthUser } from '../auth/current-user';
import { ApiError } from '../errors';
import { TREND_DEFAULT_DAYS } from './reports.constants';
import { trendWindow } from './reports.dates';
import { TrendQuery } from './reports.dto';
import { ReportsStore } from './reports.store';
import { TrendDto, toTrendDto } from './reports.types';

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