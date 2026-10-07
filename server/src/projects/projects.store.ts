import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../errors';
import { DbService } from '../db/db.service';
import { PROJECT_STATUS_ACTIVE } from './projects.constants';

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
   * Shared WHERE builder for the listing: non-Admins see only 'active'
   * (`visibleStatuses`), Admins both; an explicit status filter narrows
   * further; `query` is a substring match on name (ILIKE, wildcards escaped).
   */
  private buildWhere(
    visibleStatuses: Array<'active' | 'archived'>,
    statusFilter: 'active' | 'archived' | null,
    query: string | null,
  ): { clause: string; values: unknown[] } {
    const where: string[] = [];
    const values: unknown[] = [];
    if (visibleStatuses.length < 2) {
      values.push(visibleStatuses[0] ?? PROJECT_STATUS_ACTIVE);
      where.push(`status = $${values.length}`);
    }
    if (statusFilter !== null) {
      values.push(statusFilter);
      where.push(`status = $${values.length}`);
    }
    if (query !== null) {
      values.push(`%${escapeLike(query)}%`);
      where.push(`name ILIKE $${values.length}`);
    }
    return {
      clause: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
      values,
    };
  }

  /**
   * Total row count of the exact filtered view the listing will render, so
   * pagination meta (page/limit/total/total_pages) is consistent with `data`
   * — including the Admin-only `status=archived` filter.
   */
  async countForList(params: {
    visibleStatuses: Array<'active' | 'archived'>;
    statusFilter: 'active' | 'archived' | null;
    query: string | null;
  }): Promise<number> {
    const { clause, values } = this.buildWhere(
      params.visibleStatuses,
      params.statusFilter,
      params.query,
    );
    const result = await this.db.query<{ count: string }>(
      `SELECT count(*) AS count FROM projects ${clause}`,
      values,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  /**
   * One page of the listing, contract-sorted by name ascending. For non-Admins
   * (`visibleStatuses = ['active']`) archived rows are filtered server-side;
   * Admins without a status filter see both statuses.
   */
  async listPage(params: {
    visibleStatuses: Array<'active' | 'archived'>;
    statusFilter: 'active' | 'archived' | null;
    query: string | null;
    limit: number;
    offset: number;
  }): Promise<ProjectRow[]> {
    const { clause, values } = this.buildWhere(
      params.visibleStatuses,
      params.statusFilter,
      params.query,
    );
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

  async update(
    id: string,
    fields: { name?: string; key?: string; description?: string },
  ): Promise<ProjectRow | null> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    if (fields.name !== undefined) {
      values.push(fields.name);
      assignments.push(`name = $${values.length}`);
    }
    if (fields.key !== undefined) {
      values.push(fields.key);
      assignments.push(`key = $${values.length}`);
    }
    if (fields.description !== undefined) {
      values.push(fields.description);
      assignments.push(`description = $${values.length}`);
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

/** detail is 'Key (name)=(...) already exists.' — extract the index column. */
function uniqueFieldOf(error: Error & PgErrorShape): 'name' | 'key' {
  const match = /\(([^)]+)\)/.exec(error.detail ?? '');
  return match?.[1] === 'key' ? 'key' : 'name';
}
