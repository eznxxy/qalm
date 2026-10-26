import { ITEM_STATUSES, ITEM_STATUS_RANK, ItemStatus } from './runs.constants';

/**
 * Per-status rollup over a set of run items, docs/api-runs.md § Resource (Run).
 * Each item counts once, by its latest result (or `untested`). Pure so the
 * rounding and the "0 when total = 0" rule are unit-tested without a database.
 */
export interface StatusCounts {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  retest: number;
  skipped: number;
  untested: number;
  percent_complete: number;
}

/** Round to the nearest whole percent; `0` when there is nothing to count. */
export function percentComplete(total: number, untested: number): number {
  if (total <= 0) return 0;
  return Math.round(((total - untested) / total) * 100);
}

export function emptyCounts(): StatusCounts {
  return {
    total: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
    retest: 0,
    skipped: 0,
    untested: 0,
    percent_complete: 0,
  };
}

/** Counts a list of item statuses (one entry per item). */
export function countsForStatuses(statuses: readonly ItemStatus[]): StatusCounts {
  const counts = emptyCounts();
  for (const status of statuses) {
    counts[status] += 1;
    counts.total += 1;
  }
  counts.percent_complete = percentComplete(counts.total, counts.untested);
  return counts;
}

/**
 * A plan's rollup is the sum of its runs' counts (a completed run still
 * counts). Percentages are re-derived from the summed totals, never averaged.
 */
export function sumCounts(list: readonly StatusCounts[]): StatusCounts {
  const total = emptyCounts();
  for (const counts of list) {
    total.total += counts.total;
    total.passed += counts.passed;
    total.failed += counts.failed;
    total.blocked += counts.blocked;
    total.retest += counts.retest;
    total.skipped += counts.skipped;
    total.untested += counts.untested;
  }
  total.percent_complete = percentComplete(total.total, total.untested);
  return total;
}

/**
 * Normalises a raw status coming from the database (`string | null`) into an
 * item status: `null` (no results) is `untested`; an unexpected value is a
 * contract bug, so it is surfaced loudly rather than silently counted.
 */
export function toItemStatus(raw: string | null | undefined): ItemStatus {
  if (raw === null || raw === undefined) return 'untested';
  if ((ITEM_STATUSES as readonly string[]).includes(raw)) return raw as ItemStatus;
  throw new Error(`Unknown result status from database: ${raw}`);
}

/**
 * SQL fragment for `ORDER BY` severity rank, built from ITEM_STATUS_RANK so a
 * new status cannot silently sort last. `expr` is the status column/expression.
 */
export function statusRankSql(expr: string): string {
  const whens = ITEM_STATUSES.map(
    (status) => `WHEN '${status}' THEN ${ITEM_STATUS_RANK[status]}`,
  ).join(' ');
  return `CASE ${expr} ${whens} ELSE ${ITEM_STATUSES.length + 1} END`;
}

/** The statuses accepted as an item-list filter (`untested` included). */
export const FILTERABLE_ITEM_STATUSES: readonly ItemStatus[] = ITEM_STATUSES;