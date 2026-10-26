import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../errors';
import { DbService } from '../db/db.service';
import { Queryable } from '../db/queryable';
import { ItemStatus, ItemSortKey, ResultStatus, RunSortKey } from './runs.constants';
import { statusRankSql } from './run-counts';

/**
 * DB row shapes for runs (migration 20261026000001). `due_date` is selected as
 * text so it is a plain `YYYY-MM-DD` string, never a timezone-shifted Date.
 */
export interface RunRow {
  id: string;
  project_id: string;
  plan_id: string | null;
  name: string;
  description: string | null;
  due_date: string | null;
  completed_at: Date | null;
  completed_by: string | null;
  created_by: string;
  updated_by: string;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Flattened per-status rollup for one run (all `count(*)::int`). */
export interface RunAggRow {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  retest: number;
  skipped: number;
  untested: number;
  assignee_ids: string[] | null;
}

export type RunWithCountsRow = RunRow & RunAggRow;

export interface RunItemRow {
  id: string;
  run_id: string;
  case_id: string | null;
  case_display_id: string;
  case_title: string;
  case_priority: string;
  case_suite_id: string;
  assignee_id: string | null;
  position: number;
  created_at: Date;
  updated_at: Date;
  /** Derived: the latest result's status, or `untested`. */
  status: ItemStatus;
  result_count: number;
  latest_result_id: string | null;
  latest_result_status: ResultStatus | null;
  latest_result_comment: string | null;
  latest_result_elapsed_minutes: number | null;
  latest_result_defect_url: string | null;
  latest_result_attachment_count: number;
  latest_result_created_by: string | null;
  latest_result_created_at: Date | null;
}

/** Item detail additionally carries the snapshotted steps and live preconditions. */
export interface RunItemDetailRow extends RunItemRow {
  case_steps: unknown;
  case_preconditions: string | null;
}

/** The case snapshot written into a run item at selection time. */
export interface CaseSnapshotRow {
  id: string;
  case_number: number;
  title: string;
  priority: string;
  suite_id: string;
  steps: unknown;
}

export interface ProjectRef {
  id: string;
  status: 'active' | 'archived';
}

export interface PlanRef {
  id: string;
  project_id: string;
}

export interface UserRef {
  id: string;
  role: string;
  is_active: boolean;
}

export interface RunListFilter {
  projectId: string;
  /** `null` = any plan; the literal `'none'` = runs with no plan; else a plan id. */
  planId: string | null;
  status: 'open' | 'completed' | null;
  query: string | null;
}

export interface RunItemFilter {
  runId: string;
  /** OR within; `untested` matches items with no results. */
  statuses: ItemStatus[] | null;
  /** `null` = any; the literal `'none'` = unassigned; else one assignee id. */
  assigneeId: string | null;
  /** Resolved suite subtree ids; `null` = any suite. */
  suiteIds: string[] | null;
  query: string | null;
}

export interface RunUpdateFields {
  name?: string;
  description?: string | null;
  plan_id?: string | null;
  due_date?: string | null;
  updated_by: string;
}

export interface RunItemWrite {
  case_id: string;
  case_display_id: string;
  case_title: string;
  case_steps: unknown;
  case_priority: string;
  case_suite_id: string;
  position: number;
}

export interface RunItemUpdateFields {
  assignee_id?: string | null;
}

/** Escapes LIKE/ILIKE wildcards in user-supplied substring input. */
export function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

const RUN_FIELDS = [
  'id',
  'project_id',
  'plan_id',
  'name',
  'description',
  'due_date',
  'completed_at',
  'completed_by',
  'created_by',
  'updated_by',
  'deleted_at',
  'created_at',
  'updated_at',
] as const;

/** `due_date` is always cast to text so the API sees `YYYY-MM-DD`. */
export function runColumns(alias = ''): string {
  const prefix = alias === '' ? '' : `${alias}.`;
  return RUN_FIELDS.map((field) =>
    field === 'due_date' ? `${prefix}due_date::text AS due_date` : `${prefix}${field}`,
  ).join(', ');
}

const ITEM_FIELDS = [
  'id',
  'run_id',
  'case_id',
  'case_display_id',
  'case_title',
  'case_priority',
  'case_suite_id',
  'assignee_id',
  'position',
  'created_at',
  'updated_at',
] as const;

function itemColumns(alias: string, withSteps: boolean): string {
  const columns = ITEM_FIELDS.map((field) => `${alias}.${field}`);
  if (withSteps) columns.push(`${alias}.case_steps`);
  return columns.join(', ');
}

/**
 * The latest result of an item, plus its attachment count. Ordered by
 * `(created_at desc, id desc)` — the contract's tiebreaker — and never stored
 * on `run_items`, so appending a result can never desync a denormalised column.
 */
const LATEST_RESULT_JOIN = `
LEFT JOIN LATERAL (
  SELECT res.id, res.status, res.comment, res.elapsed_minutes, res.defect_url,
         res.created_by, res.created_at,
         (SELECT count(*)::int FROM result_attachments a WHERE a.result_id = res.id)
           AS attachment_count
  FROM results res
  WHERE res.run_item_id = i.id
  ORDER BY res.created_at DESC, res.id DESC
  LIMIT 1
) lr ON true`;

/** Derived status expression shared by the select list, filters and sort. */
const ITEM_STATUS_EXPR = "COALESCE(lr.status, 'untested')";

const ITEM_RESULT_COUNT = `(SELECT count(*)::int FROM results rc WHERE rc.run_item_id = i.id)`;

/** Select list for an item row, including the flattened latest result. */
function itemSelect(alias: string, withSteps: boolean): string {
  return `${itemColumns(alias, withSteps)},
    ${ITEM_STATUS_EXPR} AS status,
    ${ITEM_RESULT_COUNT} AS result_count,
    lr.id AS latest_result_id,
    lr.status AS latest_result_status,
    lr.comment AS latest_result_comment,
    lr.elapsed_minutes AS latest_result_elapsed_minutes,
    lr.defect_url AS latest_result_defect_url,
    COALESCE(lr.attachment_count, 0) AS latest_result_attachment_count,
    lr.created_by AS latest_result_created_by,
    lr.created_at AS latest_result_created_at`;
}

/**
 * `INSERT ... RETURNING` cannot reference the `lr` lateral join (it does not
 * exist in an INSERT statement), and a row that was just inserted cannot have
 * results yet — so the item shape is spelled out with the `untested`/zero
 * defaults instead of reusing `itemSelect`.
 */
const ITEM_INSERT_RETURNING = `${ITEM_FIELDS.join(', ')},
  'untested'::text AS status,
  0::int AS result_count,
  null::uuid AS latest_result_id,
  null::text AS latest_result_status,
  null::text AS latest_result_comment,
  null::int AS latest_result_elapsed_minutes,
  null::text AS latest_result_defect_url,
  0::int AS latest_result_attachment_count,
  null::uuid AS latest_result_created_by,
  null::timestamptz AS latest_result_created_at`;

const RUN_SORT_COLUMNS: Record<RunSortKey, string> = {
  created_at: 'r.created_at',
  updated_at: 'r.updated_at',
  due_date: 'r.due_date',
  name: 'lower(r.name)',
};

const ITEM_SORT_COLUMNS: Record<ItemSortKey, string> = {
  position: 'i.position',
  case_display_id: "CAST(substring(i.case_display_id, 2) AS integer)",
  status: statusRankSql(ITEM_STATUS_EXPR),
  updated_at: 'i.updated_at',
};

/**
 * SQL layer for runs, run items and case selection. Business rules (capacity,
 * close/reopen guards, Tester write guard, reordering) live in RunsService; this
 * class owns statements, filters and ordering.
 */
@Injectable()
export class RunsStore {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async transaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    return this.db.transaction((client) => fn(client));
  }

  // --- references ---------------------------------------------------------

  async findProject(projectId: string, q: Queryable = this.db): Promise<ProjectRef | null> {
    const result = await q.query<ProjectRef>('SELECT id, status FROM projects WHERE id = $1', [
      projectId,
    ]);
    return result.rows[0] ?? null;
  }

  async findPlan(planId: string, q: Queryable = this.db): Promise<PlanRef | null> {
    const result = await q.query<PlanRef>(
      'SELECT id, project_id FROM plans WHERE id = $1 AND deleted_at IS NULL',
      [planId],
    );
    return result.rows[0] ?? null;
  }

  /** Assignee eligibility (PRD decision 2): active admin/lead/tester. */
  async findAssignee(id: string, q: Queryable = this.db): Promise<UserRef | null> {
    const result = await q.query<UserRef>(
      'SELECT id, role, is_active FROM users WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  /** Ids of a suite and (optionally) every descendant, for the items filter. */
  async suiteSubtreeIds(
    projectId: string,
    suiteId: string,
    includeDescendants: boolean,
    q: Queryable = this.db,
  ): Promise<string[]> {
    // Even without descendants the suite must exist in the project, so an
    // unknown id yields `[]` (an empty filter) rather than being echoed back.
    if (!includeDescendants) {
      const result = await q.query<{ id: string }>(
        'SELECT id FROM suites WHERE id = $1 AND project_id = $2',
        [suiteId, projectId],
      );
      return result.rows.map((row) => row.id);
    }
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

  // --- runs ---------------------------------------------------------------

  async findLiveById(id: string, q: Queryable = this.db): Promise<RunRow | null> {
    const result = await q.query<RunRow>(
      `SELECT ${runColumns('r')} FROM runs r WHERE r.id = $1 AND r.deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findLiveByIdForUpdate(id: string, client: Queryable): Promise<RunRow | null> {
    const result = await client.query<RunRow>(
      `SELECT ${runColumns('r')} FROM runs r WHERE r.id = $1 AND r.deleted_at IS NULL FOR UPDATE`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  /** One run with its counts and assignees (detail + post-write responses). */
  async findWithCounts(id: string, q: Queryable = this.db): Promise<RunWithCountsRow | null> {
    const result = await q.query<RunWithCountsRow>(
      `${this.runSelect()} WHERE r.id = $1 AND r.deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async insertRun(
    row: {
      project_id: string;
      plan_id: string | null;
      name: string;
      description: string | null;
      due_date: string | null;
      created_by: string;
    },
    q: Queryable = this.db,
  ): Promise<RunRow> {
    const result = await q.query<RunRow>(
      `INSERT INTO runs (project_id, plan_id, name, description, due_date, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING ${runColumns()}`,
      [row.project_id, row.plan_id, row.name, row.description, row.due_date, row.created_by],
    );
    const created = result.rows[0];
    if (!created) throw new ApiError('INTERNAL', 'Run creation failed.');
    return created;
  }

  async updateRun(
    id: string,
    fields: RunUpdateFields,
    q: Queryable = this.db,
  ): Promise<RunRow | null> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    const assign = (column: string, value: unknown): void => {
      values.push(value);
      assignments.push(`${column} = $${values.length + 1}`);
    };
    if (fields.name !== undefined) assign('name', fields.name);
    if (fields.description !== undefined) assign('description', fields.description);
    if (fields.plan_id !== undefined) assign('plan_id', fields.plan_id);
    if (fields.due_date !== undefined) assign('due_date', fields.due_date);
    assign('updated_by', fields.updated_by);

    const result = await q.query<RunRow>(
      `UPDATE runs SET ${assignments.join(', ')}, updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING ${runColumns()}`,
      [id, ...values],
    );
    return result.rows[0] ?? null;
  }

  /** Close (completed=true) or reopen (false); touches only `runs`. */
  async setCompleted(
    id: string,
    completed: boolean,
    actorId: string,
    q: Queryable = this.db,
  ): Promise<RunRow | null> {
    const result = await q.query<RunRow>(
      completed
        ? `UPDATE runs SET completed_at = now(), completed_by = $2, updated_by = $2, updated_at = now()
           WHERE id = $1 AND deleted_at IS NULL RETURNING ${runColumns()}`
        : `UPDATE runs SET completed_at = null, completed_by = null, updated_by = $2, updated_at = now()
           WHERE id = $1 AND deleted_at IS NULL RETURNING ${runColumns()}`,
      [id, actorId],
    );
    return result.rows[0] ?? null;
  }

  async softDeleteRun(id: string, actorId: string, q: Queryable = this.db): Promise<RunRow | null> {
    const result = await q.query<RunRow>(
      `UPDATE runs SET deleted_at = now(), updated_by = $2, updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING ${runColumns()}`,
      [id, actorId],
    );
    return result.rows[0] ?? null;
  }

  /** Bumps a run's `updated_at` after an item/assign write (list "Updated"). */
  async touchRun(id: string, actorId: string, q: Queryable = this.db): Promise<void> {
    await q.query('UPDATE runs SET updated_by = $2, updated_at = now() WHERE id = $1', [
      id,
      actorId,
    ]);
  }

  /**
   * The runs list select: one row per run with its rollup aggregated in SQL
   * (never a query per row) plus the distinct item assignees.
   */
  private runSelect(): string {
    return `SELECT ${runColumns('r')},
        COALESCE(agg.total, 0)::int AS total,
        COALESCE(agg.passed, 0)::int AS passed,
        COALESCE(agg.failed, 0)::int AS failed,
        COALESCE(agg.blocked, 0)::int AS blocked,
        COALESCE(agg.retest, 0)::int AS retest,
        COALESCE(agg.skipped, 0)::int AS skipped,
        COALESCE(agg.untested, 0)::int AS untested,
        (SELECT json_agg(DISTINCT ai.assignee_id)
           FROM run_items ai
          WHERE ai.run_id = r.id AND ai.assignee_id IS NOT NULL) AS assignee_ids
      FROM runs r
      LEFT JOIN (
        SELECT i.run_id,
               count(*) AS total,
               count(*) FILTER (WHERE lr.status = 'passed') AS passed,
               count(*) FILTER (WHERE lr.status = 'failed') AS failed,
               count(*) FILTER (WHERE lr.status = 'blocked') AS blocked,
               count(*) FILTER (WHERE lr.status = 'retest') AS retest,
               count(*) FILTER (WHERE lr.status = 'skipped') AS skipped,
               count(*) FILTER (WHERE lr.status IS NULL) AS untested
          FROM run_items i
          ${LATEST_RESULT_JOIN}
         GROUP BY i.run_id
      ) agg ON agg.run_id = r.id`;
  }

  private buildRunWhere(filter: RunListFilter): { clause: string; values: unknown[] } {
    const values: unknown[] = [filter.projectId];
    const where: string[] = ['r.project_id = $1', 'r.deleted_at IS NULL'];
    const push = (value: unknown): string => {
      values.push(value);
      return `$${values.length}`;
    };
    if (filter.planId === 'none') {
      where.push('r.plan_id IS NULL');
    } else if (filter.planId !== null) {
      where.push(`r.plan_id = ${push(filter.planId)}`);
    }
    if (filter.status === 'open') where.push('r.completed_at IS NULL');
    if (filter.status === 'completed') where.push('r.completed_at IS NOT NULL');
    if (filter.query !== null) {
      where.push(`r.name ILIKE ${push(`%${escapeLike(filter.query)}%`)}`);
    }
    return { clause: `WHERE ${where.join(' AND ')}`, values };
  }

  async countRuns(filter: RunListFilter): Promise<number> {
    const { clause, values } = this.buildRunWhere(filter);
    const result = await this.db.query<{ count: string }>(
      `SELECT count(*) AS count FROM runs r ${clause}`,
      values,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async listRuns(
    filter: RunListFilter & { sort: string; limit: number; offset: number },
  ): Promise<RunWithCountsRow[]> {
    const { clause, values } = this.buildRunWhere(filter);
    const descending = filter.sort.startsWith('-');
    const key = (descending ? filter.sort.slice(1) : filter.sort) as RunSortKey;
    const column = RUN_SORT_COLUMNS[key] ?? RUN_SORT_COLUMNS.created_at;
    const direction = descending ? 'DESC' : 'ASC';
    // Null due dates always sort last, whichever direction was asked for.
    const nulls = key === 'due_date' ? `NULLS LAST` : '';
    const result = await this.db.query<RunWithCountsRow>(
      `${this.runSelect()}
       ${clause}
       ORDER BY ${column} ${direction} ${nulls}, r.id ASC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, filter.limit, filter.offset],
    );
    return result.rows;
  }

  // --- run items ----------------------------------------------------------

  async findItem(
    runId: string,
    itemId: string,
    q: Queryable = this.db,
  ): Promise<RunItemRow | null> {
    const result = await q.query<RunItemRow>(
      `SELECT ${itemSelect('i', false)}
       FROM run_items i
       ${LATEST_RESULT_JOIN}
       WHERE i.id = $1 AND i.run_id = $2`,
      [itemId, runId],
    );
    return result.rows[0] ?? null;
  }

  /** Detail adds the snapshotted steps and the case's live preconditions. */
  async findItemDetail(
    runId: string,
    itemId: string,
    q: Queryable = this.db,
  ): Promise<RunItemDetailRow | null> {
    const result = await q.query<RunItemDetailRow>(
      `SELECT ${itemSelect('i', true)}, c.preconditions AS case_preconditions
       FROM run_items i
       ${LATEST_RESULT_JOIN}
       LEFT JOIN cases c ON c.id = i.case_id
       WHERE i.id = $1 AND i.run_id = $2`,
      [itemId, runId],
    );
    return result.rows[0] ?? null;
  }

  /** Locks an item row inside a write transaction. */
  async findItemForUpdate(
    runId: string,
    itemId: string,
    client: Queryable,
  ): Promise<RunItemRow | null> {
    const result = await client.query<RunItemRow>(
      `SELECT ${itemSelect('i', false)}
       FROM run_items i
       ${LATEST_RESULT_JOIN}
       WHERE i.id = $1 AND i.run_id = $2
       FOR UPDATE OF i`,
      [itemId, runId],
    );
    return result.rows[0] ?? null;
  }

  private buildItemWhere(filter: RunItemFilter): { clause: string; values: unknown[] } {
    const values: unknown[] = [filter.runId];
    const where: string[] = ['i.run_id = $1'];
    const push = (value: unknown): string => {
      values.push(value);
      return `$${values.length}`;
    };
    if (filter.statuses !== null && filter.statuses.length > 0) {
      const parts: string[] = [];
      const concrete = filter.statuses.filter((status) => status !== 'untested');
      if (concrete.length > 0) {
        parts.push(`lr.status = ANY(${push(concrete)}::text[])`);
      }
      if (filter.statuses.includes('untested')) parts.push('lr.status IS NULL');
      where.push(`(${parts.join(' OR ')})`);
    }
    if (filter.assigneeId === 'none') {
      where.push('i.assignee_id IS NULL');
    } else if (filter.assigneeId !== null) {
      where.push(`i.assignee_id = ${push(filter.assigneeId)}`);
    }
    if (filter.suiteIds !== null) {
      if (filter.suiteIds.length === 0) where.push('false');
      else where.push(`i.case_suite_id = ANY(${push(filter.suiteIds)}::uuid[])`);
    }
    if (filter.query !== null) {
      where.push(`i.case_title ILIKE ${push(`%${escapeLike(filter.query)}%`)}`);
    }
    return { clause: `WHERE ${where.join(' AND ')}`, values };
  }

  async countItems(filter: RunItemFilter): Promise<number> {
    const { clause, values } = this.buildItemWhere(filter);
    const result = await this.db.query<{ count: string }>(
      `SELECT count(*) AS count FROM run_items i ${LATEST_RESULT_JOIN} ${clause}`,
      values,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async listItems(
    filter: RunItemFilter & { sort: string; limit: number; offset: number },
  ): Promise<RunItemRow[]> {
    const { clause, values } = this.buildItemWhere(filter);
    const descending = filter.sort.startsWith('-');
    const key = (descending ? filter.sort.slice(1) : filter.sort) as ItemSortKey;
    const column = ITEM_SORT_COLUMNS[key] ?? ITEM_SORT_COLUMNS.position;
    const direction = descending ? 'DESC' : 'ASC';
    const result = await this.db.query<RunItemRow>(
      `SELECT ${itemSelect('i', false)}
       FROM run_items i
       ${LATEST_RESULT_JOIN}
       ${clause}
       ORDER BY ${column} ${direction}, i.position ASC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, filter.limit, filter.offset],
    );
    return result.rows;
  }

  async countItemsForRun(runId: string, q: Queryable = this.db): Promise<number> {
    const result = await q.query<{ count: string }>(
      'SELECT count(*) AS count FROM run_items WHERE run_id = $1',
      [runId],
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  /** Case ids already present in the run (for de-duplication on add). */
  async existingCaseIds(
    runId: string,
    caseIds: string[],
    q: Queryable = this.db,
  ): Promise<Set<string>> {
    if (caseIds.length === 0) return new Set();
    const result = await q.query<{ case_id: string }>(
      'SELECT case_id FROM run_items WHERE run_id = $1 AND case_id = ANY($2::uuid[])',
      [runId, caseIds],
    );
    return new Set(result.rows.map((row) => row.case_id));
  }

  async maxPosition(runId: string, q: Queryable = this.db): Promise<number> {
    const result = await q.query<{ max: number | null }>(
      'SELECT max(position) AS max FROM run_items WHERE run_id = $1',
      [runId],
    );
    return result.rows[0]?.max ?? 0;
  }

  async insertItems(
    runId: string,
    items: RunItemWrite[],
    q: Queryable = this.db,
  ): Promise<RunItemRow[]> {
    if (items.length === 0) return [];
    const values: unknown[] = [];
    const rows = items.map((item) => {
      const base = values.length;
      values.push(
        runId,
        item.case_id,
        item.case_display_id,
        item.case_title,
        JSON.stringify(item.case_steps ?? []),
        item.case_priority,
        item.case_suite_id,
        item.position,
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6}, $${base + 7}, $${base + 8})`;
    });
    const result = await q.query<RunItemRow>(
      `INSERT INTO run_items
         (run_id, case_id, case_display_id, case_title, case_steps, case_priority, case_suite_id, position)
       VALUES ${rows.join(', ')}
       RETURNING ${ITEM_INSERT_RETURNING}`,
      values,
    );
    return result.rows;
  }

  async updateItem(
    itemId: string,
    fields: RunItemUpdateFields,
    q: Queryable = this.db,
  ): Promise<RunItemRow | null> {
    if (fields.assignee_id === undefined) return this.findItemById(itemId, q);
    await q.query(
      'UPDATE run_items SET assignee_id = $2, updated_at = now() WHERE id = $1',
      [itemId, fields.assignee_id],
    );
    return this.findItemById(itemId, q);
  }

  /** The item on its own (no run scoping) — used after writes. */
  async findItemById(itemId: string, q: Queryable = this.db): Promise<RunItemRow | null> {
    const result = await q.query<RunItemRow>(
      `SELECT ${itemSelect('i', false)}
       FROM run_items i
       ${LATEST_RESULT_JOIN}
       WHERE i.id = $1`,
      [itemId],
    );
    return result.rows[0] ?? null;
  }

  /** Bulk assign; `itemIds = null` targets every item of the run. */
  async bulkAssign(
    runId: string,
    assigneeId: string | null,
    itemIds: string[] | null,
    q: Queryable = this.db,
  ): Promise<number> {
    if (itemIds === null) {
      const result = await q.query(
        'UPDATE run_items SET assignee_id = $2, updated_at = now() WHERE run_id = $1',
        [runId, assigneeId],
      );
      return result.rowCount ?? 0;
    }
    if (itemIds.length === 0) return 0;
    const result = await q.query(
      'UPDATE run_items SET assignee_id = $3, updated_at = now() WHERE run_id = $1 AND id = ANY($2::uuid[])',
      [runId, itemIds, assigneeId],
    );
    return result.rowCount ?? 0;
  }

  /** Item ids of a run that match the requested ids (validates bulk assign). */
  async itemIdsInRun(
    runId: string,
    itemIds: string[],
    q: Queryable = this.db,
  ): Promise<Set<string>> {
    if (itemIds.length === 0) return new Set();
    const result = await q.query<{ id: string }>(
      'SELECT id FROM run_items WHERE run_id = $1 AND id = ANY($2::uuid[])',
      [runId, itemIds],
    );
    return new Set(result.rows.map((row) => row.id));
  }

  async deleteItem(itemId: string, q: Queryable = this.db): Promise<boolean> {
    const result = await q.query('DELETE FROM run_items WHERE id = $1', [itemId]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Renumbers a run densely after a move: the target item is spliced into the
   * position-ordered list, then only the rows whose index changed are written,
   * in one statement.
   */
  async reorderItem(
    runId: string,
    itemId: string,
    newPosition: number,
    q: Queryable = this.db,
  ): Promise<boolean> {
    const current = await q.query<{ id: string }>(
      'SELECT id FROM run_items WHERE run_id = $1 ORDER BY position ASC, id ASC',
      [runId],
    );
    const ids = current.rows.map((row) => row.id);
    const fromIndex = ids.indexOf(itemId);
    if (fromIndex === -1) return false;
    if (newPosition < 1 || newPosition > ids.length) return false;
    const reordered = [...ids];
    reordered.splice(fromIndex, 1);
    reordered.splice(newPosition - 1, 0, itemId);
    const changed = reordered
      .map((id, index) => ({ id, position: index + 1 }))
      .filter((entry, index) => ids[index] !== entry.id);
    if (changed.length === 0) return true;
    const values: unknown[] = [runId];
    const tuples = changed.map((entry) => {
      values.push(entry.id, entry.position);
      return `($${values.length - 1}::uuid, $${values.length}::int)`;
    });
    await q.query(
      `UPDATE run_items AS ri SET position = v.position
       FROM (VALUES ${tuples.join(', ')}) AS v(id, position)
       WHERE ri.id = v.id AND ri.run_id = $1`,
      values,
    );
    return true;
  }

  // --- case selection -----------------------------------------------------

  /**
   * Live cases of a project for a run selection: the union of explicit ids and
   * a suite subtree, one row per case (so duplicates collapse), ordered by
   * `case_number` for the run's authored order, each carrying its steps as a
   * jsonb snapshot.
   */
  async selectCases(
    projectId: string,
    caseIds: string[],
    suiteIds: string[] | null,
    q: Queryable = this.db,
  ): Promise<CaseSnapshotRow[]> {
    const result = await q.query<CaseSnapshotRow>(
      `SELECT c.id, c.case_number, c.title, c.priority, c.suite_id,
              COALESCE(
                (SELECT jsonb_agg(jsonb_build_object(
                           'position', s.position,
                           'text', s.text,
                           'expected_result', s.expected_result)
                         ORDER BY s.position)
                   FROM case_steps s WHERE s.case_id = c.id),
                '[]'::jsonb
              ) AS steps
       FROM cases c
       WHERE c.project_id = $1
         AND c.deleted_at IS NULL
         AND c.suite_id IS NOT NULL
         AND (
           c.id = ANY($2::uuid[])
           ${suiteIds === null ? '' : 'OR c.suite_id = ANY($3::uuid[])'}
         )
       ORDER BY c.case_number ASC`,
      suiteIds === null ? [projectId, caseIds] : [projectId, caseIds, suiteIds],
    );
    return result.rows;
  }

  /** How many of the given ids are live cases of this project (add validation). */
  async countLiveCasesByIds(
    projectId: string,
    caseIds: string[],
    q: Queryable = this.db,
  ): Promise<Set<string>> {
    if (caseIds.length === 0) return new Set();
    const result = await q.query<{ id: string }>(
      `SELECT id FROM cases
       WHERE project_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL AND suite_id IS NOT NULL`,
      [projectId, caseIds],
    );
    return new Set(result.rows.map((row) => row.id));
  }
}