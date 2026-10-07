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
 * User queries shared by auth (bootstrap/login/me) and the later user
 * management module. Email comparison is case-insensitive (CITEXT-like via
 * lower()) — matching the unique-index semantics of migration 1.
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

  /**
   * Creates a user. Throws 409 CONFLICT on duplicate email. Caller supplies
   * the already-hashed password.
   */
  async create(params: {
    email: string;
    name: string;
    role: UserRole;
    passwordHash: string;
    mustChangePassword?: boolean;
  }): Promise<UserRow> {
    const existing = await this.findByEmail(params.email);
    if (existing) {
      throw new ApiError('CONFLICT', 'A user with this email already exists.');
    }
    const result = await this.db.query<UserRow>(
      `INSERT INTO users (email, name, role, password_hash, must_change_password)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${USER_COLUMNS}`,
      [
        params.email,
        params.name,
        params.role,
        params.passwordHash,
        params.mustChangePassword ?? false,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError('INTERNAL', 'User creation failed.');
    }
    return row;
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
