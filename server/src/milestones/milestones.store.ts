import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../errors';
import { DbService } from '../db/db.service';
import { Queryable } from '../db/queryable';
import { LATEST_RESULT_JOIN, ProjectRef } from '../runs/runs.store';
import { MilestoneSortKey } from './milestones.constants';

/**
 * DB row shape of `milestones` (migration 20261027000003). `due_date` is
 * selected as text so the API sees a plain `YYYY-MM-DD` string, never a
 * timezone-shifted Date.
 */
export interface MilestoneRow {
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
 * A milestone plus its derived rollup: `run_count`, the per-status counts over
 * all items in all attached live runs (completed runs included), and the
 * derived `status`. Every counter is a `count(*)::int`, so it arrives from pg
 * as a number; `status` is computed by the same aggregate that feeds the list
 * filter, never stored.
 */
export interface MilestoneAggRow extends MilestoneRow {
  run_count: number;
  completed_run_count: number;
  status: 'open' | 'completed';
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  retest: number;
  skipped: number;
  untested: number;
}

export interface MilestoneListFilter {
  projectId: string;
  query: string | null;
  status: 'open' | 'completed' | null;
}

export interface MilestoneUpdateFields {
  name?: string;
  description?: string | null;
  due_date?: string | null;
  updated_by: string;
}

const MILESTONE_FIELDS = [
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
export function milestoneColumns(alias = ''): string {
  const prefix = alias === '' ? '' : `${alias}.`;
  return MILESTONE_FIELDS.map((field) =>
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
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && (error as PgErrorShape).code === UNIQUE_VIOLATION;
}

/** 409 for a duplicate milestone name in the project; details name the field. */
function nameConflict(): ApiError {
  return new ApiError('CONFLICT', 'A milestone with this name already exists.', [
    { field: 'name', issue: 'already in use' },
  ]);
}

const MILESTONE_SORT_COLUMNS: Record<MilestoneSortKey, string> = {
  created_at: 'm.created_at',
  updated_at: 'm.updated_at',
  name: 'lower(m.name)',
  due_date: 'm.due_date',
};

/**
 * Per-milestone run count and completed-run count. Status is derived from these
 * two numbers, so attaching an open run — or reopening one — flips a completed
 * milestone back to open with no write to `milestones`.
 */
const RUN_COUNT_JOIN = `LEFT JOIN (
  SELECT r.milestone_id,
         count(*) AS run_count,
         count(*) FILTER (WHERE r.completed_at IS NOT NULL) AS completed_run_count
    FROM runs r
   WHERE r.deleted_at IS NULL AND r.milestone_id IS NOT NULL
   GROUP BY r.milestone_id
) rc ON rc.milestone_id = m.id`;

/**
 * The contract's derived status, used both as a selected column and as the
 * list filter, so the two can never disagree.
 */
const MILESTONE_STATUS_EXPR = `CASE
  WHEN COALESCE(rc.run_count, 0) > 0
   AND COALESCE(rc.completed_run_count, 0) = COALESCE(rc.run_count, 0)
  THEN 'completed'
  ELSE 'open'
END`;

/**
 * SQL layer for milestones. Business rules (archived project, non-empty patch,
 * run eligibility, detach-on-delete) live in MilestonesService; this class owns
 * statements, filters, ordering and the grouped rollup.
 */
@Injectable()
export class MilestonesStore {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async transaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    return this.db.transaction((client) => fn(client));
  }

  async findProject(projectId: string, q: Queryable = this.db): Promise<ProjectRef | null> {
    const result = await q.query<ProjectRef>('SELECT id, status FROM projects WHERE id = $1', [
      projectId,
    ]);
    return result.rows[0] ?? null;
  }

  async findLiveById(id: string, q: Queryable = this.db): Promise<MilestoneRow | null> {
    const result = await q.query<MilestoneRow>(
      `SELECT ${milestoneColumns('m')} FROM milestones m WHERE m.id = $1 AND m.deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findLiveByIdForUpdate(
    id: string,
    client: Queryable,
  ): Promise<MilestoneRow | null> {
    const result = await client.query<MilestoneRow>(
      `SELECT ${milestoneColumns('m')} FROM milestones m
        WHERE m.id = $1 AND m.deleted_at IS NULL FOR UPDATE`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  /** One milestone with its rollup (detail + post-write responses). */
  async findWithCounts(
    id: string,
    q: Queryable = this.db,
  ): Promise<MilestoneAggRow | null> {
    const result = await q.query<MilestoneAggRow>(
      `${this.milestoneSelect()} WHERE m.id = $1 AND m.deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  /** A live milestone id in the project with this name, ignoring case (dup check). */
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
      `SELECT id FROM milestones WHERE ${clause}`,
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
  ): Promise<MilestoneRow> {
    try {
      const result = await q.query<MilestoneRow>(
        `INSERT INTO milestones (project_id, name, description, due_date, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING ${milestoneColumns()}`,
        [row.project_id, row.name, row.description, row.due_date, row.created_by],
      );
      const created = result.rows[0];
      if (!created) throw new ApiError('INTERNAL', 'Milestone creation failed.');
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) throw nameConflict();
      throw error;
    }
  }

  async update(
    id: string,
    fields: MilestoneUpdateFields,
    q: Queryable = this.db,
  ): Promise<MilestoneRow | null> {
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
      const result = await q.query<MilestoneRow>(
        `UPDATE milestones SET ${assignments.join(', ')}, updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING ${milestoneColumns()}`,
        [id, ...values],
      );
      return result.rows[0] ?? null;
    } catch (error) {
      if (isUniqueViolation(error)) throw nameConflict();
      throw error;
    }
  }

  /** Soft delete: the row leaves every list and rollup; its name is freed. */
  async softDelete(
    id: string,
    actorId: string,
    q: Queryable = this.db,
  ): Promise<MilestoneRow | null> {
    const result = await q.query<MilestoneRow>(
      `UPDATE milestones SET deleted_at = now(), updated_by = $2, updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING ${milestoneColumns()}`,
      [id, actorId],
    );
    return result.rows[0] ?? null;
  }

  private buildWhere(filter: MilestoneListFilter): { clause: string; values: unknown[] } {
    const values: unknown[] = [filter.projectId];
    const where: string[] = ['m.project_id = $1', 'm.deleted_at IS NULL'];
    if (filter.query !== null) {
      values.push(`%${escapeLike(filter.query)}%`);
      where.push(`m.name ILIKE $${values.length}`);
    }
    if (filter.status !== null) {
      values.push(filter.status);
      where.push(`(${MILESTONE_STATUS_EXPR}) = $${values.length}`);
    }
    return { clause: `WHERE ${where.join(' AND ')}`, values };
  }

  async countForList(filter: MilestoneListFilter): Promise<number> {
    const { clause, values } = this.buildWhere(filter);
    // Only the run-count join is needed here; the item rollup would be wasted.
    const result = await this.db.query<{ count: string }>(
      `SELECT count(*) AS count FROM milestones m ${RUN_COUNT_JOIN} ${clause}`,
      values,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async listPage(
    filter: MilestoneListFilter & { sort: string; limit: number; offset: number },
  ): Promise<MilestoneAggRow[]> {
    const { clause, values } = this.buildWhere(filter);
    const descending = filter.sort.startsWith('-');
    const key = (descending ? filter.sort.slice(1) : filter.sort) as MilestoneSortKey;
    const column = MILESTONE_SORT_COLUMNS[key] ?? MILESTONE_SORT_COLUMNS.due_date;
    const direction = descending ? 'DESC' : 'ASC';
    // Undated milestones always sort last, whichever direction was asked for.
    const nulls = key === 'due_date' ? 'NULLS LAST' : '';
    const result = await this.db.query<MilestoneAggRow>(
      `${this.milestoneSelect()}
       ${clause}
       ORDER BY ${column} ${direction} ${nulls}, m.id ASC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, filter.limit, filter.offset],
    );
    return result.rows;
  }

  /**
   * The milestone list/detail select: one row per milestone with `run_count`,
   * the derived `status` and the status rollup aggregated in SQL (one grouped
   * query per page, never a query per row). The rollup walks the attached live
   * runs → items → newest result, so a completed run still counts and a
   * soft-deleted run counts nowhere.
   */
  private milestoneSelect(): string {
    return `SELECT ${milestoneColumns('m')},
        COALESCE(rc.run_count, 0)::int AS run_count,
        COALESCE(rc.completed_run_count, 0)::int AS completed_run_count,
        (${MILESTONE_STATUS_EXPR}) AS status,
        COALESCE(agg.total, 0)::int AS total,
        COALESCE(agg.passed, 0)::int AS passed,
        COALESCE(agg.failed, 0)::int AS failed,
        COALESCE(agg.blocked, 0)::int AS blocked,
        COALESCE(agg.retest, 0)::int AS retest,
        COALESCE(agg.skipped, 0)::int AS skipped,
        COALESCE(agg.untested, 0)::int AS untested
      FROM milestones m
      ${RUN_COUNT_JOIN}
      LEFT JOIN (
        SELECT r.milestone_id,
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
         WHERE r.deleted_at IS NULL AND r.milestone_id IS NOT NULL
         GROUP BY r.milestone_id
      ) agg ON agg.milestone_id = m.id`;
  }
}