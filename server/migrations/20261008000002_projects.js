/**
 * Migration 2 — projects.
 * Contract: docs/api-projects.md § Implementation notes.
 *
 * - projects: uuid pk, key unique not null, name unique not null, description
 *   text, status enum active|archived default 'active', created_by uuid fk ->
 *   users, created_at/updated_at timestamptz.
 * - Case-insensitive uniqueness via unique indexes on lower(name) / lower(key).
 * - created_by ON DELETE RESTRICT: users are never hard-deleted in MVP, and if
 *   that ever changes, project ownership must not vanish silently.
 */
exports.up = (pgm) => {
  pgm.createType('project_status', ['active', 'archived']);

  pgm.createTable('projects', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    key: { type: 'text', notNull: true },
    name: { type: 'text', notNull: true },
    description: { type: 'text' },
    status: { type: 'project_status', notNull: true, default: 'active' },
    created_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'restrict' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('projects', 'lower(name)', {
    unique: true,
    name: 'projects_name_lower_unique',
  });
  pgm.createIndex('projects', 'lower(key)', {
    unique: true,
    name: 'projects_key_lower_unique',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('projects');
  pgm.dropType('project_status');
};
