import { createApiClient, ApiClient, RequestOptions } from "./api-client";
import {
  AddRunItemsInput,
  AddRunItemsResult,
  AssignRunItemsInput,
  AttachMilestoneRunsInput,
  AttachMilestoneRunsResult,
  AuthSession,
  BootstrapInput,
  BulkMoveCasesInput,
  BulkMoveCasesResult,
  CaseDetail,
  CaseHistoryEntry,
  CaseHistoryQuery,
  CaseListQuery,
  CaseListItem,
  CreateMilestoneInput,
  CreateProjectInput,
  CreateResultInput,
  CreateRunInput,
  CreateSuiteInput,
  CreateUserInput,
  CreateCaseInput,
  CreatePlanInput,
  UpdateMilestoneInput,
  UpdatePlanInput,
  LinkedRun,
  LinkedRunQuery,
  LoginInput,
  Milestone,
  MilestoneListQuery,
  PatchMeInput,
  Plan,
  PlanListQuery,
  Project,
  ProjectListQuery,
  ProjectTrend,
  RefreshResult,
  ReorderSuitesInput,
  Result,
  ResultAttachment,
  ResultListQuery,
  Run,
  RunItem,
  RunItemDetail,
  RunItemListQuery,
  RunListQuery,
  SuiteDetail,
  SuiteNode,
  UpdateCaseInput,
  UpdateProjectInput,
  UpdateResultInput,
  UpdateRunInput,
  UpdateRunItemInput,
  UpdateSuiteInput,
  UpdateUserInput,
  User,
  UserListQuery,
} from "./api-types";

/**
 * Token + refresh wiring for the shared API client. Module scope is fine:
 * the access token lives in memory for the lifetime of the tab and is
 * intentionally never persisted (the HttpOnly refresh cookie is the
 * durable session; see docs/api-auth.md).
 */
let accessToken: string | null = null;
let refreshFn: (() => Promise<string | null>) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** The auth context registers its refresh routine here at mount time. */
export function setRefreshHandler(fn: () => Promise<string | null>): void {
  refreshFn = fn;
}

async function refreshViaHandler(): Promise<string | null> {
  if (!refreshFn) return null;
  return refreshFn();
}

const client: ApiClient = createApiClient({
  getToken: getAccessToken,
  setToken: setAccessToken,
  refresh: refreshViaHandler,
});

function opts(method: RequestOptions["method"], body?: unknown): RequestOptions {
  return { method, body };
}

export const api = {
  // ---- auth (docs/api-auth.md) ----
  bootstrap: (input: BootstrapInput) =>
    client.apiFetch<AuthSession>("/auth/bootstrap", opts("POST", input)),

  login: (input: LoginInput) =>
    client.apiFetch<AuthSession>("/auth/login", opts("POST", input)),

  refresh: () =>
    client.apiFetch<RefreshResult>("/auth/refresh", {
      method: "POST",
      skipAuthRetry: true,
    }),

  logout: () => client.apiFetch<void>("/auth/logout", opts("POST")),

  me: () => client.apiFetch<User>("/auth/me"),

  patchMe: (input: PatchMeInput) =>
    client.apiFetch<User>("/auth/me", opts("PATCH", input)),

  // ---- user management (Admin only) ----
  listUsers: (query: UserListQuery = {}) =>
    client.apiFetchPage<User>("/users", {
      query: {
        query: query.query,
        role: query.role,
        page: query.page,
        limit: query.limit,
      },
    }),

  getUser: (id: string) => client.apiFetch<User>(`/users/${encodeURIComponent(id)}`),

  createUser: (input: CreateUserInput) =>
    client.apiFetch<User>("/users", opts("POST", input)),

  updateUser: (id: string, input: UpdateUserInput) =>
    client.apiFetch<User>(`/users/${encodeURIComponent(id)}`, opts("PATCH", input)),

  // ---- projects (docs/api-projects.md) ----
  listProjects: (query: ProjectListQuery = {}) =>
    client.apiFetchPage<Project>("/projects", {
      query: {
        query: query.query,
        status: query.status,
        page: query.page,
        limit: query.limit,
      },
    }),

  getProject: (id: string) =>
    client.apiFetch<Project>(`/projects/${encodeURIComponent(id)}`),

  createProject: (input: CreateProjectInput) =>
    client.apiFetch<Project>("/projects", opts("POST", input)),

  /** PATCH must not set status per the contract — this signature cannot. */
  updateProject: (id: string, input: UpdateProjectInput) =>
    client.apiFetch<Project>(`/projects/${encodeURIComponent(id)}`, opts("PATCH", input)),

  /** Idempotent server-side (archiving an archived project → 200). */
  archiveProject: (id: string) =>
    client.apiFetch<Project>(`/projects/${encodeURIComponent(id)}/archive`, opts("POST")),

  /** Admin only per the role matrix; idempotent. */
  restoreProject: (id: string) =>
    client.apiFetch<Project>(`/projects/${encodeURIComponent(id)}/restore`, opts("POST")),

  // ---- reports (docs/api-project-overview.md) ----
  /** Daily results for the last `days` UTC days, ending today, inclusive. */
  getProjectTrend: (projectId: string, days: number) =>
    client.apiFetch<ProjectTrend>(
      `/projects/${encodeURIComponent(projectId)}/reports/trend`,
      { query: { days } }
    ),

  // ---- suites (docs/api-suites.md) ----
  /** Whole project tree, nested; not paginated. */
  listSuites: (projectId: string) =>
    client.apiFetch<SuiteNode[]>(
      `/projects/${encodeURIComponent(projectId)}/suites`
    ),

  getSuite: (id: string) =>
    client.apiFetch<SuiteDetail>(`/suites/${encodeURIComponent(id)}`),

  createSuite: (projectId: string, input: CreateSuiteInput) =>
    client.apiFetch<SuiteNode>(
      `/projects/${encodeURIComponent(projectId)}/suites`,
      opts("POST", input)
    ),

  updateSuite: (id: string, input: UpdateSuiteInput) =>
    client.apiFetch<SuiteNode>(
      `/suites/${encodeURIComponent(id)}`,
      opts("PATCH", input)
    ),

  /** Atomic reorder; returns the reconciled tree per the contract. */
  reorderSuites: (projectId: string, input: ReorderSuitesInput) =>
    client.apiFetch<SuiteNode[]>(
      `/projects/${encodeURIComponent(projectId)}/suites/order`,
      opts("PATCH", input)
    ),

  deleteSuite: (id: string) =>
    client.apiFetch<void>(`/suites/${encodeURIComponent(id)}`, opts("DELETE")),

  // ---- cases (docs/api-cases.md) ----
  listCases: (projectId: string, query: CaseListQuery = {}) =>
    client.apiFetchPage<CaseListItem>(
      `/projects/${encodeURIComponent(projectId)}/cases`,
      {
        query: {
          suite_id: query.suite_id,
          include_descendants: query.include_descendants,
          query: query.query,
          priority: query.priority?.length ? query.priority : undefined,
          type: query.type?.length ? query.type : undefined,
          tag: query.tag?.length ? query.tag : undefined,
          sort: query.sort,
          page: query.page,
          limit: query.limit,
        },
      }
    ),

  createCase: (projectId: string, input: CreateCaseInput) =>
    client.apiFetch<CaseDetail>(
      `/projects/${encodeURIComponent(projectId)}/cases`,
      opts("POST", input)
    ),

  getCase: (id: string) =>
    client.apiFetch<CaseDetail>(`/cases/${encodeURIComponent(id)}`),

  updateCase: (id: string, input: UpdateCaseInput) =>
    client.apiFetch<CaseDetail>(
      `/cases/${encodeURIComponent(id)}`,
      opts("PATCH", input)
    ),

  deleteCase: (id: string) =>
    client.apiFetch<void>(`/cases/${encodeURIComponent(id)}`, opts("DELETE")),

  bulkMoveCases: (projectId: string, input: BulkMoveCasesInput) =>
    client.apiFetch<BulkMoveCasesResult>(
      `/projects/${encodeURIComponent(projectId)}/cases/bulk-move`,
      opts("POST", input)
    ),

  listCaseHistory: (id: string, query: CaseHistoryQuery = {}) =>
    client.apiFetchPage<CaseHistoryEntry>(
      `/cases/${encodeURIComponent(id)}/history`,
      { query: { page: query.page, limit: query.limit } }
    ),

  // ---- plans (docs/api-plans.md) ----
  listPlans: (projectId: string, query: PlanListQuery = {}) =>
    client.apiFetchPage<Plan>(
      `/projects/${encodeURIComponent(projectId)}/plans`,
      {
        query: {
          query: query.query,
          sort: query.sort,
          page: query.page,
          limit: query.limit,
        },
      }
    ),

  getPlan: (id: string) =>
    client.apiFetch<Plan>(`/plans/${encodeURIComponent(id)}`),

  createPlan: (projectId: string, input: CreatePlanInput) =>
    client.apiFetch<Plan>(
      `/projects/${encodeURIComponent(projectId)}/plans`,
      opts("POST", input)
    ),

  updatePlan: (id: string, input: UpdatePlanInput) =>
    client.apiFetch<Plan>(`/plans/${encodeURIComponent(id)}`, opts("PATCH", input)),

  deletePlan: (id: string) =>
    client.apiFetch<void>(`/plans/${encodeURIComponent(id)}`, opts("DELETE")),

  // ---- milestones (docs/api-milestones.md) ----
  listMilestones: (projectId: string, query: MilestoneListQuery = {}) =>
    client.apiFetchPage<Milestone>(
      `/projects/${encodeURIComponent(projectId)}/milestones`,
      {
        query: {
          query: query.query,
          status: query.status,
          sort: query.sort,
          page: query.page,
          limit: query.limit,
        },
      }
    ),

  getMilestone: (id: string) =>
    client.apiFetch<Milestone>(`/milestones/${encodeURIComponent(id)}`),

  createMilestone: (projectId: string, input: CreateMilestoneInput) =>
    client.apiFetch<Milestone>(
      `/projects/${encodeURIComponent(projectId)}/milestones`,
      opts("POST", input)
    ),

  updateMilestone: (id: string, input: UpdateMilestoneInput) =>
    client.apiFetch<Milestone>(
      `/milestones/${encodeURIComponent(id)}`,
      opts("PATCH", input)
    ),

  deleteMilestone: (id: string) =>
    client.apiFetch<void>(`/milestones/${encodeURIComponent(id)}`, opts("DELETE")),

  /** Attaches runs that have no milestone yet; never moves one. */
  attachMilestoneRuns: (id: string, input: AttachMilestoneRunsInput) =>
    client.apiFetch<AttachMilestoneRunsResult>(
      `/milestones/${encodeURIComponent(id)}/runs`,
      opts("POST", input)
    ),

  /** Detaches one run; the run itself is untouched. */
  detachMilestoneRun: (id: string, runId: string) =>
    client.apiFetch<void>(
      `/milestones/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`,
      opts("DELETE")
    ),

  // ---- runs (docs/api-runs.md) ----
  listRuns: (projectId: string, query: RunListQuery = {}) =>
    client.apiFetchPage<Run>(
      `/projects/${encodeURIComponent(projectId)}/runs`,
      {
        query: {
          plan_id: query.plan_id,
          milestone_id: query.milestone_id,
          status: query.status,
          query: query.query,
          sort: query.sort,
          page: query.page,
          limit: query.limit,
        },
      }
    ),

  createRun: (projectId: string, input: CreateRunInput) =>
    client.apiFetch<Run>(
      `/projects/${encodeURIComponent(projectId)}/runs`,
      opts("POST", input)
    ),

  getRun: (id: string) => client.apiFetch<Run>(`/runs/${encodeURIComponent(id)}`),

  updateRun: (id: string, input: UpdateRunInput) =>
    client.apiFetch<Run>(`/runs/${encodeURIComponent(id)}`, opts("PATCH", input)),

  closeRun: (id: string) =>
    client.apiFetch<Run>(`/runs/${encodeURIComponent(id)}/close`, opts("POST")),

  reopenRun: (id: string) =>
    client.apiFetch<Run>(`/runs/${encodeURIComponent(id)}/reopen`, opts("POST")),

  deleteRun: (id: string) =>
    client.apiFetch<void>(`/runs/${encodeURIComponent(id)}`, opts("DELETE")),

  // ---- run items (docs/api-runs.md) ----
  listRunItems: (runId: string, query: RunItemListQuery = {}) =>
    client.apiFetchPage<RunItem>(
      `/runs/${encodeURIComponent(runId)}/items`,
      {
        query: {
          status: query.status?.length ? query.status : undefined,
          assignee_id: query.assignee_id,
          suite_id: query.suite_id,
          query: query.query,
          sort: query.sort,
          page: query.page,
          limit: query.limit,
        },
      }
    ),

  /** The result drawer's data: the item plus its snapshotted case steps. */
  getRunItem: (runId: string, itemId: string) =>
    client.apiFetch<RunItemDetail>(
      `/runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}`
    ),

  /** Admin/Lead; a case already in the run is skipped, not an error. */
  addRunItems: (runId: string, input: AddRunItemsInput) =>
    client.apiFetch<AddRunItemsResult>(
      `/runs/${encodeURIComponent(runId)}/items`,
      opts("POST", input)
    ),

  updateRunItem: (runId: string, itemId: string, input: UpdateRunItemInput) =>
    client.apiFetch<RunItem>(
      `/runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}`,
      opts("PATCH", input)
    ),

  /** Omitting `item_ids` assigns every item in the run. */
  assignRunItems: (runId: string, input: AssignRunItemsInput) =>
    client.apiFetch<{ assigned: number }>(
      `/runs/${encodeURIComponent(runId)}/assign`,
      opts("POST", input)
    ),

  deleteRunItem: (runId: string, itemId: string) =>
    client.apiFetch<void>(
      `/runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}`,
      opts("DELETE")
    ),

  // ---- results & attachments (docs/api-runs.md) ----
  createResult: (runId: string, itemId: string, input: CreateResultInput) =>
    client.apiFetch<Result>(
      `/runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/results`,
      opts("POST", input)
    ),

  listItemResults: (runId: string, itemId: string, query: ResultListQuery = {}) =>
    client.apiFetchPage<Result>(
      `/runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/results`,
      { query: { page: query.page, limit: query.limit } }
    ),

  updateResult: (resultId: string, input: UpdateResultInput) =>
    client.apiFetch<Result>(
      `/results/${encodeURIComponent(resultId)}`,
      opts("PATCH", input)
    ),

  /** One file per request, field name `file` (DESIGN §4.4). */
  uploadResultAttachment: (resultId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return client.apiFetch<ResultAttachment>(
      `/results/${encodeURIComponent(resultId)}/attachments`,
      { method: "POST", formData }
    );
  },

  deleteAttachment: (id: string) =>
    client.apiFetch<void>(
      `/attachments/${encodeURIComponent(id)}`,
      opts("DELETE")
    ),

  /** Bytes for GET /attachments/:id — always sent with the access token. */
  fetchAttachmentBlob: (id: string) =>
    client.apiFetchBlob(`/attachments/${encodeURIComponent(id)}`),

  // ---- linked runs (docs/api-runs.md § Linked runs; card 3.4) ----
  listCaseRuns: (caseId: string, query: LinkedRunQuery = {}) =>
    client.apiFetchPage<LinkedRun>(
      `/cases/${encodeURIComponent(caseId)}/runs`,
      { query: { page: query.page, limit: query.limit } }
    ),
};
