import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../errors';
import { DbService } from '../db/db.service';
import { UserRole } from '../auth/current-user';
import { escapeLike } from '../projects/projects.store';

/**
 * DB row shape of `users` (migration 20261008000001) for the admin listing.
 * password_hash is deliberately absent — it must never leave the store.
 */
export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  must_change_password: boolean;
  created_at: Date;
  updated_at: Date;
}

export const ADMIN_USER_COLUMNS =
  'id, email, name, role, is_active, must_change_password, created_at, updated_at';

/** Postgres SQLSTATE for unique_index / unique_constraint violations. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as { code?: string }).code === UNIQUE_VIOLATION
  );
}

/** Shared 409 CONFLICT body; details name the duplicated field. */
export function emailConflict(): ApiError {
  return new ApiError('CONFLICT', 'A user with this email already exists.', [
    { field: 'email', issue: 'already in use' },
  ]);
}

/** Shared 409 for the last-admin invariant (demote or deactivate). */
export function lastAdminConflict(action: 'demote' | 'deactivate'): ApiError {
  return new ApiError(
    'CONFLICT',
    `Cannot ${action} the last active admin. Promote another admin first.`,
  );
}

/**
 * SQL layer for the admin user-management endpoints (docs/api-auth.md
 * § Endpoints — user management). Email uniqueness is enforced by the DB
 * (unique index on email + case-insensitive lookups via lower(), the same
 * semantics migration 1 gives auth) so concurrent creates surface as the
 * same 409 body as the pre-check.
 */
@Injectable()
export class UsersStore {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async findById(id: string): Promise<AdminUserRow | null> {
    const result = await this.db.query<AdminUserRow>(
      `SELECT ${ADMIN_USER_COLUMNS} FROM users WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findIdByEmailIgnoreCase(email: string): Promise<string | null> {
    const result = await this.db.query<{ id: string }>(
      'SELECT id FROM users WHERE lower(email) = lower($1)',
      [email],
    );
    return result.rows[0]?.id ?? null;
  }

  /**
   * Count of ACTIVE admins, excluding one optional user (the PATCH target) —
   * the exact predicate of the last-admin invariant:
   * demoting/deactivating the target must leave >= 1 active admin.
   */
  async countActiveAdmins(excludeUserId?: string): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `SELECT count(*) AS count FROM users
       WHERE role = 'admin' AND is_active = true AND id <> $1::uuid`,
      [excludeUserId ?? '00000000-0000-0000-0000-000000000000'],
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  /**
   * Shared WHERE builder for the listing. `query` is a substring match on
   * email or name (ILIKE, wildcards escaped); `role` is the optional filter.
   */
  private buildWhere(
    query: string | null,
    role: UserRole | null,
  ): { clause: string; values: unknown[] } {
    const values: unknown[] = [];
    const where: string[] = [];
    if (query !== null) {
      values.push(`%${escapeLike(query)}%`);
      where.push(`(email ILIKE $${values.length} OR name ILIKE $${values.length})`);
    }
    if (role !== null) {
      values.push(role);
      where.push(`role = $${values.length}`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    return { clause, values };
  }

  /**
   * Total row count of the exact filtered view the listing renders, so the
   * pagination meta stays consistent with `data` (the projects-listing rule).
   */
  async countForList(params: {
    query: string | null;
    role: UserRole | null;
  }): Promise<number> {
    const { clause, values } = this.buildWhere(params.query, params.role);
    const result = await this.db.query<{ count: string }>(
      `SELECT count(*) AS count FROM users ${clause}`,
      values,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  /** One page of the listing, contract-sorted by email ascending. */
  async listPage(params: {
    query: string | null;
    role: UserRole | null;
    limit: number;
    offset: number;
  }): Promise<AdminUserRow[]> {
    const { clause, values } = this.buildWhere(params.query, params.role);
    const result = await this.db.query<AdminUserRow>(
      `SELECT ${ADMIN_USER_COLUMNS} FROM users ${clause}
       ORDER BY email ASC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, params.limit, params.offset],
    );
    return result.rows;
  }

  /**
   * Creates a user. Caller supplies the ALREADY-HASHED password and the
   * must_change_password flag (contract: true for Admin-created users).
   * A unique violation under a concurrent create maps to the shared 409.
   */
  async insert(params: {
    email: string;
    name: string;
    role: UserRole;
    passwordHash: string;
    mustChangePassword: boolean;
  }): Promise<AdminUserRow> {
    try {
      const result = await this.db.query<AdminUserRow>(
        `INSERT INTO users (email, name, role, password_hash, must_change_password)
         VALUES (lower($1), $2, $3, $4, $5)
         RETURNING ${ADMIN_USER_COLUMNS}`,
        [
          params.email,
          params.name,
          params.role,
          params.passwordHash,
          params.mustChangePassword,
        ],
      );
      const created = result.rows[0];
      if (!created) {
        throw new ApiError('INTERNAL', 'User creation failed.');
      }
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw emailConflict();
      }
      throw error;
    }
  }

  /**
   * Admin PATCH: sets exactly the provided fields in one UPDATE (one
   * updated_at bump per call). Empty fields means a no-op that still returns
   * the current row (PATCH with `{}` stays 200). Callers enforce the
   * last-admin invariant BEFORE calling with role/is_active changes.
   */
  async update(
    id: string,
    fields: {
      name?: string;
      role?: UserRole;
      is_active?: boolean;
      passwordHash?: string;
      mustChangePassword?: boolean;
    },
  ): Promise<AdminUserRow | null> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    if (fields.name !== undefined) {
      values.push(fields.name);
      assignments.push(`name = $${values.length + 1}`);
    }
    if (fields.role !== undefined) {
      values.push(fields.role);
      assignments.push(`role = $${values.length + 1}`);
    }
    if (fields.is_active !== undefined) {
      values.push(fields.is_active);
      assignments.push(`is_active = $${values.length + 1}`);
    }
    if (fields.passwordHash !== undefined) {
      values.push(fields.passwordHash);
      assignments.push(`password_hash = $${values.length + 1}`);
    }
    if (fields.mustChangePassword !== undefined) {
      values.push(fields.mustChangePassword);
      assignments.push(`must_change_password = $${values.length + 1}`);
    }
    const result = await this.db.query<AdminUserRow>(
      `UPDATE users SET ${assignments.join(', ')}, updated_at = now()
       WHERE id = $1
       RETURNING ${ADMIN_USER_COLUMNS}`,
      [id, ...values],
    );
    return result.rows[0] ?? null;
  }
}
