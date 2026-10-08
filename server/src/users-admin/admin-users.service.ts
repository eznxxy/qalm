import { Injectable } from '@nestjs/common';
import { ApiError } from '../errors';
import {
  AdminUpdateUserDto,
  CreateUserDto,
} from './dto';
import {
  AdminUserRow,
  UsersStore,
  emailConflict,
  lastAdminConflict,
} from './users.store';
import { PasswordService } from '../auth/password.service';
import { RefreshTokenStore } from '../auth/refresh-token.store';
import { AuthUser, UserRole } from '../auth/current-user';
import { ListMeta, buildListMeta } from '../projects/projects.service';

/** API projection of a user — exactly docs/api-auth.md § User (snake_case). */
export interface AdminUserDto {
  id: string;
  email: string;
  name: string;
  role: AuthUser['role'];
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
}

export function toAdminUserDto(row: AdminUserRow): AdminUserDto {
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

/**
 * Business rules for the admin user-management endpoints, docs/api-auth.md
 * § Endpoints — user management. Role enforcement (§ Role matrix: Admin only)
 * lives in the controller via @Roles('admin') + AuthGuard.
 *
 * Semantics decisions (recorded in the handoff):
 * - `password` (Admin reset) hardening beyond the letter of the contract:
 *   mirrors the self-change flow (auth service) by revoking the target's
 *   ACTIVE refresh tokens, so a session driven out by a reset is over. Only a
 *   successful password write triggers it — a pure PATCH no-op revokes nothing.
 * - The last-admin rule guards BOTH demotion and deactivation (409). A self
 *   demote/deactivate is still possible with a second admin present.
 * - No-op PATCH (`{}`) is a 200 with the current row and revokes nothing.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly store: UsersStore,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenStore,
  ) {}

  /** Admin creates a user; must_change_password=true per contract. */
  async create(dto: CreateUserDto): Promise<AdminUserDto> {
    // Pre-check names the field; the DB unique index (catch path) closes the race.
    const existing = await this.store.findIdByEmailIgnoreCase(dto.email);
    if (existing !== null) {
      throw emailConflict();
    }
    const passwordHash = await this.passwords.hash(dto.password);
    const row = await this.store.insert({
      email: dto.email,
      name: dto.name,
      role: dto.role,
      passwordHash,
      mustChangePassword: true,
    });
    return toAdminUserDto(row);
  }

  async findOne(id: string): Promise<AdminUserDto> {
    const row = await this.store.findById(id);
    if (!row) {
      throw new ApiError('NOT_FOUND', 'User not found.');
    }
    return toAdminUserDto(row);
  }

  /**
   * PATCH with any subset of name/role/is_active/password. Password reset
   * keeps must_change_password=true and revokes the target's active refresh
   * tokens (only when a password is actually written).
   *
   * `{}` is a 200 no-op (returns the current row, revokes nothing).
   * Explicit null for any field is a 400 — belt-and-braces behind the DTO
   * gate, so non-HTTP callers get the same contract error instead of a
   * PG 23502 (NOT NULL) 500. The null checks run before the last-admin
   * invariant: `role: null` must 400, never 409.
   */
  async update(id: string, dto: AdminUpdateUserDto): Promise<AdminUserDto> {
    const target = await this.store.findById(id);
    if (!target) {
      throw new ApiError('NOT_FOUND', 'User not found.');
    }

    if (dto.name === null) {
      throw new ApiError('VALIDATION_ERROR', 'Request validation failed.', [
        { field: 'name', issue: 'must be a string' },
      ]);
    }
    if (dto.role === null) {
      throw new ApiError('VALIDATION_ERROR', 'Request validation failed.', [
        { field: 'role', issue: 'must be one of: admin, lead, tester, viewer' },
      ]);
    }
    if (dto.is_active === null) {
      throw new ApiError('VALIDATION_ERROR', 'Request validation failed.', [
        { field: 'is_active', issue: 'must be a boolean value' },
      ]);
    }
    if (dto.password === null) {
      throw new ApiError('VALIDATION_ERROR', 'Request validation failed.', [
        { field: 'password', issue: 'must be a string' },
      ]);
    }

    // Last-admin invariant FIRST, against the target's CURRENT state:
    // demotion or deactivation must leave >= 1 OTHER active admin (or the
    // target keeps its current role/activity — see guard conditions below).
    const roleWillLeaveAdmin =
      dto.role !== undefined &&
      dto.role !== 'admin' &&
      target.role === 'admin' &&
      target.is_active;
    const deactivateWillKillLastAdmin =
      dto.is_active === false &&
      target.is_active &&
      target.role === 'admin';
    if (roleWillLeaveAdmin || deactivateWillKillLastAdmin) {
      const others = await this.store.countActiveAdmins(id);
      if (others === 0) {
        throw lastAdminConflict(
          deactivateWillKillLastAdmin && !roleWillLeaveAdmin
            ? 'deactivate'
            : 'demote',
        );
      }
    }

    const fields: {
      name?: string;
      role?: UserRole;
      is_active?: boolean;
      passwordHash?: string;
      mustChangePassword?: boolean;
    } = {};
    if (dto.name !== undefined) fields.name = dto.name;
    if (dto.role !== undefined) fields.role = dto.role;
    if (dto.is_active !== undefined) fields.is_active = dto.is_active;
    if (dto.password !== undefined) {
      fields.passwordHash = await this.passwords.hash(dto.password);
      // Contract: Admin reset sets must_change_password=true on the target.
      fields.mustChangePassword = true;
    }

    const updated = await this.store.update(id, fields);
    if (!updated) {
      throw new ApiError('NOT_FOUND', 'User not found.');
    }

    // Only a real password write ends the target's active refresh sessions
    // (same rationale as the self-change hardening in auth). Everything else —
    // including a pure no-op PATCH — revokes nothing.
    if (fields.passwordHash !== undefined) {
      await this.refreshTokens.revokeActiveForUser(id);
    }
    return toAdminUserDto(updated);
  }

  /** Listing with substring search, optional role filter, pagination. */
  async list(q: {
    query?: string;
    role?: AuthUser['role'];
    page?: number;
    limit?: number;
  }): Promise<{ data: AdminUserDto[]; meta: ListMeta }> {
    const page = q.page ?? 1;
    const limit = q.limit ?? 25;
    const query = q.query ?? null;
    const role = q.role ?? null;
    // Meta counts the exact same filtered view `data` renders.
    const total = await this.store.countForList({ query, role });
    const rows = await this.store.listPage({
      query,
      role,
      limit,
      offset: (page - 1) * limit,
    });
    return {
      data: rows.map(toAdminUserDto),
      meta: buildListMeta(total, page, limit),
    };
  }
}
