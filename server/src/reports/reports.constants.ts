/**
 * Trend window bounds and the recorded statuses, docs/api-project-overview.md
 * § Endpoint + § Fields. `untested` is deliberately absent: an untested item has
 * no result row, so it cannot be counted on a day.
 */
export const TREND_DEFAULT_DAYS = 14;
export const TREND_MIN_DAYS = 1;
export const TREND_MAX_DAYS = 90;

export const RECORDED_STATUSES = [
  'passed',
  'failed',
  'blocked',
  'retest',
  'skipped',
] as const;

export type RecordedStatus = (typeof RECORDED_STATUSES)[number];