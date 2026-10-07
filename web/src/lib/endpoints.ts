import { createApiClient, ApiClient, RequestOptions } from "./api-client";
import {
  AuthSession,
  BootstrapInput,
  CreateUserInput,
  LoginInput,
  PatchMeInput,
  RefreshResult,
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
};
