import { createApiClient, ApiClient, RequestOptions } from "./api-client";
import {
  AuthSession,
  BootstrapInput,
  BulkMoveCasesInput,
  BulkMoveCasesResult,
  CaseDetail,
  CaseHistoryEntry,
  CaseHistoryQuery,
  CaseListQuery,
  CaseListItem,
  CreateProjectInput,
  CreateSuiteInput,
  CreateUserInput,
  CreateCaseInput,
  LoginInput,
  PatchMeInput,
  Project,
  ProjectListQuery,
  RefreshResult,
  ReorderSuitesInput,
  SuiteDetail,
  SuiteNode,
  UpdateCaseInput,
  UpdateProjectInput,
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
};
