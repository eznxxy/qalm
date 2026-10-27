/**
 * Types mirroring docs/api-auth.md and docs/api-conventions.md.
 * JSON keys are snake_case per the API conventions — do not rename.
 */

export type Role = "admin" | "lead" | "tester" | "viewer";

export const ROLES: readonly Role[] = ["admin", "lead", "tester", "viewer"] as const;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
}

/** data envelope of POST /auth/bootstrap and POST /auth/login */
export interface AuthSession {
  user: User;
  access_token: string;
  token_type: string;
  expires_in: number;
}

/** data envelope of POST /auth/refresh */
export interface RefreshResult {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface Page<T> {
  data: T;
  meta?: PaginationMeta;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface BootstrapInput {
  name: string;
  email: string;
  password: string;
}

export interface PatchMeInput {
  name?: string;
  current_password?: string;
  new_password?: string;
}

export interface UserListQuery {
  query?: string;
  role?: Role;
  page?: number;
  limit?: number;
}

export interface CreateUserInput {
  email: string;
  name: string;
  role: Role;
  password: string;
}

/** any subset per contract PATCH /users/:id */
export interface UpdateUserInput {
  name?: string;
  role?: Role;
  is_active?: boolean;
  password?: string;
}

// ---- projects (docs/api-projects.md) ----

export type ProjectStatus = "active" | "archived";

/** docs/api-projects.md § Resource: Project */
export interface Project {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** POST /projects body. */
export interface CreateProjectInput {
  name: string;
  key: string;
  description?: string;
}

/** Any subset per contract PATCH /projects/:id; status is never settable. */
export interface UpdateProjectInput {
  name?: string;
  key?: string;
  description?: string;
}

export interface ProjectListQuery {
  query?: string;
  /** `archived` is Admin-only per the contract — the UI gates it on role. */
  status?: ProjectStatus;
  page?: number;
  limit?: number;
}

// ---- suites (docs/api-suites.md) ----

/** docs/api-suites.md § Resource: Suite */
export interface Suite {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  depth: number;
  position: number;
  /** Subtree count, live cases only. */
  case_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** GET /projects/:projectId/suites node — the Suite shape plus children. */
export interface SuiteNode extends Suite {
  children: SuiteNode[];
}

export interface SuitePathEntry {
  id: string;
  name: string;
}

/** GET /suites/:id — Suite plus its root → self ancestor trail. */
export interface SuiteDetail extends Suite {
  path: SuitePathEntry[];
}

export interface CreateSuiteInput {
  name: string;
  description?: string;
  parent_id?: string | null;
}

/** Any non-empty subset per PATCH /suites/:id. */
export interface UpdateSuiteInput {
  name?: string;
  description?: string | null;
  parent_id?: string | null;
  position?: number;
}

export interface SuiteOrderItem {
  id: string;
  parent_id: string | null;
  position: number;
}

export interface ReorderSuitesInput {
  /** Only the sibling groups that changed, per the contract. */
  items: SuiteOrderItem[];
}

// ---- cases (docs/api-cases.md) ----

export type Priority = "critical" | "high" | "medium" | "low";

export const PRIORITIES: readonly Priority[] = [
  "critical",
  "high",
  "medium",
  "low",
] as const;

export const PRIORITY_LABELS: Record<Priority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export type CaseType =
  | "functional"
  | "regression"
  | "smoke"
  | "exploratory"
  | "other";

export const CASE_TYPES: readonly CaseType[] = [
  "functional",
  "regression",
  "smoke",
  "exploratory",
  "other",
] as const;

export const CASE_TYPE_LABELS: Record<CaseType, string> = {
  functional: "Functional",
  regression: "Regression",
  smoke: "Smoke",
  exploratory: "Exploratory",
  other: "Other",
};

export interface CaseStep {
  position: number;
  text: string;
  expected_result: string | null;
}

/** docs/api-cases.md § Resource: Case (detail) */
export interface CaseDetail {
  id: string;
  project_id: string;
  suite_id: string | null;
  case_number: number;
  display_id: string;
  title: string;
  preconditions: string | null;
  steps: CaseStep[];
  priority: Priority;
  type: CaseType;
  tags: string[];
  estimate_minutes: number | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

/** List item — no step bodies or preconditions, plus step_count. */
export interface CaseListItem
  extends Omit<CaseDetail, "steps" | "preconditions"> {
  step_count: number;
}

export type CaseHistoryAction = "created" | "updated" | "moved" | "deleted";

export interface CaseHistoryEntry {
  id: string;
  case_id: string;
  actor_id: string;
  action: CaseHistoryAction;
  changes: Record<string, unknown>;
  created_at: string;
}

export type CaseSortKey = "case_number" | "updated_at" | "title" | "priority";

/** `priority` sorts by severity (critical first when ascending). */
export type CaseSort =
  | "case_number"
  | "-case_number"
  | "updated_at"
  | "-updated_at"
  | "title"
  | "-title"
  | "priority"
  | "-priority";

export interface CaseListQuery {
  suite_id?: string;
  /** Defaults to true server-side; pass false for direct cases only. */
  include_descendants?: boolean;
  query?: string;
  priority?: readonly Priority[];
  type?: readonly CaseType[];
  /** Repeatable; AND across values. */
  tag?: readonly string[];
  sort?: CaseSort;
  page?: number;
  limit?: number;
}

/** A step as submitted; `position` is derived from array order. */
export interface CaseStepInput {
  text: string;
  expected_result?: string | null;
}

export interface CreateCaseInput {
  suite_id: string;
  title: string;
  preconditions?: string;
  steps?: CaseStepInput[];
  priority: Priority;
  type: CaseType;
  tags?: string[];
  estimate_minutes?: number;
}

/** Any non-empty subset per PATCH /cases/:id; null clears optional fields. */
export interface UpdateCaseInput {
  suite_id?: string;
  title?: string;
  preconditions?: string | null;
  steps?: CaseStepInput[];
  priority?: Priority;
  type?: CaseType;
  tags?: string[];
  estimate_minutes?: number | null;
}

export interface BulkMoveCasesInput {
  case_ids: string[];
  suite_id: string;
}

export interface BulkMoveCasesResult {
  moved: number;
  case_ids: string[];
}

export interface CaseHistoryQuery {
  page?: number;
  limit?: number;
}

// ---- plans & runs (docs/api-plans.md, docs/api-runs.md) ----

/**
 * Rollup counts shared by a plan and a run (docs/api-plans.md § Resource: Plan,
 * docs/api-runs.md § Resource: Run). Each item is counted once, by its latest
 * result, or `untested` when it has none.
 */
export interface StatusCounts {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  retest: number;
  skipped: number;
  untested: number;
  /** round((total - untested) / total * 100); 0 when total is 0. */
  percent_complete: number;
}

export type PlanSortKey = "created_at" | "updated_at" | "name" | "due_date";

export type PlanSort =
  | "created_at"
  | "-created_at"
  | "updated_at"
  | "-updated_at"
  | "name"
  | "-name"
  | "due_date"
  | "-due_date";

/** A thin container over runs (docs/api-plans.md). */
export interface Plan {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  due_date: string | null;
  run_count: number;
  counts: StatusCounts;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface PlanListQuery {
  query?: string;
  sort?: PlanSort;
  page?: number;
  limit?: number;
}

/** A run created inline with its plan (docs/api-plans.md § POST /plans). */
export interface CreatePlanRunInput {
  name: string;
  /** Omit or `null` for none. */
  description?: string | null;
  /** Plain `YYYY-MM-DD`; omit or `null` for none. */
  start_date?: string | null;
  /** Plain `YYYY-MM-DD`; omit or `null` for none. */
  due_date?: string | null;
}

/**
 * POST /projects/:projectId/plans (docs/api-plans.md § Validation).
 *
 * A plan is born with at least one run, either new (`runs`) or an existing
 * unplanned one (`run_ids`), or both — at most 20 together.
 */
export interface CreatePlanInput {
  name: string;
  /** Omit or `null` for none. */
  description?: string | null;
  /** Plain `YYYY-MM-DD`; omit or `null` for none. */
  due_date?: string | null;
  /** New runs, inserted with the plan in one transaction. */
  runs?: CreatePlanRunInput[];
  /** Existing runs with no plan, attached to the new plan (3.10). */
  run_ids?: string[];
}

/** PATCH /plans/:id — any non-empty subset; `null` clears an optional field. */
export interface UpdatePlanInput {
  name?: string;
  description?: string | null;
  due_date?: string | null;
}

/** A run is `open` until it is closed; `completed_at` drives the status. */
export type RunStatus = "open" | "completed";

export const RUN_STATUSES: readonly RunStatus[] = ["open", "completed"] as const;

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  open: "Open",
  completed: "Completed",
};

/** Rollup over the run's items — same shape and rules as a plan's. */
export type RunCounts = StatusCounts;

/** docs/api-runs.md § Resource: Run */
export interface Run {
  id: string;
  project_id: string;
  plan_id: string | null;
  name: string;
  description: string | null;
  status: RunStatus;
  /** Plain `YYYY-MM-DD`, not an instant; may not be after `due_date`. */
  start_date: string | null;
  /** Plain `YYYY-MM-DD`, not an instant. */
  due_date: string | null;
  completed_at: string | null;
  completed_by: string | null;
  counts: RunCounts;
  /** Distinct non-null assignees among the run's items. */
  assignee_ids: string[];
  /** Distinct non-null item `case_suite_id` snapshots — the sections this run
   * has items from (the Section filter's options). */
  suite_ids: string[];
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export type RunSortKey =
  | "created_at"
  | "updated_at"
  | "start_date"
  | "due_date"
  | "name";

/** Null `start_date`/`due_date` sort last regardless of direction (server-side). */
export type RunSort =
  | "created_at"
  | "-created_at"
  | "updated_at"
  | "-updated_at"
  | "start_date"
  | "-start_date"
  | "due_date"
  | "-due_date"
  | "name"
  | "-name";

export interface RunListQuery {
  /** UUID, or the literal `"none"` for runs with no plan. */
  plan_id?: string;
  status?: RunStatus;
  query?: string;
  sort?: RunSort;
  page?: number;
  limit?: number;
}

/**
 * Create-only case selection: explicit cases and/or a suite subtree. The API
 * unions and de-duplicates them; an omitted or empty selection creates an
 * empty run.
 */
export interface RunSelection {
  case_ids?: string[];
  suite_id?: string;
  /** Server default is true; send false for direct cases only. */
  include_descendants?: boolean;
}

export interface CreateRunInput {
  name: string;
  description?: string;
  plan_id?: string;
  /** Plain `YYYY-MM-DD`; server 400s a start date after `due_date`. */
  start_date?: string;
  due_date?: string;
  selection?: RunSelection;
}

/** Any non-empty subset per PATCH /runs/:id. */
export interface UpdateRunInput {
  name?: string;
  description?: string | null;
  /** `null` detaches the run from its plan. */
  plan_id?: string | null;
  start_date?: string | null;
  due_date?: string | null;
}

// ---- run items & results (docs/api-runs.md) ----

/** An item's status: its latest result, or `untested` when it has none. */
export type ItemStatus =
  | "passed"
  | "failed"
  | "blocked"
  | "retest"
  | "skipped"
  | "untested";

export const ITEM_STATUSES: readonly ItemStatus[] = [
  "passed",
  "failed",
  "blocked",
  "retest",
  "skipped",
  "untested",
] as const;

/** What a result may be recorded with — everything except `untested`. */
export type ResultStatus = Exclude<ItemStatus, "untested">;

export const RESULT_STATUSES: readonly ResultStatus[] = [
  "passed",
  "failed",
  "blocked",
  "retest",
  "skipped",
] as const;

/** Result status → its design shortcut (DESIGN §4.4: P, F, B, R, S). */
export const RESULT_STATUS_SHORTCUTS: Record<ResultStatus, string> = {
  passed: "P",
  failed: "F",
  blocked: "B",
  retest: "R",
  skipped: "S",
};

export function isResultStatus(value: string): value is ResultStatus {
  return (RESULT_STATUSES as readonly string[]).includes(value);
}

export function isItemStatus(value: string): value is ItemStatus {
  return (ITEM_STATUSES as readonly string[]).includes(value);
}

/** docs/api-runs.md § Resource: Result → attachments[] */
export interface ResultAttachment {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

/** docs/api-runs.md § Resource: Result */
export interface Result {
  id: string;
  run_item_id: string;
  status: ResultStatus;
  comment: string | null;
  elapsed_minutes: number | null;
  defect_url: string | null;
  attachments: ResultAttachment[];
  created_by: string;
  created_at: string;
}

/** The item's newest result as embedded in the items list (no bytes). */
export interface LatestResult {
  id: string;
  status: ResultStatus;
  comment: string | null;
  elapsed_minutes: number | null;
  defect_url: string | null;
  attachment_count: number;
  created_by: string;
  created_at: string;
}

/** docs/api-runs.md § Resource: Run item */
export interface RunItem {
  id: string;
  run_id: string;
  /** `null` only if the case row was later hard-deleted (the snapshot stays).
   */
  case_id: string | null;
  case_display_id: string;
  case_title: string;
  case_priority: Priority;
  case_suite_id: string | null;
  assignee_id: string | null;
  /** The run's authored order (ascending). */
  position: number;
  status: ItemStatus;
  result_count: number;
  latest_result: LatestResult | null;
  created_at: string;
  updated_at: string;
}

/** GET /runs/:id/items/:itemId — the item plus the result drawer's snapshots. */
export interface RunItemDetail extends RunItem {
  case_steps: CaseStep[];
  /** Read-through from the live case, not snapshotted. */
  case_preconditions: string | null;
}

export type RunItemSortKey =
  | "position"
  | "case_display_id"
  | "status"
  | "updated_at";

/** `status` sorts by severity: failed → blocked → retest → passed → skipped →
 * untested (server-side). */
export type RunItemSort =
  | "position"
  | "-position"
  | "case_display_id"
  | "-case_display_id"
  | "status"
  | "-status"
  | "updated_at"
  | "-updated_at";

export interface RunItemListQuery {
  /** Repeatable; OR within. `untested` matches items with no results. */
  status?: ItemStatus[];
  /** A user id, or the literal `"none"` for unassigned items. */
  assignee_id?: string;
  /** Matches the item's snapshotted `case_suite_id` (with descendants). */
  suite_id?: string;
  query?: string;
  sort?: RunItemSort;
  page?: number;
  limit?: number;
}

export interface CreateResultInput {
  status: ResultStatus;
  /** Required when `status` is `failed` (validated by the API too). */
  comment?: string;
  elapsed_minutes?: number;
  defect_url?: string;
}

/** PATCH /results/:id — `status` is immutable and never accepted. */
export interface UpdateResultInput {
  comment?: string | null;
  elapsed_minutes?: number | null;
  defect_url?: string | null;
}

export interface ResultListQuery {
  page?: number;
  limit?: number;
}

/** POST /runs/:id/items/:itemId (single) or the bulk POST /runs/:id/assign. */
export interface AssignRunItemsInput {
  /** `null` unassigns. */
  assignee_id: string | null;
  /** Omit to assign every item in the run. */
  item_ids?: string[];
}

/** Any non-empty subset per PATCH /runs/:id/items/:itemId. */
export interface UpdateRunItemInput {
  assignee_id?: string | null;
  position?: number;
}

export interface AddRunItemsInput {
  case_ids: string[];
}

export interface AddRunItemsResult {
  added: number;
  skipped: number;
  item_ids: string[];
}

/** GET /cases/:id/runs — a run that contains the case (Linked runs tab). */
export interface LinkedRun {
  run_id: string;
  run_name: string;
  run_status: RunStatus;
  plan_id: string | null;
  item_id: string;
  status: ItemStatus;
  updated_at: string;
}

export interface LinkedRunQuery {
  page?: number;
  limit?: number;
}
