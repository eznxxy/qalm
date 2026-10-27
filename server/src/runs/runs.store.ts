import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../errors';
import { DbService } from '../db/db.service';
import { Queryable } from '../db/queryable';
import { ItemStatus, ItemSortKey, ResultStatus, RunSortKey } from './runs.constants';
import { statusRankSql } from './run-counts';
import { runNameConflict } from './run-name';

/** Postgres SQLSTATE for unique_index / unique_constraint violations. */
const UNIQUE_VIOLATION = '23505';

interface PgErrorShape {
  code?: string;
  constraint?: string;
}

/** The duplicate-name index added by 20261027000002_runs_name_unique. */
const RUN_NAME_INDEX = 'runs_project_name_unique';

/**
 * A duplicate live run name, whether it surfaces from the service's pre-check
 * or from the index under a concurrent insert. Restricted to that index so a
 * primary-key clash is not mislabelled as a name conflict.
 */
function isRunNameViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as PgErrorShape).code === UNIQUE_VIOLATION &&
    (error as PgErrorShape).constraint === RUN_NAME_INDEX
  );
}

/**
 * DB row shapes for runs (migrations 20261026000001 + 20261027000001).
 * `start_date`/`due_date` are selected as text so they are plain `YYYY-MM-DD`
 * strings, never a timezone-shifted Date.
 */
export interface RunRow {
  id: string;
  project_id: string;
  plan_id: string | null;
  milestone_id: string | null;
  name: string;
  description: string | null;
  start_date: string | null;
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
  /** Distinct non-null item `case_suite_id` snapshots (docs/api-runs.md). */
  suite_ids: string[] | null;
}

/**
 * A run plus its rollup and its milestone's current name. The name is joined in
 * `runSelect()`, so an INSERT/UPDATE's `RETURNING` row (plain `RunRow`) never
 * has it and every read path does.
 */
export interface RunWithCountsRow extends RunRow, RunAggRow {
  milestone_name: string | null;
}

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

/** Minimal live-milestone lookup for the run link (docs/api-milestones.md). */
export interface MilestoneRef {
  id: string;
  project_id: string;
}

export interface UserRef {
  id: string;
  role: string;
  is_active: boolean;
}

/** Minimal live-case lookup for the Linked runs feed (§4.2). */
export interface CaseRef {
  id: string;
  project_id: string;
}

/** One row of `GET /cases/:id/runs` (docs/api-runs.md § Linked runs). */
export interface CaseRunRow {
  run_id: string;
  run_name: string;
  run_status: 'open' | 'completed';
  plan_id: string | null;
  item_id: string;
  status: ItemStatus;
  /** The item's `updated_at` — bumped on every result write on the case. */
  updated_at: Date;
}

export interface RunListFilter {
  projectId: string;
  /** `null` = any plan; the literal `'none'` = runs with no plan; else a plan id. */
  planId: string | null;
  /** `null` = any milestone; `'none'` = runs with no milestone; else an id. */
  milestoneId: string | null;
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
  milestone_id?: string | null;
  start_date?: string | null;
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

/** One recorded result (docs/api-runs.md § Resource: Result). */
export interface ResultRow {
  id: string;
  run_item_id: string;
  status: ResultStatus;
  comment: string | null;
  elapsed_minutes: number | null;
  defect_url: string | null;
  created_by: string;
  created_at: Date;
}

/**
 * A result plus its author's display name — what the Result resource returns
 * (docs/api-runs.md, QA card 3.16). The name is joined, never stored, so it
 * follows a later rename.
 */
export interface ResultRowWithAuthor extends ResultRow {
  created_by_name: string;
}

/**
 * A result joined to its item, run and project — everything the write rules
 * need (project archived, run completed, item assignee, result author).
 */
export interface ResultContextRow extends ResultRow {
  item_id: string;
  item_assignee_id: string | null;
  run_id: string;
  project_id: string;
  run_completed_at: Date | null;
}

/** `size_bytes` is selected `::int` (≤ 10 MB) so the API sees a number. */
export interface AttachmentRow {
  id: string;
  result_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  storage_key: string;
  created_by: string;
  created_at: Date;
}

/** An attachment plus its result/item/run context (write + read rules). */
export interface AttachmentContextRow extends AttachmentRow {
  result_created_by: string;
  item_id: string;
  item_assignee_id: string | null;
  run_id: string;
  project_id: string;
  run_completed_at: Date | null;
}

export interface ResultUpdateFields {
  comment?: string | null;
  elapsed_minutes?: number | null;
  defect_url?: string | null;
}

export interface AttachmentWrite {
  id: string;
  result_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  storage_key: string;
  created_by: string;
}

/** Escapes LIKE/ILIKE wildcards in user-supplied substring input. */
export function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

const RUN_FIELDS = [
  'id',
  'project_id',
  'plan_id',
  'milestone_id',
  'name',
  'description',
  'start_date',
  'due_date',
  'completed_at',
  'completed_by',
  'created_by',
  'updated_by',
  'deleted_at',
  'created_at',
  'updated_at',
] as const;

/** `start_date`/`due_date` are always cast to text so the API sees `YYYY-MM-DD`. */
export function runColumns(alias = ''): string {
  const prefix = alias === '' ? '' : `${alias}.`;
  return RUN_FIELDS.map((field) =>
    field === 'due_date' || field === 'start_date'
      ? `${prefix}${field}::text AS ${field}`
      : `${prefix}${field}`,
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
 * Exported so the plan rollup counts items by the same "newest result" rule.
 */
export const LATEST_RESULT_JOIN = `
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

const RESULT_FIELDS = [
  'id',
  'run_item_id',
  'status',
  'comment',
  'elapsed_minutes',
  'defect_url',
  'created_by',
  'created_at',
] as const;

function resultColumns(alias: string): string {
  return RESULT_FIELDS.map((field) => `${alias}.${field}`).join(', ');
}

/**
 * The Result resource's columns: the row plus its author's name (card 3.16).
 * Pairs with `RESULT_AUTHOR_JOIN`.
 */
function resultColumnsWithAuthor(alias: string): string {
  return `${resultColumns(alias)}, u.name AS created_by_name`;
}

function RESULT_AUTHOR_JOIN(alias: string): string {
  return `JOIN users u ON u.id = ${alias}.created_by`;
}

const ATTACHMENT_FIELDS = [
  'id',
  'result_id',
  'filename',
  'content_type',
  'size_bytes',
  'storage_key',
  'created_by',
  'created_at',
] as const;

/** `size_bytes` is a bigint; cast so pg hands the API a number. */
function attachmentColumns(alias: string): string {
  return ATTACHMENT_FIELDS.map((field) =>
    field === 'size_bytes'
      ? `${alias}.size_bytes::int AS size_bytes`
      : `${alias}.${field}`,
  ).join(', ');
}

/** Joins a result to its item, run and project for the write/read rules. */
const RESULT_CONTEXT_JOIN = `
  JOIN run_items i ON i.id = res.run_item_id
  JOIN runs r ON r.id = i.run_id`;

function resultContextColumns(): string {
  return `${resultColumns('res')},
    i.id AS item_id,
    i.assignee_id AS item_assignee_id,
    r.id AS run_id,
    r.project_id AS project_id,
    r.completed_at AS run_completed_at`;
}

const ATTACHMENT_CONTEXT_JOIN = `
  JOIN results res ON res.id = a.result_id
  JOIN run_items i ON i.id = res.run_item_id
  JOIN runs r ON r.id = i.run_id`;

function attachmentContextColumns(): string {
  return `${attachmentColumns('a')},
    res.created_by AS result_created_by,
    i.id AS item_id,
    i.assignee_id AS item_assignee_id,
    r.id AS run_id,
    r.project_id AS project_id,
    r.completed_at AS run_completed_at`;
}

const RUN_SORT_COLUMNS: Record<RunSortKey, string> = {
  created_at: 'r.created_at',
  updated_at: 'r.updated_at',
  start_date: 'r.start_date',
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

  /** A live milestone's project, for the same-project link rule. */
  async findMilestone(
    milestoneId: string,
    q: Queryable = this.db,
  ): Promise<MilestoneRef | null> {
    const result = await q.query<MilestoneRef>(
      'SELECT id, project_id FROM milestones WHERE id = $1 AND deleted_at IS NULL',
      [milestoneId],
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

  /**
   * Which of the given suite ids exist in the project — one query, so a create
   * selection can name the offending row instead of failing generically.
   */
  async findSuiteIds(
    projectId: string,
    suiteIds: string[],
    q: Queryable = this.db,
  ): Promise<Set<string>> {
    if (suiteIds.length === 0) return new Set();
    const result = await q.query<{ id: string }>(
      'SELECT id FROM suites WHERE project_id = $1 AND id = ANY($2::uuid[])',
      [projectId, suiteIds],
    );
    return new Set(result.rows.map((row) => row.id));
  }

  /**
   * Union of the subtrees of several suites (create selection). `UNION` rather
   * than `UNION ALL` so a parent selected beside its child yields each id once.
   */
  async suiteSubtreeIdsMany(
    projectId: string,
    suiteIds: string[],
    includeDescendants: boolean,
    q: Queryable = this.db,
  ): Promise<string[]> {
    if (suiteIds.length === 0) return [];
    if (!includeDescendants) {
      const result = await q.query<{ id: string }>(
        'SELECT id FROM suites WHERE project_id = $1 AND id = ANY($2::uuid[])',
        [projectId, suiteIds],
      );
      return result.rows.map((row) => row.id);
    }
    const result = await q.query<{ id: string }>(
      `WITH RECURSIVE sub AS (
         SELECT id FROM suites WHERE project_id = $1 AND id = ANY($2::uuid[])
         UNION
         SELECT s.id FROM suites s JOIN sub ON s.parent_id = sub.id
       )
       SELECT id FROM sub`,
      [projectId, suiteIds],
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

  /**
   * Live runs with these ids, locked for the caller's transaction, in no
   * particular order (docs/api-plans.md § Attaching existing runs). Missing,
   * soft-deleted and other-project ids simply do not come back; the caller
   * reports them per index.
   */
  async findLiveByIdsForUpdate(ids: string[], client: Queryable): Promise<RunRow[]> {
    if (ids.length === 0) return [];
    const result = await client.query<RunRow>(
      `SELECT ${runColumns('r')} FROM runs r
       WHERE r.id = ANY($1::uuid[]) AND r.deleted_at IS NULL
       FOR UPDATE`,
      [ids],
    );
    return result.rows;
  }

  /**
   * Attaches already-validated runs to a plan. One statement for the whole
   * batch, so a 20-run plan stays one round trip; only `plan_id` and the audit
   * columns change and nothing else about the run moves.
   */
  async attachToPlan(
    ids: string[],
    planId: string,
    actorId: string,
    client: Queryable,
  ): Promise<void> {
    if (ids.length === 0) return;
    await client.query(
      `UPDATE runs SET plan_id = $2, updated_by = $3, updated_at = now()
       WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [ids, planId, actorId],
    );
  }

  /**
   * Writes the milestone link for a batch of already-validated runs (one
   * statement, like `attachToPlan`). `null` detaches; the caller has already
   * checked project, liveness and, for bulk attach, that none is taken.
   */
  async setMilestone(
    ids: string[],
    milestoneId: string | null,
    actorId: string,
    client: Queryable,
  ): Promise<void> {
    if (ids.length === 0) return;
    await client.query(
      `UPDATE runs SET milestone_id = $2, updated_by = $3, updated_at = now()
       WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [ids, milestoneId, actorId],
    );
  }

  /**
   * Detaches every run of a milestone (`milestone_id = null`) — deleting a
   * milestone never deletes its runs. Soft-deleted runs are detached too, so a
   * restore never resurrects a dangling reference.
   */
  async detachMilestoneRuns(
    milestoneId: string,
    actorId: string,
    client: Queryable,
  ): Promise<number> {
    const result = await client.query(
      `UPDATE runs SET milestone_id = null, updated_by = $2, updated_at = now()
       WHERE milestone_id = $1`,
      [milestoneId, actorId],
    );
    return result.rowCount ?? 0;
  }

  /** One run with its counts and assignees (detail + post-write responses). */
  async findWithCounts(id: string, q: Queryable = this.db): Promise<RunWithCountsRow | null> {
    const result = await q.query<RunWithCountsRow>(
      `${this.runSelect()} WHERE r.id = $1 AND r.deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  /**
   * A live run id in the project with this name, ignoring case (dup check).
   * `excludeId` lets a rename keep its own name while changing its case.
   */
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
      `SELECT id FROM runs WHERE ${clause} LIMIT 1`,
      values,
    );
    return result.rows[0]?.id ?? null;
  }

  async insertRun(
    row: {
      project_id: string;
      plan_id: string | null;
      milestone_id: string | null;
      name: string;
      description: string | null;
      start_date: string | null;
      due_date: string | null;
      created_by: string;
    },
    q: Queryable = this.db,
  ): Promise<RunRow> {
    try {
      const result = await q.query<RunRow>(
        `INSERT INTO runs (project_id, plan_id, milestone_id, name, description, start_date, due_date, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         RETURNING ${runColumns()}`,
        [
          row.project_id,
          row.plan_id,
          row.milestone_id,
          row.name,
          row.description,
          row.start_date,
          row.due_date,
          row.created_by,
        ],
      );
      const created = result.rows[0];
      if (!created) throw new ApiError('INTERNAL', 'Run creation failed.');
      return created;
    } catch (error) {
      // The pre-check names the field; this closes the concurrent-insert race.
      if (isRunNameViolation(error)) throw runNameConflict();
      throw error;
    }
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
    if (fields.milestone_id !== undefined) assign('milestone_id', fields.milestone_id);
    if (fields.start_date !== undefined) assign('start_date', fields.start_date);
    if (fields.due_date !== undefined) assign('due_date', fields.due_date);
    assign('updated_by', fields.updated_by);

    try {
      const result = await q.query<RunRow>(
        `UPDATE runs SET ${assignments.join(', ')}, updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING ${runColumns()}`,
        [id, ...values],
      );
      return result.rows[0] ?? null;
    } catch (error) {
      if (isRunNameViolation(error)) throw runNameConflict();
      throw error;
    }
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
        ms.name AS milestone_name,
        COALESCE(agg.total, 0)::int AS total,
        COALESCE(agg.passed, 0)::int AS passed,
        COALESCE(agg.failed, 0)::int AS failed,
        COALESCE(agg.blocked, 0)::int AS blocked,
        COALESCE(agg.retest, 0)::int AS retest,
        COALESCE(agg.skipped, 0)::int AS skipped,
        COALESCE(agg.untested, 0)::int AS untested,
        (SELECT json_agg(DISTINCT ai.assignee_id)
           FROM run_items ai
          WHERE ai.run_id = r.id AND ai.assignee_id IS NOT NULL) AS assignee_ids,
        (SELECT json_agg(DISTINCT si.case_suite_id)
           FROM run_items si
          WHERE si.run_id = r.id AND si.case_suite_id IS NOT NULL) AS suite_ids
      FROM runs r
      LEFT JOIN milestones ms ON ms.id = r.milestone_id AND ms.deleted_at IS NULL
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
    if (filter.milestoneId === 'none') {
      where.push('r.milestone_id IS NULL');
    } else if (filter.milestoneId !== null) {
      where.push(`r.milestone_id = ${push(filter.milestoneId)}`);
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
    // Null dates always sort last, whichever direction was asked for.
    const nulls =
      key === 'due_date' || key === 'start_date' ? `NULLS LAST` : '';
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

  // --- results ------------------------------------------------------------

  async insertResult(
    row: {
      run_item_id: string;
      status: ResultStatus;
      comment: string | null;
      elapsed_minutes: number | null;
      defect_url: string | null;
      created_by: string;
    },
    q: Queryable = this.db,
  ): Promise<ResultRowWithAuthor> {
    // A CTE so the inserted row and its author's name come back in one
    // round-trip: RETURNING cannot join (docs/api-runs.md § Resource: Result).
    const result = await q.query<ResultRowWithAuthor>(
      `WITH inserted AS (
         INSERT INTO results (run_item_id, status, comment, elapsed_minutes, defect_url, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${RESULT_FIELDS.join(', ')}
       )
       SELECT ${resultColumnsWithAuthor('inserted')}
       FROM inserted
       ${RESULT_AUTHOR_JOIN('inserted')}`,
      [
        row.run_item_id,
        row.status,
        row.comment,
        row.elapsed_minutes,
        row.defect_url,
        row.created_by,
      ],
    );
    const created = result.rows[0];
    if (!created) throw new ApiError('INTERNAL', 'Result creation failed.');
    return created;
  }

  /** A result with its item/run/project context, locked against concurrent writes. */
  async findResultContextForUpdate(
    id: string,
    client: Queryable,
  ): Promise<ResultContextRow | null> {
    const result = await client.query<ResultContextRow>(
      `SELECT ${resultContextColumns()}
       FROM results res
       ${RESULT_CONTEXT_JOIN}
       WHERE res.id = $1 AND r.deleted_at IS NULL
       FOR UPDATE OF res, r`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  /** The item's newest result id (contract § PATCH /results/:id — latest only). */
  async latestResultIdOf(itemId: string, q: Queryable = this.db): Promise<string | null> {
    const result = await q.query<{ id: string }>(
      `SELECT id FROM results
       WHERE run_item_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [itemId],
    );
    return result.rows[0]?.id ?? null;
  }

  async countResults(itemId: string, q: Queryable = this.db): Promise<number> {
    const result = await q.query<{ count: string }>(
      'SELECT count(*) AS count FROM results WHERE run_item_id = $1',
      [itemId],
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async listResults(
    itemId: string,
    limit: number,
    offset: number,
    q: Queryable = this.db,
  ): Promise<ResultRowWithAuthor[]> {
    const result = await q.query<ResultRowWithAuthor>(
      `SELECT ${resultColumnsWithAuthor('res')}
       FROM results res
       ${RESULT_AUTHOR_JOIN('res')}
       WHERE res.run_item_id = $1
       ORDER BY res.created_at DESC, res.id DESC
       LIMIT $2 OFFSET $3`,
      [itemId, limit, offset],
    );
    return result.rows;
  }

  async updateResult(
    id: string,
    fields: ResultUpdateFields,
    q: Queryable = this.db,
  ): Promise<ResultRow | null> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    const assign = (column: string, value: unknown): void => {
      values.push(value);
      assignments.push(`${column} = $${values.length + 1}`);
    };
    if (fields.comment !== undefined) assign('comment', fields.comment);
    if (fields.elapsed_minutes !== undefined) assign('elapsed_minutes', fields.elapsed_minutes);
    if (fields.defect_url !== undefined) assign('defect_url', fields.defect_url);
    if (assignments.length === 0) return this.findResultById(id, q);

    const result = await q.query<ResultRow>(
      `UPDATE results SET ${assignments.join(', ')}
       WHERE id = $1
       RETURNING ${resultColumns('results')}`,
      [id, ...values],
    );
    return result.rows[0] ?? null;
  }

  async findResultById(
    id: string,
    q: Queryable = this.db,
  ): Promise<ResultRowWithAuthor | null> {
    const result = await q.query<ResultRowWithAuthor>(
      `SELECT ${resultColumnsWithAuthor('res')}
       FROM results res
       ${RESULT_AUTHOR_JOIN('res')}
       WHERE res.id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  /** Bumps an item's `updated_at` after a result/attachment write. */
  async touchItem(itemId: string, q: Queryable = this.db): Promise<void> {
    await q.query('UPDATE run_items SET updated_at = now() WHERE id = $1', [itemId]);
  }

  // --- result attachments -------------------------------------------------

  async countAttachments(resultId: string, q: Queryable = this.db): Promise<number> {
    const result = await q.query<{ count: string }>(
      'SELECT count(*) AS count FROM result_attachments WHERE result_id = $1',
      [resultId],
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async insertAttachment(
    row: AttachmentWrite,
    q: Queryable = this.db,
  ): Promise<AttachmentRow> {
    const result = await q.query<AttachmentRow>(
      `INSERT INTO result_attachments
         (id, result_id, filename, content_type, size_bytes, storage_key, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${attachmentColumns('result_attachments')}`,
      [
        row.id,
        row.result_id,
        row.filename,
        row.content_type,
        row.size_bytes,
        row.storage_key,
        row.created_by,
      ],
    );
    const created = result.rows[0];
    if (!created) throw new ApiError('INTERNAL', 'Attachment creation failed.');
    return created;
  }

  /** Attachments of several results in one query (no per-row lookups). */
  async attachmentsByResultIds(
    resultIds: string[],
    q: Queryable = this.db,
  ): Promise<AttachmentRow[]> {
    if (resultIds.length === 0) return [];
    const result = await q.query<AttachmentRow>(
      `SELECT ${attachmentColumns('a')}
       FROM result_attachments a
       WHERE a.result_id = ANY($1::uuid[])
       ORDER BY a.created_at ASC, a.id ASC`,
      [resultIds],
    );
    return result.rows;
  }

  async findAttachmentContext(
    id: string,
    q: Queryable = this.db,
  ): Promise<AttachmentContextRow | null> {
    const result = await q.query<AttachmentContextRow>(
      `SELECT ${attachmentContextColumns()}
       FROM result_attachments a
       ${ATTACHMENT_CONTEXT_JOIN}
       WHERE a.id = $1 AND r.deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  /** Locks the attachment, its result and the run for a delete/read decision. */
  async findAttachmentContextForUpdate(
    id: string,
    client: Queryable,
  ): Promise<AttachmentContextRow | null> {
    const result = await client.query<AttachmentContextRow>(
      `SELECT ${attachmentContextColumns()}
       FROM result_attachments a
       ${ATTACHMENT_CONTEXT_JOIN}
       WHERE a.id = $1 AND r.deleted_at IS NULL
       FOR UPDATE OF a, res, r`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async deleteAttachment(id: string, q: Queryable = this.db): Promise<boolean> {
    const result = await q.query('DELETE FROM result_attachments WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  // --- case → linked runs -------------------------------------------------

  /** Live case lookup for the Linked runs feed; deleted cases are 404. */
  async findCaseRef(caseId: string, q: Queryable = this.db): Promise<CaseRef | null> {
    const result = await q.query<CaseRef>(
      'SELECT id, project_id FROM cases WHERE id = $1 AND deleted_at IS NULL',
      [caseId],
    );
    return result.rows[0] ?? null;
  }

  async countCaseRuns(caseId: string): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `SELECT count(*) AS count
         FROM run_items i
         JOIN runs r ON r.id = i.run_id
        WHERE i.case_id = $1 AND r.deleted_at IS NULL`,
      [caseId],
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  /**
   * Every live run containing the case, newest run first, with the case's
   * derived status and the item's `updated_at` (bumped on each result write).
   * Soft-deleted runs are excluded.
   */
  async listCaseRuns(caseId: string, limit: number, offset: number): Promise<CaseRunRow[]> {
    const result = await this.db.query<CaseRunRow>(
      `SELECT r.id AS run_id,
              r.name AS run_name,
              CASE WHEN r.completed_at IS NULL THEN 'open' ELSE 'completed' END AS run_status,
              r.plan_id,
              i.id AS item_id,
              ${ITEM_STATUS_EXPR} AS status,
              i.updated_at
         FROM run_items i
         JOIN runs r ON r.id = i.run_id
         ${LATEST_RESULT_JOIN}
        WHERE i.case_id = $1 AND r.deleted_at IS NULL
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT $2 OFFSET $3`,
      [caseId, limit, offset],
    );
    return result.rows;
  }
}