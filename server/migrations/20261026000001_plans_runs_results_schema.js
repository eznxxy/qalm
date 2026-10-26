/**
 * Migration 6 — plans, runs, run items, results and result attachments.
 * Contract: docs/api-runs.md § Implementation notes; docs/api-plans.md;
 * product rules: docs/PRD-plans-runs.md § Data model.
 *
 * All five tables land together (as slice 2 landed `cases` with its parent
 * work): run/plan counts, `percent_complete` and the Linked runs feed all read
 * `results` and `run_items`, so faking those zeros in a later card would mean
 * rewriting the read queries twice. The result/attachment ENDPOINTS land in the
 * next backend card; the storage is ready now.
 *
 * - plans: soft delete via `deleted_at`; the (project_id, lower(name)) unique
 *   index is partial on live rows, so a deleted plan frees its name.
 * - runs: `plan_id` ON DELETE SET NULL (a hard-deleted plan detaches its runs);
 *   the API's plan delete sets `plan_id = null` explicitly in one transaction.
 *   `completed_at`/`completed_by` are the derived `open|completed` status.
 * - run_items: snapshot of the case (title, steps jsonb, priority, suite) so a
 *   later case edit never rewrites what the tester was asked to run. `case_id`
 *   ON DELETE SET NULL keeps the item readable if a case row is ever hard
 *   deleted. The partial unique index enforces one item per case per run.
 * - results: append-only, no `updated_at` (a result is never edited in place
 *   beyond the latest-result patch path, which reuses created_at ordering).
 *   The check makes "failed requires a comment" a database invariant too.
 * - result_attachments: metadata only; bytes live on the API server's disk
 *   (STORAGE_DIR), addressed by the generated `id` — never the filename.
 */
exports.up = (pgm) => {
  pgm.createTable('plans', {
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
  pgm.createIndex('plans', ['project_id', 'lower(name)'], {
    unique: true,
    where: 'deleted_at is null',
    name: 'plans_project_name_unique',
  });
  pgm.createIndex('plans', ['project_id', 'deleted_at'], {
    name: 'plans_project_deleted_at_idx',
  });

  pgm.createTable('runs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    project_id: {
      type: 'uuid',
      notNull: true,
      references: 'projects',
      onDelete: 'restrict',
    },
    plan_id: { type: 'uuid', references: 'plans', onDelete: 'set null' },
    name: { type: 'text', notNull: true },
    description: { type: 'text' },
    due_date: { type: 'date' },
    completed_at: { type: 'timestamptz' },
    completed_by: { type: 'uuid', references: 'users', onDelete: 'restrict' },
    created_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'restrict' },
    updated_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'restrict' },
    deleted_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('runs', 'runs_completed_pair', {
    check: '(completed_at is null) = (completed_by is null)',
  });
  pgm.createIndex('runs', ['project_id', 'deleted_at', 'created_at'], {
    name: 'runs_project_deleted_created_idx',
  });
  pgm.createIndex('runs', 'plan_id', { name: 'runs_plan_id_idx' });

  pgm.createTable('run_items', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    run_id: {
      type: 'uuid',
      notNull: true,
      references: 'runs',
      onDelete: 'cascade',
    },
    case_id: { type: 'uuid', references: 'cases', onDelete: 'set null' },
    case_display_id: { type: 'text', notNull: true },
    case_title: { type: 'text', notNull: true },
    case_steps: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    case_priority: { type: 'text', notNull: true },
    // Snapshot only — deliberately NOT a foreign key, so deleting a suite (or
    // its case) never rewrites or blocks an old run.
    case_suite_id: { type: 'uuid', notNull: true },
    assignee_id: { type: 'uuid', references: 'users', onDelete: 'set null' },
    position: { type: 'integer', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('run_items', 'run_items_position_positive', {
    check: 'position >= 1',
  });
  pgm.createIndex('run_items', ['run_id', 'case_id'], {
    unique: true,
    where: 'case_id is not null',
    name: 'run_items_run_case_unique',
  });
  pgm.createIndex('run_items', ['run_id', 'position'], {
    name: 'run_items_run_position_idx',
  });
  pgm.createIndex('run_items', 'assignee_id', { name: 'run_items_assignee_idx' });

  pgm.createTable('results', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    run_item_id: {
      type: 'uuid',
      notNull: true,
      references: 'run_items',
      onDelete: 'cascade',
    },
    status: { type: 'text', notNull: true },
    comment: { type: 'text' },
    elapsed_minutes: { type: 'integer' },
    defect_url: { type: 'text' },
    created_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'restrict' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('results', 'results_status_valid', {
    check: "status in ('passed', 'failed', 'blocked', 'retest', 'skipped')",
  });
  pgm.addConstraint('results', 'results_elapsed_minutes_range', {
    check: 'elapsed_minutes is null or elapsed_minutes between 0 and 10080',
  });
  // "failed requires a comment" is a product rule; enforce it here too so no
  // write path can bypass it.
  pgm.addConstraint('results', 'results_failed_comment_required', {
    check: "status <> 'failed' or (comment is not null and length(btrim(comment)) > 0)",
  });
  pgm.createIndex(
    'results',
    ['run_item_id', { name: 'created_at', sort: 'DESC' }, { name: 'id', sort: 'DESC' }],
    { name: 'results_item_created_id_idx' },
  );

  pgm.createTable('result_attachments', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    result_id: {
      type: 'uuid',
      notNull: true,
      references: 'results',
      onDelete: 'cascade',
    },
    filename: { type: 'text', notNull: true },
    content_type: { type: 'text', notNull: true },
    size_bytes: { type: 'bigint', notNull: true },
    // Storage key = this row's id; the original filename never becomes a path.
    storage_key: { type: 'text', notNull: true, unique: true },
    created_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'restrict' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('result_attachments', 'result_attachments_size_range', {
    check: 'size_bytes between 1 and 10485760',
  });
  pgm.createIndex('result_attachments', 'result_id', {
    name: 'result_attachments_result_idx',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('result_attachments');
  pgm.dropTable('results');
  pgm.dropTable('run_items');
  pgm.dropTable('runs');
  pgm.dropTable('plans');
};