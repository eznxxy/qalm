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
