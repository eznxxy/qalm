/**
 * Contract constants for runs, items and results, docs/api-runs.md § Validation
 * and docs/PRD-plans-runs.md § Data model. Plans keep their own constants in
 * plans.constants.ts; the shared paging bounds live here because runs is the
 * larger feature.
 */
export const RUN_NAME_MAX = 120;
export const RUN_DESCRIPTION_MAX = 1_000;
export const PLAN_NAME_MAX = 120;
export const PLAN_DESCRIPTION_MAX = 1_000;

/** `YYYY-MM-DD` — a calendar date with no time or zone. */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Upper bound for one run (contract: "A run may hold at most 2,000 items"). */
export const MAX_RUN_ITEMS = 2_000;
/** Upper bound for one add-cases request. */
export const ADD_CASES_MAX = 200;

export const RESULT_STATUSES = ['passed', 'failed', 'blocked', 'retest', 'skipped'] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

/** Item status adds the derived `untested` (no results at all). */
export const ITEM_STATUSES = ['untested', ...RESULT_STATUSES] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Severity order for `sort=status` on the items list (worst first). */
export const ITEM_STATUS_RANK: Record<ItemStatus, number> = {
  failed: 1,
  blocked: 2,
  retest: 3,
  passed: 4,
  skipped: 5,
  untested: 6,
};

export const RESULT_COMMENT_MAX = 4_000;
export const RESULT_ELAPSED_MAX = 10_080;
export const RESULT_DEFECT_URL_MAX = 500;

/** Roles that may be an item assignee (PRD decision 2). */
export const ASSIGNEE_ROLES = ['admin', 'lead', 'tester'] as const;

export const RUN_SORTS = ['created_at', 'updated_at', 'due_date', 'name'] as const;
export type RunSortKey = (typeof RUN_SORTS)[number];
export const RUN_SORT_PATTERN = /^-?(created_at|updated_at|due_date|name)$/;

export const ITEM_SORTS = ['position', 'case_display_id', 'status', 'updated_at'] as const;
export type ItemSortKey = (typeof ITEM_SORTS)[number];
export const ITEM_SORT_PATTERN = /^-?(position|case_display_id|status|updated_at)$/;

export const PLAN_SORTS = ['created_at', 'updated_at', 'name', 'due_date'] as const;
export type PlanSortKey = (typeof PLAN_SORTS)[number];
export const PLAN_SORT_PATTERN = /^-?(created_at|updated_at|name|due_date)$/;

/** Attachments (PRD decision 5, docs/api-runs.md § Resource: Result). */
export const ATTACHMENT_MAX_PER_RESULT = 5;
export const ATTACHMENT_MAX_BYTES = 10 * 1_048_576;
/** Original filename, trimmed 1–255 chars (never used as a storage path). */
export const ATTACHMENT_FILENAME_MAX = 255;
export const ATTACHMENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
] as const;

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;