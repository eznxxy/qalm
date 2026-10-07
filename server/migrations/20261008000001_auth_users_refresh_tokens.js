/**
 * Migration 1 — auth: users + refresh_tokens.
 * Contract: docs/api-auth.md § Implementation notes.
 *
 * - users: uuid pk, email unique not null, name, role enum
 *   admin|lead|tester|viewer, password_hash, is_active bool default true,
 *   must_change_password bool, created_at/updated_at timestamptz.
 * - refresh_tokens: token_hash pk (SHA-256 hex of the 64-byte random token),
 *   user_id fk -> users, expires_at, created_at.
 */
exports.up = (pgm) => {
  pgm.createType('user_role', ['admin', 'lead', 'tester', 'viewer']);

  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    email: { type: 'text', notNull: true, unique: true },
    name: { type: 'text', notNull: true },
    role: { type: 'user_role', notNull: true },
    password_hash: { type: 'text', notNull: true },
    is_active: { type: 'boolean', notNull: true, default: true },
    must_change_password: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('refresh_tokens', {
    // 64 hex chars = SHA-256 digest; raw tokens are never stored.
    token_hash: { type: 'char(64)', primaryKey: true },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' },
    expires_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('refresh_tokens', 'user_id');
  pgm.createIndex('refresh_tokens', 'expires_at');
};

exports.down = (pgm) => {
  pgm.dropTable('refresh_tokens');
  pgm.dropTable('users');
  pgm.dropType('user_role');
};
