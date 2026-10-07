/**
 * Migration 3 — auth-core: refresh token rotation tombstones.
 *
 * Contract: docs/api-auth.md § Refresh token — rotated tokens must be
 * detectable so reuse revokes ALL of that user's refresh tokens (replay
 * defense). The scaffold schema (migration 1) hard-deletes rotated tokens,
 * which loses exactly the state reuse-detection needs. This migration is
 * purely additive:
 *   rotated_at  — set when a token is rotated out; row is kept (tombstone)
 *                 until its expires_at passes (swept lazily on rotate).
 *   revoked_at  — set when all of a user's tokens are revoked (reuse event
 *                 or logout-all semantics); kept for audit/ forensics.
 *
 * Reversible: drops the two columns; pre-3 behavior (rows deleted on rotate)
 * is unaffected for old rows since both columns are nullable.
 */
exports.up = (pgm) => {
  pgm.addColumns('refresh_tokens', {
    rotated_at: { type: 'timestamptz' },
    revoked_at: { type: 'timestamptz' },
  });
  pgm.createIndex('refresh_tokens', 'rotated_at');
};

exports.down = (pgm) => {
  pgm.dropIndex('refresh_tokens', 'rotated_at');
  pgm.dropColumns('refresh_tokens', ['rotated_at', 'revoked_at']);
};
