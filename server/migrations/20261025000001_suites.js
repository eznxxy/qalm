/**
 * Migration 4 — test suites.
 * Contract: docs/api-suites.md § Implementation notes; product rules:
 * docs/PRD-suites-cases.md § Data model.
 *
 * - suites: uuid pk, project_id fk -> projects (restrict), parent_id self-fk
 *   (restrict), name, description, depth smallint check 1..3, position,
 *   created_by fk -> users, timestamps.
 * - Names are unique among siblings, case-insensitively: the expression index
 *   normalises the root group with the nil uuid because a plain unique index
 *   would let any number of NULL parents collide-free.
 * - (project_id, parent_id, position) is a plain index: the contract does not
 *   require position uniqueness (reorder rewrites the group atomically inside
 *   one transaction), it only needs to be fast to read.
 */
exports.up = (pgm) => {
  pgm.createTable('suites', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    project_id: {
      type: 'uuid',
      notNull: true,
      references: 'projects',
      onDelete: 'restrict',
    },
    parent_id: { type: 'uuid', references: 'suites', onDelete: 'restrict' },
    name: { type: 'text', notNull: true },
    description: { type: 'text' },
    depth: { type: 'smallint', notNull: true },
    position: { type: 'integer', notNull: true },
    created_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'restrict' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('suites', 'suites_depth_range', {
    check: 'depth between 1 and 3',
  });
  pgm.addConstraint('suites', 'suites_position_positive', {
    check: 'position >= 1',
  });

  pgm.createIndex(
    'suites',
    ['project_id', "coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid)", 'lower(name)'],
    { unique: true, name: 'suites_sibling_name_unique' },
  );
  pgm.createIndex('suites', ['project_id', 'parent_id', 'position'], {
    name: 'suites_project_parent_position_idx',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('suites');
};
