/**
 * Migration — milestones, and the additive `runs.milestone_id` link.
 *
 * Contract: docs/api-milestones.md § Implementation notes; product rules in
 * docs/PRD-milestones.md; the run-side fields in docs/api-runs.md § Milestone
 * link. A milestone is a project-scoped checkpoint over runs, so it owns no
 * runs of its own: attaching writes `runs.milestone_id`, and deleting a
 * milestone only clears that column (handled by the API in one transaction).
 *
 * - `milestones` mirrors `plans` (soft delete, audit columns, plain `date`).
 *   The (project_id, lower(name)) unique index is partial on live rows, so a
 *   deleted milestone frees its name.
 * - `runs.milestone_id` is nullable with ON DELETE SET NULL, exactly like
 *   `plan_id`. The API also clears it explicitly when soft-deleting a
 *   milestone, because a soft delete never fires the FK. The partial index on
 *   `(milestone_id) where deleted_at is null` serves the list filter and the
 *   per-milestone rollups.
 *
 * Additive only: existing runs read back `milestone_id = null`, and no
 * backfill is possible or wanted. `down` drops the column (and its index)
 * first, then the table.
 */
exports.up = (pgm) => {
  pgm.createTable('milestones', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    project_id: {
      type: 'uuid',
      notNull: true,
      references: 'projects',
      onDelete: 'restrict',
    },
    name: { type: 'text', notNull: true },
    description: { type: 'text' },
    due_date: { type: 'date' },
    created_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'restrict' },
    updated_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'restrict' },
    deleted_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('milestones', ['project_id', 'lower(name)'], {
    unique: true,
    where: 'deleted_at is null',
    name: 'milestones_project_name_unique',
  });

  pgm.addColumn('runs', {
    milestone_id: {
      type: 'uuid',
      references: 'milestones',
      onDelete: 'SET NULL',
    },
  });
  pgm.createIndex('runs', ['milestone_id'], {
    where: 'deleted_at is null',
    name: 'runs_milestone_id_live',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('runs', ['milestone_id'], { name: 'runs_milestone_id_live' });
  pgm.dropColumn('runs', 'milestone_id');
  pgm.dropTable('milestones');
};