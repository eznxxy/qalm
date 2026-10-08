import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../errors';
import { DbService } from '../db/db.service';

/**
 * DB row shape of `projects` (migration 20261008000002). snake_case columns;
 * the DTO is the snake_case API projection.
 */
export interface ProjectRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived';
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export const PROJECT_COLUMNS =
  'id, key, name, description, status, created_by, created_at, updated_at';

/** Postgres SQLSTATE for unique_index / unique_constraint violations. */
const UNIQUE_VIOLATION = '23505';

interface PgErrorShape {
  code?: string;
  detail?: string;
  constraint?: string;
}

function isUniqueViolation(error: unknown): error is (Error & PgErrorShape) {
  return (
    error instanceof Error &&
    (error as PgErrorShape).code === UNIQUE_VIOLATION &&
    typeof (error as PgErrorShape).detail === 'string'
  );
}

/** Escapes LIKE/ILIKE wildcards in user-supplied substring input. */
export function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Shared 409 CONFLICT body; details name the duplicated field. */
export function conflictFor(field: 'name' | 'key'): ApiError {
  return new ApiError('CONFLICT', `A project with this ${field} already exists.`, [
    { field, issue: 'already in use' },
  ]);
}

/**
 * SQL layer for projects. The DB enforces case-insensitive uniqueness via
 * unique indexes on lower(name) / lower(key) (migration 2); unique violations
 * surface as ApiError('CONFLICT') with details naming the field, so the
 * concurrent-write race yields the same 409 body as the pre-check.
 */
@Injectable()
export class ProjectsStore {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async findById(id: string): Promise<ProjectRow | null> {
    const result = await this.db.query<ProjectRow>(
      `SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findIdByNameIgnoreCase(name: string): Promise<string | null> {
    const result = await this.db.query<{ id: string }>(
      'SELECT id FROM projects WHERE lower(name) = lower($1)',
      [name],
    );
    return result.rows[0]?.id ?? null;
  }

  async findIdByKeyIgnoreCase(key: string): Promise<string | null> {
    const result = await this.db.query<{ id: string }>(
      'SELECT id FROM projects WHERE lower(key) = lower($1)',
      [key],
    );
    return result.rows[0]?.id ?? null;
  }

  /**
   * Shared WHERE builder for the listing. The default view is active-only for
   * EVERYONE (contract: archived projects are excluded from the default
   * listing for everyone; Admins reach archived rows only via the explicit
   * status=archived filter, which the service 403-gates to Admin).
   * `query` is a substring match on name (ILIKE, wildcards escaped).
   */
  private buildWhere(
    statusFilter: 'active' | 'archived' | null,
    query: string | null,
  ): { clause: string; values: unknown[] } {
    const values: unknown[] = [statusFilter === 'archived' ? 'archived' : 'active'];
    const where: string[] = ['status = $1'];
    if (query !== null) {
      values.push(`%${escapeLike(query)}%`);
      where.push(`name ILIKE $${values.length}`);
    }
    return { clause: `WHERE ${where.join(' AND ')}`, values };
  }

  /**
   * Total row count of the exact filtered view the listing will render, so
   * pagination meta (page/limit/total/total_pages) is consistent with `data`
   * — including the Admin-only `status=archived` filter.
   */
  async countForList(params: {
    statusFilter: 'active' | 'archived' | null;
    query: string | null;
  }): Promise<number> {
    const { clause, values } = this.buildWhere(params.statusFilter, params.query);
    const result = await this.db.query<{ count: string }>(
      `SELECT count(*) AS count FROM projects ${clause}`,
      values,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  /**
   * One page of the listing, contract-sorted by name ascending.
   */
  async listPage(params: {
    statusFilter: 'active' | 'archived' | null;
    query: string | null;
    limit: number;
    offset: number;
  }): Promise<ProjectRow[]> {
    const { clause, values } = this.buildWhere(params.statusFilter, params.query);
    const result = await this.db.query<ProjectRow>(
      `SELECT ${PROJECT_COLUMNS} FROM projects ${clause}
       ORDER BY name ASC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, params.limit, params.offset],
    );
    return result.rows;
  }

  async insert(
    row: Pick<ProjectRow, 'key' | 'name' | 'description' | 'created_by'>,
  ): Promise<ProjectRow> {
    try {
      const result = await this.db.query<ProjectRow>(
        `INSERT INTO projects (key, name, description, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING ${PROJECT_COLUMNS}`,
        [row.key, row.name, row.description, row.created_by],
      );
      const created = result.rows[0];
      if (!created) {
        throw new ApiError('INTERNAL', 'Project creation failed.');
      }
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflictFor(uniqueFieldOf(error));
      }
      throw error;
    }
  }

  /**
   * Sets exactly the provided fields. Placeholders start at $2: $1 is the
   * WHERE id (parameters are appended in field order below). An explicit
   * null description clears the column (nullable by migration design); name
   * and key are never null here (DTO gate + service guard reject them).
   * An empty field set is a 400 — without this the emitted
   * `SET , updated_at` is a PG 42601 syntax error surfacing as a 500.
   */
  async update(
    id: string,
    fields: { name?: string; key?: string; description?: string | null },
  ): Promise<ProjectRow | null> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    if (fields.name !== undefined) {
      values.push(fields.name);
      assignments.push(`name = $${values.length + 1}`);
    }
    if (fields.key !== undefined) {
      values.push(fields.key);
      assignments.push(`key = $${values.length + 1}`);
    }
    if (fields.description !== undefined) {
      values.push(fields.description);
      assignments.push(`description = $${values.length + 1}`);
    }
    if (assignments.length === 0) {
      throw new ApiError('VALIDATION_ERROR', 'Provide at least one of name, key, or description.', [
        { field: 'name', issue: 'at least one field must be provided' },
        { field: 'key', issue: 'at least one field must be provided' },
        { field: 'description', issue: 'at least one field must be provided' },
      ]);
    }
    try {
      const result = await this.db.query<ProjectRow>(
        `UPDATE projects SET ${assignments.join(', ')}, updated_at = now()
         WHERE id = $1
         RETURNING ${PROJECT_COLUMNS}`,
        [id, ...values],
      );
      return result.rows[0] ?? null;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflictFor(uniqueFieldOf(error));
      }
      throw error;
    }
  }

  /**
   * Contract: "Sets status = archived". The UPDATE is status-agnostic, so
   * archiving an archived project is a no-op write — idempotent by
   * construction, 200 every time.
   */
  async archive(id: string): Promise<ProjectRow | null> {
    const result = await this.db.query<ProjectRow>(
      `UPDATE projects SET status = 'archived', updated_at = now()
       WHERE id = $1
       RETURNING ${PROJECT_COLUMNS}`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async restore(id: string): Promise<ProjectRow | null> {
    const result = await this.db.query<ProjectRow>(
      `UPDATE projects SET status = 'active', updated_at = now()
       WHERE id = $1
       RETURNING ${PROJECT_COLUMNS}`,
      [id],
    );
    return result.rows[0] ?? null;
  }
}

/**
 * detail is 'Key (lower(name))=(...) already exists.' (expression index) —
 * the reliable identifier is the constraint name in error.message.
 */
function uniqueFieldOf(error: Error & PgErrorShape): 'name' | 'key' {
  // node-pg fills `constraint` with the violated index name (migration 2):
  //   projects_name_lower_unique / projects_key_lower_unique. Use it first.
  const constraint = error.constraint ?? '';
  if (constraint.includes('key')) return 'key';
  if (constraint.includes('name')) return 'name';
  // Fallback: the constraint name also appears in the driver message.
  const message = error.message ?? '';
  if (message.includes('projects_key_lower_unique')) return 'key';
  if (message.includes('projects_name_lower_unique')) return 'name';
  // Last resort: parse the detail columns, tolerating both "Key (key)=..."
  // and the expression shape "Key (lower(key))=..." (lookarounds avoid
  // matching 'name' as a substring inside nothing surprising).
  const detail = error.detail ?? '';
  if (/\((?=.*\bkey\b)/.test(detail)) return 'key';
  return 'name';
}
