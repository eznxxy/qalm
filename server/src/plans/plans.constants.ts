/**
 * Contract constants for plans, docs/api-plans.md § Validation and § Endpoints.
 * The shared paging bounds (DEFAULT_PAGE/DEFAULT_LIMIT/MAX_LIMIT) and the
 * `YYYY-MM-DD` pattern live in runs.constants.ts, which is the larger feature.
 */
export const PLAN_NAME_MAX = 120;
export const PLAN_DESCRIPTION_MAX = 1_000;

export const PLAN_SORTS = ['created_at', 'updated_at', 'name', 'due_date'] as const;
export type PlanSortKey = (typeof PLAN_SORTS)[number];
export const PLAN_SORT_PATTERN = /^-?(created_at|updated_at|name|due_date)$/;