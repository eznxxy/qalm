import {
  RecordedCounts,
  passRate,
  sumRecordedCounts,
  totalRecorded,
} from './pass-rate';
import { TrendWindow } from './reports.dates';
import { TrendRow } from './reports.store';

/**
 * Response shapes for docs/api-project-overview.md § Resource: Project trend.
 * `status_counts` has exactly the five recorded statuses — no `untested`.
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
 * Maps the zero-filled rows to the envelope. `totals` is the sum of the buckets
 * with the rate recomputed from those sums (never the mean of the daily rates).
 */
export function toTrendDto(
  projectId: string,
  window: TrendWindow,
  rows: readonly TrendRow[],
): TrendDto {
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
    project_id: projectId,
    from: window.from,
    to: window.to,
    days: window.days,
    buckets,
    totals: {
      status_counts: totalsCounts,
      total: totalRecorded(totalsCounts),
      pass_rate: passRate(totalsCounts),
    },
  };
}