import { RECORDED_STATUSES, RecordedStatus } from './reports.constants';

/** One result's status counts for a day (or a window), no `untested` key. */
export type RecordedCounts = Record<RecordedStatus, number>;

/** A fresh zeroed counter — every key present, so a response shape is stable. */
export function emptyRecordedCounts(): RecordedCounts {
  const counts = {} as RecordedCounts;
  for (const status of RECORDED_STATUSES) counts[status] = 0;
  return counts;
}

/** Every result recorded, `skipped` included (`total` in the contract). */
export function totalRecorded(counts: RecordedCounts): number {
  let total = 0;
  for (const status of RECORDED_STATUSES) total += counts[status];
  return total;
}

/**
 * Pass rate for a day or a whole window, docs/api-project-overview.md
 * § Fields: `passed / (passed + failed + blocked + retest)`, one decimal,
 * `null` when nothing was given a verdict. `skipped` is counted but never in
 * the denominator, and `untested` cannot appear at all.
 */
export function passRate(counts: RecordedCounts): number | null {
  const denominator = counts.passed + counts.failed + counts.blocked + counts.retest;
  if (denominator === 0) return null;
  return Math.round((counts.passed / denominator) * 1000) / 10;
}

/**
 * Window totals are the sum of the days, with the rate recomputed from the
 * summed counts — never the mean of the daily rates (PRD decision 5).
 */
export function sumRecordedCounts(list: readonly RecordedCounts[]): RecordedCounts {
  const total = emptyRecordedCounts();
  for (const counts of list) {
    for (const status of RECORDED_STATUSES) total[status] += counts[status];
  }
  return total;
}