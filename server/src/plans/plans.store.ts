import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../errors';
import { DbService } from '../db/db.service';
import { Queryable } from '../db/queryable';
import { LATEST_RESULT_JOIN } from '../runs/runs.store';
import { PlanSortKey } from './plans.constants';

/**
 * DB row shape of `plans` (migration 20261026000001). `due_date` is selected as
 * text so the API sees a plain `YYYY-MM-DD` string, never a timezone-shifted
 * Date.
 */
export interface PlanRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  due_date: string | null;
  created_by: string;
  updated_by: string;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * A plan plus its rollup: `run_count` and the per-status counts over all items
 * in all of the plan's live runs (completed runs included). Every counter is a
 * `count(*)::int`, so it arrives from pg as a number.
 */
export interface PlanAggRow extends PlanRow {
  run_count: number;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  retest: number;
  skipped: number;
  untested: number;
}

export interface PlanProjectRef {
  id: string;
  status: 'active' | 'archived';
}

export interface PlanListFilter {
  projectId: string;
  query: string | null;
}

export interface PlanUpdateFields {
  name?: string;
  description?: string | null;
  due_date?: string | null;
  updated_by: string;
}

const PLAN_FIELDS = [
  'id',
  'project_id',
  'name',
  'description',
  'due_date',
  'created_by',
  'updated_by',
  'deleted_at',
  'created_at',
  'updated_at',
] as const;

/** `due_date` is always cast to text so the API sees `YYYY-MM-DD`. */
export function planColumns(alias = ''): string {
  const prefix = alias === '' ? '' : `${alias}.`;
  return PLAN_FIELDS.map((field) =>
    field === 'due_date' ? `${prefix}due_date::text AS due_date` : `${prefix}${field}`,
  ).join(', ');
}

/** Escapes LIKE/ILIKE wildcards in user-supplied substring input. */
function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Postgres SQLSTATE for unique_index / unique_constraint violations. */
const UNIQUE_VIOLATION = '23505';

interface PgErrorShape {
  code?: string;
  detail?: string;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && (error as PgErrorShape).code === UNIQUE_VIOLATION;
}

/** 409 for a duplicate plan name in the project; details name the field. */
function nameConflict(): ApiError {
  return new ApiError('CONFLICT', 'A plan with this name already exists.', [
    { field: 'name', issue: 'already in use' },
  ]);
}

const PLAN_SORT_COLUMNS: Record<PlanSortKey, string> = {
  created_at: 'p.created_at',
  updated_at: 'p.updated_at',
  name: 'lower(p.name)',
  due_date: 'p.due_date',
};

/**
 * SQL layer for plans. Business rules (archived project, non-empty patch,
 * detach-on-delete) live in PlansService; this class owns statements, filters,
 * ordering and the grouped rollup.
 */
@Injectable()
export class PlansStore {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async transaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    return this.db.transaction((client) => fn(client));
  }

  async findProject(projectId: string, q: Queryable = this.db): Promise<PlanProjectRef | null> {
    const result = await q.query<PlanProjectRef>('SELECT id, status FROM projects WHERE id = $1', [
      projectId,
    ]);
    return result.rows[0] ?? null;
  }

  async findLiveById(id: string, q: Queryable = this.db): Promise<PlanRow | null> {
    const result = await q.query<PlanRow>(
      `SELECT ${planColumns('p')} FROM plans p WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findLiveByIdForUpdate(id: string, client: Queryable): Promise<PlanRow | null> {
    const result = await client.query<PlanRow>(
      `SELECT ${planColumns('p')} FROM plans p WHERE p.id = $1 AND p.deleted_at IS NULL FOR UPDATE`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  /** One plan with its `run_count` and counts (detail + post-write responses). */
  async findWithCounts(id: string, q: Queryable = this.db): Promise<PlanAggRow | null> {
    const result = await q.query<PlanAggRow>(
      `${this.planSelect()} WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  /** A live plan id in the project with this name, ignoring case (dup check). */
  async findIdByNameIgnoreCase(
    projectId: string,
    name: string,
    excludeId: string | null,
    q: Queryable = this.db,
  ): Promise<string | null> {
    const values: unknown[] = [projectId, name];
    let clause = 'project_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL';
    if (excludeId !== null) {
      values.push(excludeId);
      clause += ` AND id <> $${values.length}`;
    }
    const result = await q.query<{ id: string }>(
      `SELECT id FROM plans WHERE ${clause}`,
      values,
    );
    return result.rows[0]?.id ?? null;
  }

  async insert(
    row: {
      project_id: string;
      name: string;
      description: string | null;
      due_date: string | null;
      created_by: string;
    },
    q: Queryable = this.db,
  ): Promise<PlanRow> {
    try {
      const result = await q.query<PlanRow>(
        `INSERT INTO plans (project_id, name, description, due_date, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING ${planColumns()}`,
        [row.project_id, row.name, row.description, row.due_date, row.created_by],
      );
      const created = result.rows[0];
      if (!created) throw new ApiError('INTERNAL', 'Plan creation failed.');
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) throw nameConflict();
      throw error;
    }
  }

  async update(
    id: string,
    fields: PlanUpdateFields,
    q: Queryable = this.db,
  ): Promise<PlanRow | null> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    const assign = (column: string, value: unknown): void => {
      values.push(value);
      assignments.push(`${column} = $${values.length + 1}`);
    };
    if (fields.name !== undefined) assign('name', fields.name);
    if (fields.description !== undefined) assign('description', fields.description);
    if (fields.due_date !== undefined) assign('due_date', fields.due_date);
    assign('updated_by', fields.updated_by);

    try {
      const result = await q.query<PlanRow>(
        `UPDATE plans SET ${assignments.join(', ')}, updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING ${planColumns()}`,
        [id, ...values],
      );
      return result.rows[0] ?? null;
    } catch (error) {
      if (isUniqueViolation(error)) throw nameConflict();
      throw error;
    }
  }

  /** Soft delete: the row leaves every list and rollup; its name is freed. */
  async softDelete(id: string, actorId: string, q: Queryable = this.db): Promise<PlanRow | null> {
    const result = await q.query<PlanRow>(
      `UPDATE plans SET deleted_at = now(), updated_by = $2, updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING ${planColumns()}`,
      [id, actorId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Detaches every run of a plan (`plan_id = null`) — PRD decision 7: deleting
   * a plan never deletes its runs. Runs of the plan already soft-deleted are
   * detached too, so a restore never resurrects a dangling reference.
   */
  async detachRuns(planId: string, q: Queryable = this.db): Promise<number> {
    const result = await q.query('UPDATE runs SET plan_id = null WHERE plan_id = $1', [planId]);
    return result.rowCount ?? 0;
  }

  private buildWhere(filter: PlanListFilter): { clause: string; values: unknown[] } {
    const values: unknown[] = [filter.projectId];
    const where: string[] = ['p.project_id = $1', 'p.deleted_at IS NULL'];
    if (filter.query !== null) {
      values.push(`%${escapeLike(filter.query)}%`);
      where.push(`p.name ILIKE $${values.length}`);
    }
    return { clause: `WHERE ${where.join(' AND ')}`, values };
  }

  async countForList(filter: PlanListFilter): Promise<number> {
    const { clause, values } = this.buildWhere(filter);
    const result = await this.db.query<{ count: string }>(
      `SELECT count(*) AS count FROM plans p ${clause}`,
      values,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async listPage(
    filter: PlanListFilter & { sort: string; limit: number; offset: number },
  ): Promise<PlanAggRow[]> {
    const { clause, values } = this.buildWhere(filter);
    const descending = filter.sort.startsWith('-');
    const key = (descending ? filter.sort.slice(1) : filter.sort) as PlanSortKey;
    const column = PLAN_SORT_COLUMNS[key] ?? PLAN_SORT_COLUMNS.created_at;
    const direction = descending ? 'DESC' : 'ASC';
    // Null due dates always sort last, whichever direction was asked for.
    const nulls = key === 'due_date' ? 'NULLS LAST' : '';
    const result = await this.db.query<PlanAggRow>(
      `${this.planSelect()}
       ${clause}
       ORDER BY ${column} ${direction} ${nulls}, p.id ASC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, filter.limit, filter.offset],
    );
    return result.rows;
  }

  /**
   * The plan list/detail select: one row per plan with `run_count` and the
   * status rollup aggregated in SQL (one grouped query per page, never a query
   * per row). The rollup walks the plan's live runs → items → newest result, so
   * a completed run still counts and a soft-deleted run counts nowhere.
   */
  private planSelect(): string {
    return `SELECT ${planColumns('p')},
        COALESCE(rc.run_count, 0)::int AS run_count,
        COALESCE(agg.total, 0)::int AS total,
        COALESCE(agg.passed, 0)::int AS passed,
        COALESCE(agg.failed, 0)::int AS failed,
        COALESCE(agg.blocked, 0)::int AS blocked,
        COALESCE(agg.retest, 0)::int AS retest,
        COALESCE(agg.skipped, 0)::int AS skipped,
        COALESCE(agg.untested, 0)::int AS untested
      FROM plans p
      LEFT JOIN (
        SELECT r.plan_id, count(*) AS run_count
          FROM runs r
         WHERE r.deleted_at IS NULL AND r.plan_id IS NOT NULL
         GROUP BY r.plan_id
      ) rc ON rc.plan_id = p.id
      LEFT JOIN (
        SELECT r.plan_id,
               count(*) AS total,
               count(*) FILTER (WHERE lr.status = 'passed') AS passed,
               count(*) FILTER (WHERE lr.status = 'failed') AS failed,
               count(*) FILTER (WHERE lr.status = 'blocked') AS blocked,
               count(*) FILTER (WHERE lr.status = 'retest') AS retest,
               count(*) FILTER (WHERE lr.status = 'skipped') AS skipped,
               count(*) FILTER (WHERE lr.status IS NULL) AS untested
          FROM runs r
          JOIN run_items i ON i.run_id = r.id
          ${LATEST_RESULT_JOIN}
         WHERE r.deleted_at IS NULL AND r.plan_id IS NOT NULL
         GROUP BY r.plan_id
      ) agg ON agg.plan_id = p.id`;
  }
}