import type { ListMeta } from '../projects/projects.service';
import { StatusCounts, percentComplete } from '../runs/run-counts';
import {
  RecordedCounts,
  passRate,
  sumRecordedCounts,
  totalRecorded,
} from './pass-rate';
import { TrendWindow } from './reports.dates';
import type { ReportFiltersDto } from './reports.filters';
import { ProgressItemsRow, ProgressRunRow, TrendRow } from './reports.store';

/**
 * Response shapes. The trend body is docs/api-project-overview.md § Resource:
 * Project trend; the summary that nests it (plus `filters` and `progress`) is
 * docs/api-reports.md § Resource: Report summary. `status_counts` has exactly
 * the five recorded statuses — no `untested`.
 */
export interface TrendBucketDto {
  date: string;
  status_counts: RecordedCounts;
  total: number;
  pass_rate: number | null;
}

export interface TrendTotalsDto {
  status_counts: RecordedCounts;
  total: number;
  pass_rate: number | null;
}

export interface TrendBodyDto {
  buckets: TrendBucketDto[];
  totals: TrendTotalsDto;
}

export interface TrendDto {
  project_id: string;
  from: string;
  to: string;
  days: number;
  buckets: TrendBucketDto[];
  totals: TrendTotalsDto;
}

function countsOf(row: TrendRow): RecordedCounts {
  return {
    passed: row.passed,
    failed: row.failed,
    blocked: row.blocked,
    retest: row.retest,
    skipped: row.skipped,
  };
}

/**
 * Maps the zero-filled rows to the body. `totals` is the sum of the buckets
 * with the rate recomputed from those sums (never the mean of the daily rates).
 */
export function toTrendBody(rows: readonly TrendRow[]): TrendBodyDto {
  const buckets: TrendBucketDto[] = rows.map((row) => {
    const statusCounts = countsOf(row);
    return {
      date: row.day,
      status_counts: statusCounts,
      total: totalRecorded(statusCounts),
      pass_rate: passRate(statusCounts),
    };
  });
  const totalsCounts = sumRecordedCounts(buckets.map((bucket) => bucket.status_counts));
  return {
    buckets,
    totals: {
      status_counts: totalsCounts,
      total: totalRecorded(totalsCounts),
      pass_rate: passRate(totalsCounts),
    },
  };
}

/** The `trend` object shared by the trend route and the summary route. */
export function toTrendDto(
  projectId: string,
  window: TrendWindow,
  rows: readonly TrendRow[],
): TrendDto {
  return { project_id: projectId, from: window.from, to: window.to, days: window.days, ...toTrendBody(rows) };
}

export interface ProgressRunDto {
  id: string;
  name: string;
  status: 'open' | 'completed';
  plan_id: string | null;
  plan_name: string | null;
  milestone_id: string | null;
  milestone_name: string | null;
  start_date: string | null;
  due_date: string | null;
  counts: StatusCounts;
  pass_rate: number | null;
  results_in_window: number;
  last_result_at: string | null;
}

export interface ProgressItemsDto {
  total: number;
  with_results: number;
  untested: number;
  percent_complete: number;
}

export interface ProgressDto {
  data: ProgressRunDto[];
  meta: ListMeta;
  items: ProgressItemsDto;
}

export interface ReportSummaryDto {
  project_id: string;
  from: string;
  to: string;
  days: number;
  filters: ReportFiltersDto;
  trend: TrendBodyDto;
  progress: ProgressDto;
}

export function toProgressRunDto(row: ProgressRunRow): ProgressRunDto {
  const counts: StatusCounts = {
    total: row.total,
    passed: row.passed,
    failed: row.failed,
    blocked: row.blocked,
    retest: row.retest,
    skipped: row.skipped,
    untested: row.untested,
    percent_complete: percentComplete(row.total, row.untested),
  };
  return {
    id: row.id,
    name: row.name,
    status: row.completed ? 'completed' : 'open',
    plan_id: row.plan_id,
    plan_name: row.plan_name,
    milestone_id: row.milestone_id,
    milestone_name: row.milestone_name,
    start_date: row.start_date,
    due_date: row.due_date,
    counts,
    pass_rate: passRate({
      passed: row.passed,
      failed: row.failed,
      blocked: row.blocked,
      retest: row.retest,
      skipped: row.skipped,
    }),
    results_in_window: row.results_in_window,
    last_result_at: row.last_result_at ? row.last_result_at.toISOString() : null,
  };
}

export function toProgressItemsDto(row: ProgressItemsRow): ProgressItemsDto {
  const untested = row.total - row.with_results;
  return {
    total: row.total,
    with_results: row.with_results,
    untested,
    percent_complete: percentComplete(row.total, untested),
  };
}

export function toReportSummaryDto(
  projectId: string,
  window: TrendWindow,
  filters: ReportFiltersDto,
  trendRows: readonly TrendRow[],
  progressRows: readonly ProgressRunRow[],
  meta: ListMeta,
  items: ProgressItemsRow,
): ReportSummaryDto {
  return {
    project_id: projectId,
    from: window.from,
    to: window.to,
    days: window.days,
    filters,
    trend: toTrendBody(trendRows),
    progress: {
      data: progressRows.map(toProgressRunDto),
      meta,
      items: toProgressItemsDto(items),
    },
  };
}
