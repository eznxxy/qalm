import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../errors';
import { DbService } from '../db/db.service';
import { UserRole } from '../auth/current-user';

/** User resource exactly as docs/api-auth.md § User describes (snake_case). */
export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  must_change_password: boolean;
  created_at: Date;
  updated_at: Date;
}

const USER_COLUMNS =
  'id, email, name, role, is_active, must_change_password, created_at, updated_at';

export function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    is_active: row.is_active,
    must_change_password: row.must_change_password,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/** Row shape for login lookups (includes the hash; never leaves the service). */
export interface UserRowWithHash extends UserRow {
  password_hash: string;
}

/**
 * User queries shared by auth (bootstrap/login/me). Email comparison is
 * case-insensitive (CITEXT-like via lower()) — matching the unique-index
 * semantics of migration 1.
 *
 * NOTE (qalm-2b2-followup t_835b54ef): the legacy `create` once here was
 * deleted — it had no callers (only AdminUsersService.create is routed) and
 * no unique-violation catch path, so it could only ever 500 on a race.
 * User creation lives in users-admin (UsersStore.insert + AdminUsersService).
 */
@Injectable()
export class UsersService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async findByEmail(email: string): Promise<UserRow | null> {
    const result = await this.db.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users WHERE lower(email) = lower($1)`,
      [email],
    );
    return result.rows[0] ?? null;
  }

  /** Login path: also fetches password_hash for verification. */
  async findWithPasswordByEmail(email: string): Promise<UserRowWithHash | null> {
    const result = await this.db.query<UserRowWithHash>(
      `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE lower(email) = lower($1)`,
      [email],
    );
    return result.rows[0] ?? null;
  }

  /** Password-change path: fetches password_hash by id. */
  async findWithPasswordById(id: string): Promise<UserRowWithHash | null> {
    const result = await this.db.query<UserRowWithHash>(
      `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const result = await this.db.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async updateName(userId: string, name: string): Promise<UserRow> {
    const result = await this.db.query<UserRow>(
      `UPDATE users SET name = $2, updated_at = now() WHERE id = $1
       RETURNING ${USER_COLUMNS}`,
      [userId, name],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError('NOT_FOUND', 'User not found.');
    }
    return row;
  }

  /**
   * Sets a new password hash (self change or later admin reset).
   * mustChangePassword=false clears the banner (contract: self change clears).
   */
  async updatePassword(
    userId: string,
    passwordHash: string,
    mustChangePassword: boolean,
  ): Promise<UserRow> {
    const result = await this.db.query<UserRow>(
      `UPDATE users SET password_hash = $2, must_change_password = $3, updated_at = now()
       WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [userId, passwordHash, mustChangePassword],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError('NOT_FOUND', 'User not found.');
    }
    return row;
  }
}
