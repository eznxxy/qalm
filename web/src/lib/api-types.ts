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
