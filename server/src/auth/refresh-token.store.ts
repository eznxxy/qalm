import { Inject, Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { REFRESH_TOKEN_TTL_SECONDS, hashRefreshToken } from './tokens.service';

export interface RefreshTokenRow {
  token_hash: string;
  user_id: string;
  expires_at: Date;
  created_at: Date;
  rotated_at: Date | null;
  revoked_at: Date | null;
}

/**
 * Persistence for refresh tokens. State machine per docs/api-auth.md:
 *
 *  active     rotated_at IS NULL AND revoked_at IS NULL AND expires_at > now
 *  rotated    rotated_at IS NOT NULL (tombstone; kept for reuse detection)
 *  revoked    revoked_at IS NOT NULL
 *
 * - Presenting an ACTIVE token: consume it (mark rotated) and issue a new one.
 * - Presenting a ROTATED token: reuse -> revoke every token of that user.
 * - Rotated tombstones are swept lazily once expired so the table cannot grow
 *   unbounded in normal operation.
 */
@Injectable()
export class RefreshTokenStore {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** Inserts a fresh active token for the user. */
  async issue(
    userId: string,
    rawToken: string,
    tx?: { query(text: string, values?: unknown[]): Promise<unknown> },
  ): Promise<void> {
    const hash = hashRefreshToken(rawToken);
    const sql =
      'INSERT INTO refresh_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))';
    const values = [hash, userId, REFRESH_TOKEN_TTL_SECONDS];
    // Inside a transaction (bootstrap) the token MUST be written on the same
    // connection — the user row is not visible to other connections until
    // commit, and the FK would (correctly) fail.
    if (tx) {
      await tx.query(sql, values);
    } else {
      await this.db.query(sql, values);
    }
  }

  /** The token row for a presented raw token, if any (active or not). */
  async find(rawToken: string): Promise<RefreshTokenRow | null> {
    const hash = hashRefreshToken(rawToken);
    const result = await this.db.query<RefreshTokenRow>(
      `SELECT token_hash, user_id, expires_at, created_at, rotated_at, revoked_at
       FROM refresh_tokens WHERE token_hash = $1`,
      [hash],
    );
    return result.rows[0] ?? null;
  }

  /** Marks a token rotated-out (consumed) but keeps the row as a tombstone. */
  async markRotated(tokenHash: string): Promise<void> {
    await this.db.query('UPDATE refresh_tokens SET rotated_at = now() WHERE token_hash = $1', [
      tokenHash,
    ]);
  }

  /** Reuses happen once per user per rotation, so plain UPDATE is fine. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }

  /** Logout: revoke exactly the presented token (idempotent). */
  async revoke(tokenHash: string): Promise<void> {
    await this.db.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
      [tokenHash],
    );
  }

  /** Revokes every active token of the user (used after password change). */
  async revokeActiveForUser(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL AND rotated_at IS NULL`,
      [userId],
    );
  }

  /**
   * Deletes tombstones and revoked rows whose expiry has passed. Called on
   * rotate; failures must never break the refresh flow, hence the swallow —
   * worst case is a slightly larger table, never lost correctness.
   */
  async sweepExpired(userId: string): Promise<void> {
    try {
      await this.db.query(
        `DELETE FROM refresh_tokens
         WHERE user_id = $1 AND expires_at < now()`,
        [userId],
      );
    } catch {
      // Non-fatal by design (see docstring).
    }
  }
}
