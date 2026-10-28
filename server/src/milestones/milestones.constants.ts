/**
 * Contract constants for milestones, docs/api-milestones.md § Validation and
 * § Endpoints. The shared paging bounds (DEFAULT_PAGE/DEFAULT_LIMIT/MAX_LIMIT)
 * and the `YYYY-MM-DD` pattern live in runs.constants.ts, the larger feature.
 */
export const MILESTONE_NAME_MAX = 120;
export const MILESTONE_DESCRIPTION_MAX = 1_000;

/** Most runs one attach request may name (docs/api-milestones.md § attach). */
export const MILESTONE_RUNS_MAX = 50;

/** Default list order: the contract sorts by due date, undated last. */
export const MILESTONE_DEFAULT_SORT = 'due_date';

export const MILESTONE_SORTS = ['created_at', 'updated_at', 'name', 'due_date'] as const;
export type MilestoneSortKey = (typeof MILESTONE_SORTS)[number];
export const MILESTONE_SORT_PATTERN = /^-?(created_at|updated_at|name|due_date)$/;