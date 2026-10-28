import { Transform, TransformFnParams } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_LIMIT } from '../runs/runs.constants';
import { IsUuidOrNone } from '../runs/dto';
import { TREND_MAX_DAYS, TREND_MIN_DAYS } from './reports.constants';
import type { ReportStatus } from './reports.filters';

/**
 * Query DTOs for the reports endpoints, docs/api-project-overview.md
 * § Endpoint. `days` is the only input; `from`/`to` are derived so a client
 * cannot ask for an unbounded window.
 */
function transformToNumber(): PropertyDecorator {
  return Transform((params: TransformFnParams): unknown => {
    const value: unknown = params.value;
    return typeof value === 'string' ? Number(value) : value;
  });
}

/** `GET /projects/:projectId/reports/trend` — `days` 1–90, default 14. */
export class TrendQuery {
  @IsOptional()
  @transformToNumber()
  @IsInt()
  @Min(TREND_MIN_DAYS)
  @Max(TREND_MAX_DAYS)
  days?: number;
}

/** `GET /projects/:projectId/reports/summary` — days + filters + paging. */
export class ReportSummaryQuery {
  @IsOptional()
  @transformToNumber()
  @IsInt()
  @Min(TREND_MIN_DAYS)
  @Max(TREND_MAX_DAYS)
  days?: number;

  @IsOptional()
  @IsUuidOrNone()
  plan_id?: string;

  @IsOptional()
  @IsUuidOrNone()
  milestone_id?: string;

  @IsOptional()
  @IsIn(['open', 'completed'])
  status?: ReportStatus;

  @IsOptional()
  @transformToNumber()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @transformToNumber()
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;
}