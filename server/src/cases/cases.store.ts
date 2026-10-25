import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../errors';
import { DbService } from '../db/db.service';
import { Queryable } from '../db/queryable';
import { CaseAction, CasePriority, CaseSortKey, CaseType } from './cases.constants';

/**
 * DB row shapes (migration 20261025000002). snake_case columns; the API
 * projections in cases.types.ts are snake_case too.
 */
export interface CaseRow {
  id: string;
  project_id: string;
  /** Null only for soft-deleted cases whose suite has since been deleted. */
  suite_id: string | null;
  case_number: number;
  title: string;
  preconditions: string | null;
  priority: CasePriority;
  type: CaseType;
  tags: string[];
  estimate_minutes: number | null;
  created_by: string;
  updated_by: string;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** List rows carry the step count instead of the step bodies. */
export interface CaseListRow extends CaseRow {
  step_count: number;
}

export interface CaseStepRow {
  position: number;
  text: string;
  expected_result: string | null;
}

export interface CaseHistoryRow {
  id: string;
  case_id: string;
  actor_id: string;
  action: CaseAction;
  changes: Record<string, unknown>;
  created_at: Date;
}

/** Minimal slices of `projects` / `suites` the case rules need. */
export interface CaseProjectRef {
  id: string;
  status: 'active' | 'archived';
}

export interface CaseSuiteRef {
  id: string;
  project_id: string;
}

export const CASE_COLUMNS =
  'id, project_id, suite_id, case_number, title, preconditions, priority, type, tags, estimate_minutes, created_by, updated_by, deleted_at, created_at, updated_at';

/** Same columns, qualified for queries that join/alias `cases c`. */
export const CASE_COLUMNS_ALIASED = CASE_COLUMNS.split(', ')
  .map((column) => `c.${column}`)
  .join(', ');

export const CASE_HISTORY_COLUMNS = 'id, case_id, actor_id, action, changes, created_at';

/** Escapes LIKE/ILIKE wildcards in user-supplied substring input. */
export function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export interface CaseListFilter {
  projectId: string;
  /** Resolved suite ids (`suite_id = any(...)`); null = every suite. */
  suiteIds: string[] | null;
  query: string | null;
  priorities: CasePriority[] | null;
  types: CaseType[] | null;
  tags: string[] | null;
}

export interface CaseUpdateFields {
  title?: string;
  preconditions?: string | null;
  priority?: CasePriority;
  type?: CaseType;
  tags?: string[];
  estimate_minutes?: number | null;
  suite_id?: string;
  updated_by: string;
}

export interface CaseWriteRow {
  project_id: string;
  suite_id: string;
  case_number: number;
  title: string;
  preconditions: string | null;
  priority: CasePriority;
  type: CaseType;
  tags: string[];
  estimate_minutes: number | null;
  created_by: string;
  updated_by: string;
}

export interface CaseHistoryWrite {
  case_id: string;
  actor_id: string;
  action: CaseAction;
  changes: Record<string, unknown>;
}

const SORT_COLUMNS: Record<CaseSortKey, string> = {
  case_number: 'c.case_number',
  updated_at: 'c.updated_at',
  title: 'lower(c.title)',
};

/**
 * SQL layer for cases. Business rules (numbering intent, history diffs) live
 * in CasesService; this class owns statements, filters and ordering.
 *
 * Deleted rows are never filtered out of `case_number` uniqueness (the index
 * spans deleted rows too) — soft-deleted cases keep their number reserved.
 */
@Injectable()
export class CasesStore {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** Runs a multi-statement operation on one connection. */
  async transaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    return this.db.transaction((client) => fn(client));
  }

  async findProject(projectId: string, q: Queryable = this.db): Promise<CaseProjectRef | null> {
    const result = await q.query<CaseProjectRef>(
      'SELECT id, status FROM projects WHERE id = $1',
      [projectId],
    );
    return result.rows[0] ?? null;
  }

  async findSuiteById(suiteId: string, q: Queryable = this.db): Promise<CaseSuiteRef | null> {
    const result = await q.query<CaseSuiteRef>(
      'SELECT id, project_id FROM suites WHERE id = $1',
      [suiteId],
    );
    return result.rows[0] ?? null;
  }

  /** Ids of a suite and (optionally) every descendant, for the list filter. */
  async suiteIdsForFilter(
    projectId: string,
    suiteId: string,
    includeDescendants: boolean,
    q: Queryable = this.db,
  ): Promise<string[]> {
    if (!includeDescendants) return [suiteId];
    const result = await q.query<{ id: string }>(
      `WITH RECURSIVE sub AS (
         SELECT id FROM suites WHERE id = $1 AND project_id = $2
         UNION ALL
         SELECT s.id FROM suites s JOIN sub ON s.parent_id = sub.id
       )
       SELECT id FROM sub`,
      [suiteId, projectId],
    );
    return result.rows.map((row) => row.id);
  }

  /**
   * Allocates the next project-scoped case number. The counter row is created
   * on demand and updated with a single row-locking `update ... returning`;
   * `max(case_number) + 1` would reuse numbers after a delete and is banned by
   * the contract. Must run inside the create transaction.
   */
  async nextCaseNumber(projectId: string, q: Queryable = this.db): Promise<number> {
    await q.query(
      'INSERT INTO project_case_counters (project_id) VALUES ($1) ON CONFLICT (project_id) DO NOTHING',
      [projectId],
    );
    const result = await q.query<{ last_number: number }>(
      `UPDATE project_case_counters SET last_number = last_number + 1
       WHERE project_id = $1
       RETURNING last_number`,
      [projectId],
    );
    const lastNumber = result.rows[0]?.last_number;
    if (typeof lastNumber !== 'number') {
      throw new ApiError('INTERNAL', 'Case number allocation failed.');
    }
    return lastNumber;
  }

  async insertCase(row: CaseWriteRow, q: Queryable = this.db): Promise<CaseRow> {
    const result = await q.query<CaseRow>(
      `INSERT INTO cases
         (project_id, suite_id, case_number, title, preconditions, priority, type, tags,
          estimate_minutes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       RETURNING ${CASE_COLUMNS}`,
      [
        row.project_id,
        row.suite_id,
        row.case_number,
        row.title,
        row.preconditions,
        row.priority,
        row.type,
        row.tags,
        row.estimate_minutes,
        row.created_by,
      ],
    );
    const created = result.rows[0];
    if (!created) throw new ApiError('INTERNAL', 'Case creation failed.');
    return created;
  }

  /** Ordered steps of one case; the caller decides how to project them. */
  async stepsFor(caseId: string, q: Queryable = this.db): Promise<CaseStepRow[]> {
    const result = await q.query<CaseStepRow>(
      'SELECT position, text, expected_result FROM case_steps WHERE case_id = $1 ORDER BY position ASC',
      [caseId],
    );
    return result.rows;
  }

  /** Inserts steps at 1..n in the given order (position is never client input). */
  async insertSteps(
    caseId: string,
    steps: Array<{ text: string; expected_result: string | null }>,
    q: Queryable = this.db,
  ): Promise<void> {
    if (steps.length === 0) return;
    const values: unknown[] = [];
    const rows = steps.map((step, index) => {
      values.push(caseId, index + 1, step.text, step.expected_result);
      const base = values.length - 3;
      return `($${base}, $${base + 1}, $${base + 2}, $${base + 3})`;
    });
    await q.query(
      `INSERT INTO case_steps (case_id, position, text, expected_result)
       VALUES ${rows.join(', ')}`,
      values,
    );
  }

  /** PATCH replaces the whole step list; positions are re-derived from order. */
  async replaceSteps(
    caseId: string,
    steps: Array<{ text: string; expected_result: string | null }>,
    q: Queryable = this.db,
  ): Promise<void> {
    await q.query('DELETE FROM case_steps WHERE case_id = $1', [caseId]);
    await this.insertSteps(caseId, steps, q);
  }

  async findLiveById(id: string, q: Queryable = this.db): Promise<CaseRow | null> {
    const result = await q.query<CaseRow>(
      `SELECT ${CASE_COLUMNS} FROM cases WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  /** Locks a live case row so concurrent edits serialise. */
  async findLiveByIdForUpdate(id: string, client: Queryable): Promise<CaseRow | null> {
    const result = await client.query<CaseRow>(
      `SELECT ${CASE_COLUMNS} FROM cases WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  /** Bulk-move validation: only live cases of this project. */
  async findLiveByIds(
    projectId: string,
    ids: string[],
    q: Queryable = this.db,
  ): Promise<CaseRow[]> {
    if (ids.length === 0) return [];
    const result = await q.query<CaseRow>(
      `SELECT ${CASE_COLUMNS} FROM cases
       WHERE project_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
      [projectId, ids],
    );
    return result.rows;
  }

  /** Updates exactly the provided fields (updated_by/updated_at always move). */
  async updateFields(
    id: string,
    fields: CaseUpdateFields,
    q: Queryable = this.db,
  ): Promise<CaseRow | null> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    const assign = (column: string, value: unknown): void => {
      values.push(value);
      assignments.push(`${column} = $${values.length + 1}`);
    };
    if (fields.title !== undefined) assign('title', fields.title);
    if (fields.preconditions !== undefined) assign('preconditions', fields.preconditions);
    if (fields.priority !== undefined) assign('priority', fields.priority);
    if (fields.type !== undefined) assign('type', fields.type);
    if (fields.tags !== undefined) assign('tags', fields.tags);
    if (fields.estimate_minutes !== undefined) assign('estimate_minutes', fields.estimate_minutes);
    if (fields.suite_id !== undefined) assign('suite_id', fields.suite_id);
    assign('updated_by', fields.updated_by);

    const result = await q.query<CaseRow>(
      `UPDATE cases SET ${assignments.join(', ')}, updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING ${CASE_COLUMNS}`,
      [id, ...values],
    );
    return result.rows[0] ?? null;
  }

  /** Soft delete: the row, its number and its history survive. */
  async softDelete(id: string, actorId: string, q: Queryable = this.db): Promise<CaseRow | null> {
    const result = await q.query<CaseRow>(
      `UPDATE cases SET deleted_at = now(), updated_by = $2, updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING ${CASE_COLUMNS}`,
      [id, actorId],
    );
    return result.rows[0] ?? null;
  }

  /** Re-assigns the given cases to one suite; returns the number of rows moved. */
  async setSuiteForIds(
    ids: string[],
    suiteId: string,
    actorId: string,
    q: Queryable = this.db,
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await q.query(
      `UPDATE cases SET suite_id = $2, updated_by = $3, updated_at = now()
       WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [ids, suiteId, actorId],
    );
    return result.rowCount ?? 0;
  }

  /**
   * Shared WHERE for list + count. Soft-deleted rows are never listed; the
   * filters combine with AND, while repeated values inside one parameter are
   * OR (`= any`) except `tags`, which is AND (`@>` — the case must carry all).
   */
  private buildWhere(filter: CaseListFilter): { clause: string; values: unknown[] } {
    const values: unknown[] = [filter.projectId];
    const where: string[] = ['c.project_id = $1', 'c.deleted_at IS NULL'];
    const push = (value: unknown): string => {
      values.push(value);
      return `$${values.length}`;
    };
    if (filter.suiteIds !== null) {
      if (filter.suiteIds.length === 0) {
        where.push('false');
      } else {
        where.push(`c.suite_id = ANY(${push(filter.suiteIds)}::uuid[])`);
      }
    }
    if (filter.query !== null) {
      where.push(`c.title ILIKE ${push(`%${escapeLike(filter.query)}%`)}`);
    }
    if (filter.priorities !== null && filter.priorities.length > 0) {
      where.push(`c.priority = ANY(${push(filter.priorities)}::text[])`);
    }
    if (filter.types !== null && filter.types.length > 0) {
      where.push(`c.type = ANY(${push(filter.types)}::text[])`);
    }
    if (filter.tags !== null && filter.tags.length > 0) {
      where.push(`c.tags @> ${push(filter.tags)}::text[]`);
    }
    return { clause: `WHERE ${where.join(' AND ')}`, values };
  }

  async countForList(filter: CaseListFilter): Promise<number> {
    const { clause, values } = this.buildWhere(filter);
    const result = await this.db.query<{ count: string }>(
      `SELECT count(*) AS count FROM cases c ${clause}`,
      values,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async listPage(
    filter: CaseListFilter & { sort: string; limit: number; offset: number },
  ): Promise<CaseListRow[]> {
    const { clause, values } = this.buildWhere(filter);
    const descending = filter.sort.startsWith('-');
    const key = (descending ? filter.sort.slice(1) : filter.sort) as CaseSortKey;
    const column = SORT_COLUMNS[key] ?? SORT_COLUMNS.case_number;
    const direction = descending ? 'DESC' : 'ASC';
    const result = await this.db.query<CaseListRow>(
      `SELECT ${CASE_COLUMNS_ALIASED},
              (SELECT count(*)::int FROM case_steps s WHERE s.case_id = c.id) AS step_count
       FROM cases c
       ${clause}
       ORDER BY ${column} ${direction}, c.case_number ASC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, filter.limit, filter.offset],
    );
    return result.rows;
  }

  async insertHistory(entry: CaseHistoryWrite, q: Queryable = this.db): Promise<void> {
    await q.query(
      `INSERT INTO case_history (case_id, actor_id, action, changes)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [entry.case_id, entry.actor_id, entry.action, JSON.stringify(entry.changes)],
    );
  }

  async countHistory(caseId: string): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      'SELECT count(*) AS count FROM case_history WHERE case_id = $1',
      [caseId],
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  /** Newest first, `id` as the stable tiebreaker (docs/api-cases.md). */
  async listHistory(
    caseId: string,
    params: { limit: number; offset: number },
  ): Promise<CaseHistoryRow[]> {
    const result = await this.db.query<CaseHistoryRow>(
      `SELECT ${CASE_HISTORY_COLUMNS} FROM case_history
       WHERE case_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [caseId, params.limit, params.offset],
    );
    return result.rows;
  }
}
