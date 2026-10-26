/**
 * Migration 5 — cases schema (tables only; the cases endpoints land in the
 * next backend card).
 * Contract: docs/api-cases.md § Implementation notes; product rules:
 * docs/PRD-suites-cases.md § Data model.
 *
 * The suites feature needs `cases` before its own API exists: `case_count` on
 * the suite tree counts live cases in the subtree, and deleting a suite is
 * blocked when it holds cases. Rather than fake those zeros, the approved
 * schema ships now and the endpoints are built on it next.
 *
 * - project_case_counters: per-project `last_number`, row-locked by the
 *   allocator. Never `max(case_number) + 1` — numbers are never reused.
 * - cases: soft delete via `deleted_at`; the (project_id, case_number) unique
 *   index deliberately spans deleted rows too, so a number stays reserved.
 * - case_steps: ordered by `position`, cascades with a hard delete of the row
 *   (cases are not hard-deleted in the MVP; this only keeps fixtures sane).
 * - case_history: append-only audit trail with NO foreign key to cases —
 *   history outlives a soft-deleted case by design.
 */
exports.up = (pgm) => {
  pgm.createTable('project_case_counters', {
    project_id: {
      type: 'uuid',
      primaryKey: true,
      references: 'projects',
      onDelete: 'restrict',
    },
    last_number: { type: 'integer', notNull: true, default: 0 },
  });
  pgm.addConstraint('project_case_counters', 'project_case_counters_last_number_range', {
    check: 'last_number >= 0',
  });

  pgm.createTable('cases', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    project_id: {
      type: 'uuid',
      notNull: true,
      references: 'projects',
      onDelete: 'restrict',
    },
    suite_id: {
      type: 'uuid',
      // ON DELETE SET NULL, not RESTRICT: the suites contract lets a suite be
      // deleted once it has no LIVE cases, and a soft-deleted case still points
      // at its suite. Deleting the row (CASCADE) would break the "numbers and
      // history are never lost" rule, so a deleted case just loses its link.
      // The check below keeps the invariant that live cases always have one.
      references: 'suites',
      onDelete: 'set null',
    },
    case_number: { type: 'integer', notNull: true },
    title: { type: 'text', notNull: true },
    preconditions: { type: 'text' },
    priority: { type: 'text', notNull: true },
    type: { type: 'text', notNull: true },
    tags: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") },
    estimate_minutes: { type: 'integer' },
    created_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'restrict' },
    updated_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'restrict' },
    deleted_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('cases', 'cases_case_number_positive', {
    check: 'case_number >= 1',
  });
  pgm.addConstraint('cases', 'cases_estimate_minutes_range', {
    check: 'estimate_minutes is null or estimate_minutes between 0 and 10080',
  });
  // Only a soft-deleted case may lose its suite (a suite delete sets the link
  // to NULL); every live case still belongs to exactly one suite.
  pgm.addConstraint('cases', 'cases_live_suite_required', {
    check: 'deleted_at is not null or suite_id is not null',
  });

  pgm.createIndex('cases', ['project_id', 'case_number'], {
    unique: true,
    name: 'cases_project_case_number_unique',
  });
  pgm.createIndex('cases', ['project_id', 'suite_id', 'case_number'], {
    name: 'cases_project_suite_case_number_idx',
  });
  pgm.createIndex('cases', ['project_id', 'deleted_at'], {
    name: 'cases_project_deleted_at_idx',
  });
  pgm.createIndex('cases', 'tags', {
    method: 'gin',
    name: 'cases_tags_gin',
  });

  pgm.createTable('case_steps', {
    case_id: {
      type: 'uuid',
      notNull: true,
      references: 'cases',
      onDelete: 'cascade',
    },
    position: { type: 'integer', notNull: true },
    text: { type: 'text', notNull: true },
    expected_result: { type: 'text' },
  });
  pgm.addConstraint('case_steps', 'case_steps_pkey', {
    primaryKey: ['case_id', 'position'],
  });
  pgm.addConstraint('case_steps', 'case_steps_position_positive', {
    check: 'position >= 1',
  });

  pgm.createTable('case_history', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    case_id: { type: 'uuid', notNull: true },
    actor_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'restrict' },
    action: { type: 'text', notNull: true },
    changes: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // Newest-first pagination for GET /cases/:id/history; id is the tiebreaker.
  pgm.createIndex('case_history', ['case_id', { name: 'created_at', sort: 'DESC' }, { name: 'id', sort: 'DESC' }], {
    name: 'case_history_case_created_id_idx',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('case_history');
  pgm.dropTable('case_steps');
  pgm.dropTable('cases');
  pgm.dropTable('project_case_counters');
};
