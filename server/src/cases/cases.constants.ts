/**
 * Contract constants for cases, docs/api-cases.md § Validation and
 * docs/PRD-suites-cases.md § Data model (Case).
 */
export const CASE_TITLE_MAX = 200;
export const CASE_PRECONDITIONS_MAX = 2_000;
export const CASE_STEPS_MAX = 50;
export const CASE_STEP_TEXT_MAX = 500;
export const CASE_STEP_EXPECTED_MAX = 500;
export const CASE_TAGS_MAX = 20;
export const CASE_TAG_MAX = 30;
/** One week in minutes — the contract's upper bound for `estimate_minutes`. */
export const CASE_ESTIMATE_MAX = 10_080;

export const CASE_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];

export const CASE_TYPES = ['functional', 'regression', 'smoke', 'exploratory', 'other'] as const;
export type CaseType = (typeof CASE_TYPES)[number];

/** List sort keys; a leading `-` reverses the order (docs/api-cases.md). */
export const CASE_SORTS = ['case_number', 'updated_at', 'title'] as const;
export type CaseSortKey = (typeof CASE_SORTS)[number];
export const CASE_SORT_PATTERN = /^-?(case_number|updated_at|title)$/;

/** Upper bound for one bulk-move request. */
export const BULK_MOVE_MAX = 200;

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/** Audit-trail actions, docs/api-cases.md § GET /cases/:id/history. */
export const CASE_ACTIONS = ['created', 'updated', 'moved', 'deleted'] as const;
export type CaseAction = (typeof CASE_ACTIONS)[number];
