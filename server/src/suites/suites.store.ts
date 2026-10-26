import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../errors';
import { DbService } from '../db/db.service';
import { Queryable } from '../db/queryable';

export type { Queryable };

/**
 * DB row shape of `suites` (migration 20261025000001). snake_case columns;
 * the API projection in suites.types.ts is snake_case too.
 */
export interface SuiteRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  depth: number;
  position: number;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export const SUITE_COLUMNS =
  'id, project_id, parent_id, name, description, depth, position, created_by, created_at, updated_at';

/** Minimal slice of `projects` the suite access rules need. */
export interface SuiteProjectRef {
  id: string;
  status: 'active' | 'archived';
}

/**
 * Store methods take an optional queryable so a whole operation can run on
 * one transaction client (PoolClient) instead of the pool. DbService satisfies
 * it; so does PoolClient. The interface itself lives in db/queryable.ts so
 * suites and cases share one contract.
 */

/** Postgres SQLSTATE for unique_index / unique_constraint violations. */
const UNIQUE_VIOLATION = '23505';

interface PgErrorShape {
  code?: string;
  constraint?: string;
}

function isSiblingNameViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as PgErrorShape).code === UNIQUE_VIOLATION &&
    ((error as PgErrorShape).constraint ?? '').includes('suites_sibling_name_unique')
  );
}

/**
 * 409 CONFLICT for a sibling name clash; the message names the parent group
 * because the name is only unique inside its group (docs/api-suites.md).
 */
export function suiteNameConflict(parentId?: string | null): ApiError {
  const message =
    parentId === undefined
      ? 'A suite with this name already exists among its siblings.'
      : parentId === null
        ? 'A suite with this name already exists at the project root.'
        : `A suite with this name already exists under parent ${parentId}.`;
  return new ApiError('CONFLICT', message, [
    { field: 'name', issue: 'already in use among siblings' },
  ]);
}

/**
 * SQL layer for suites. Depth, position and sibling ordering are kept dense
 * here; relational decisions live in SuitesService. The unique index
 * (project_id, coalesce(parent_id, nil), lower(name)) backstops the service's
 * pre-check, so a concurrent create still yields the same 409 envelope.
 */
@Injectable()
export class SuitesStore {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /**
   * Runs a multi-statement operation on one connection. The service keeps the
   * business rules; the store only owns the SQL, so the transaction boundary
   * lives here next to it.
   */
  async transaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    return this.db.transaction((client) => fn(client));
  }

  async findProject(projectId: string, q: Queryable = this.db): Promise<SuiteProjectRef | null> {
    const result = await q.query<SuiteProjectRef>(
      'SELECT id, status FROM projects WHERE id = $1',
      [projectId],
    );
    return result.rows[0] ?? null;
  }

  async findById(id: string, q: Queryable = this.db): Promise<SuiteRow | null> {
    const result = await q.query<SuiteRow>(
      `SELECT ${SUITE_COLUMNS} FROM suites WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  /** Locks the suite row for a move/delete so concurrent reorders serialise. */
  async findByIdForUpdate(id: string, client: Queryable): Promise<SuiteRow | null> {
    const result = await client.query<SuiteRow>(
      `SELECT ${SUITE_COLUMNS} FROM suites WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  /** Whole project forest, parents strictly before children (depth ≤ 3). */
  async listByProject(projectId: string, q: Queryable = this.db): Promise<SuiteRow[]> {
    const result = await q.query<SuiteRow>(
      `SELECT ${SUITE_COLUMNS} FROM suites
       WHERE project_id = $1
       ORDER BY depth ASC, position ASC, id ASC`,
      [projectId],
    );
    return result.rows;
  }

  async listSiblings(
    projectId: string,
    parentId: string | null,
    q: Queryable = this.db,
  ): Promise<SuiteRow[]> {
    const result = await q.query<SuiteRow>(
      `SELECT ${SUITE_COLUMNS} FROM suites
       WHERE project_id = $1 AND parent_id IS NOT DISTINCT FROM $2::uuid
       ORDER BY position ASC, id ASC`,
      [projectId, parentId],
    );
    return result.rows;
  }

  /**
   * Locks every suite of the project in id order before an atomic reorder —
   * a deterministic lock order is what keeps two concurrent drags from
   * deadlocking (docs/api-suites.md § Implementation notes).
   */
  async listForUpdate(projectId: string, client: Queryable): Promise<SuiteRow[]> {
    const result = await client.query<SuiteRow>(
      `SELECT ${SUITE_COLUMNS} FROM suites
       WHERE project_id = $1
       ORDER BY id ASC
       FOR UPDATE`,
      [projectId],
    );
    return result.rows;
  }

  async findIdBySiblingName(
    projectId: string,
    parentId: string | null,
    name: string,
    excludeId: string | null,
    q: Queryable = this.db,
  ): Promise<string | null> {
    const result = await q.query<{ id: string }>(
      `SELECT id FROM suites
       WHERE project_id = $1
         AND parent_id IS NOT DISTINCT FROM $2::uuid
         AND lower(name) = lower($3)
         AND ($4::uuid IS NULL OR id <> $4::uuid)`,
      [projectId, parentId, name, excludeId],
    );
    return result.rows[0]?.id ?? null;
  }

  async countSiblings(
    projectId: string,
    parentId: string | null,
    q: Queryable = this.db,
  ): Promise<number> {
    const result = await q.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM suites
       WHERE project_id = $1 AND parent_id IS NOT DISTINCT FROM $2::uuid`,
      [projectId, parentId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async insert(
    row: Pick<
      SuiteRow,
      'project_id' | 'parent_id' | 'name' | 'description' | 'depth' | 'position' | 'created_by'
    >,
    q: Queryable = this.db,
  ): Promise<SuiteRow> {
    try {
      const result = await q.query<SuiteRow>(
        `INSERT INTO suites (project_id, parent_id, name, description, depth, position, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${SUITE_COLUMNS}`,
        [
          row.project_id,
          row.parent_id,
          row.name,
          row.description,
          row.depth,
          row.position,
          row.created_by,
        ],
      );
      const created = result.rows[0];
      if (!created) {
        throw new ApiError('INTERNAL', 'Suite creation failed.');
      }
      return created;
    } catch (error) {
      if (isSiblingNameViolation(error)) {
        throw suiteNameConflict(row.parent_id);
      }
      throw error;
    }
  }

  /**
   * Updates exactly the provided fields. An empty field set is a 400 (the
   * emitted `SET , updated_at` would otherwise be a PG syntax error → 500).
   */
  async updateFields(
    id: string,
    fields: {
      name?: string;
      description?: string | null;
      parent_id?: string | null;
      depth?: number;
      position?: number;
    },
    q: Queryable = this.db,
  ): Promise<SuiteRow | null> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    const assign = (column: string, value: unknown): void => {
      values.push(value);
      assignments.push(`${column} = $${values.length + 1}`);
    };
    if (fields.name !== undefined) assign('name', fields.name);
    if (fields.description !== undefined) assign('description', fields.description);
    if (fields.parent_id !== undefined) assign('parent_id', fields.parent_id);
    if (fields.depth !== undefined) assign('depth', fields.depth);
    if (fields.position !== undefined) assign('position', fields.position);
    if (assignments.length === 0) {
      throw new ApiError('VALIDATION_ERROR', 'Provide at least one field to update.', [
        { field: 'name', issue: 'at least one field must be provided' },
      ]);
    }
    try {
      const result = await q.query<SuiteRow>(
        `UPDATE suites SET ${assignments.join(', ')}, updated_at = now()
         WHERE id = $1
         RETURNING ${SUITE_COLUMNS}`,
        [id, ...values],
      );
      return result.rows[0] ?? null;
    } catch (error) {
      if (isSiblingNameViolation(error)) {
        throw suiteNameConflict(fields.parent_id);
      }
      throw error;
    }
  }

  /** Bumps updated_at only (a PATCH that changes nothing but was accepted). */
  async touch(id: string, q: Queryable = this.db): Promise<SuiteRow | null> {
    const result = await q.query<SuiteRow>(
      `UPDATE suites SET updated_at = now() WHERE id = $1 RETURNING ${SUITE_COLUMNS}`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Shifts a sibling group up/down from `fromPosition` (inclusive). Used to
   * open a slot before an insert/move (+1) and to close a gap after a delete
   * or move-out (-1). Positions stay dense because the whole group shifts.
   */
  async shiftPositions(
    projectId: string,
    parentId: string | null,
    fromPosition: number,
    delta: 1 | -1,
    q: Queryable = this.db,
  ): Promise<void> {
    await q.query(
      `UPDATE suites SET position = position + $4
       WHERE project_id = $1 AND parent_id IS NOT DISTINCT FROM $2::uuid AND position >= $3`,
      [projectId, parentId, fromPosition, delta],
    );
  }

  /** Dense rewrite of the given rows' positions, in one statement. */
  async setPositions(
    entries: Array<{ id: string; position: number }>,
    q: Queryable = this.db,
  ): Promise<void> {
    if (entries.length === 0) return;
    await q.query(
      `UPDATE suites s SET position = v.position
       FROM jsonb_to_recordset($1::jsonb) AS v(id uuid, position integer)
       WHERE s.id = v.id`,
      [JSON.stringify(entries)],
    );
  }

  /**
   * Applies a fully computed layout (parent/depth/position) in one statement —
   * the reorder endpoint's single write. Rows whose values did not change are
   * filtered out by the caller so updated_at only moves where it should.
   */
  async applyLayout(
    entries: Array<{
      id: string;
      parent_id: string | null;
      depth: number;
      position: number;
    }>,
    q: Queryable = this.db,
  ): Promise<void> {
    if (entries.length === 0) return;
    await q.query(
      `UPDATE suites s
       SET parent_id = v.parent_id, depth = v.depth, position = v.position, updated_at = now()
       FROM jsonb_to_recordset($1::jsonb)
         AS v(id uuid, parent_id uuid, depth smallint, position integer)
       WHERE s.id = v.id`,
      [JSON.stringify(entries)],
    );
  }

  /** Root + descendants, with their current depths (depth ≤ 3 bounds this). */
  async subtree(rootId: string, q: Queryable = this.db): Promise<Array<{ id: string; depth: number }>> {
    const result = await q.query<{ id: string; depth: number }>(
      `WITH RECURSIVE sub AS (
         SELECT id, depth FROM suites WHERE id = $1
         UNION ALL
         SELECT s.id, s.depth FROM suites s JOIN sub ON s.parent_id = sub.id
       )
       SELECT id, depth FROM sub`,
      [rootId],
    );
    return result.rows;
  }

  /** Adds `delta` to the depth of a subtree after a move. */
  async updateSubtreeDepth(rootId: string, delta: number, q: Queryable = this.db): Promise<void> {
    if (delta === 0) return;
    await q.query(
      `WITH RECURSIVE sub AS (
         SELECT id FROM suites WHERE id = $1
         UNION ALL
         SELECT s.id FROM suites s JOIN sub ON s.parent_id = sub.id
       )
       UPDATE suites s SET depth = s.depth + $2, updated_at = now()
       WHERE s.id IN (SELECT id FROM sub)`,
      [rootId, delta],
    );
  }

  async deleteById(id: string, q: Queryable = this.db): Promise<void> {
    await q.query('DELETE FROM suites WHERE id = $1', [id]);
  }

  async countChildren(id: string, q: Queryable = this.db): Promise<number> {
    const result = await q.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM suites WHERE parent_id = $1',
      [id],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /** Live cases only: soft-deleted rows do not block a suite delete. */
  async countLiveCases(id: string, q: Queryable = this.db): Promise<number> {
    const result = await q.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM cases WHERE suite_id = $1 AND deleted_at IS NULL',
      [id],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /** Direct (not subtree) live case counts, for the tree rollup. */
  async liveCaseCountsByProject(
    projectId: string,
    q: Queryable = this.db,
  ): Promise<Array<{ suite_id: string; count: number }>> {
    const result = await q.query<{ suite_id: string; count: number }>(
      `SELECT suite_id, count(*)::int AS count FROM cases
       WHERE project_id = $1 AND deleted_at IS NULL
       GROUP BY suite_id`,
      [projectId],
    );
    return result.rows;
  }
}
