import { Inject, Injectable } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AppConfig } from '../config';
import { APP_CONFIG } from '../config.module';
import { ApiError } from '../errors';
import { DbService } from '../db/db.service';
import { UserDto, UsersService, toUserDto } from '../users/users.service';
import { UserRole } from './current-user';
import { PasswordService } from './password.service';
import { RateLimitService, rateLimitKey } from './rate-limit.service';
import { RefreshTokenStore } from './refresh-token.store';
import { ACCESS_TOKEN_TTL_SECONDS, TokensService } from './tokens.service';

export interface SessionResult {
  user: UserDto;
  accessToken: string;
  /** Raw refresh token for the cookie — never logged, never returned in body. */
  refreshToken: string;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

const UNAUTH_MESSAGE = 'Invalid email or password.';
const REFRESH_UNAUTH_MESSAGE = 'Missing or invalid refresh token.';

/**
 * All auth use-cases. Every 401 here is deliberately uniform (contract:
 * unknown email, wrong password and deactivated user are byte-identical).
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
    private readonly refreshTokens: RefreshTokenStore,
    private readonly rateLimit: RateLimitService,
  ) {}

  /**
   * Creates the first Admin; allowed only while zero users exist. The
   * count-check + insert runs inside one transaction guarded by an advisory
   * lock so two concurrent bootstraps cannot both win (409 for the loser).
   */
  async bootstrap(params: { name: string; email: string; password: string }): Promise<SessionResult> {
    return this.db.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('qalm_auth_bootstrap'))");
      const countResult = await client.query<{ count: string }>('SELECT count(*) AS count FROM users');
      const count = Number(countResult.rows[0]?.count ?? '0');
      if (count > 0) {
        throw new ApiError('CONFLICT', 'Bootstrap is disabled: a user already exists.');
      }
      const passwordHash = await this.passwords.hash(params.password);
      // Email is stored lowercase; lookups compare case-insensitively.
      const inserted = await client.query<{
        id: string;
        email: string;
        name: string;
        role: UserRole;
        is_active: boolean;
        must_change_password: boolean;
        created_at: Date;
        updated_at: Date;
      }>(
        `INSERT INTO users (email, name, role, password_hash, must_change_password)
         VALUES (lower($1), $2, 'admin', $3, false)
         RETURNING id, email, name, role, is_active, must_change_password, created_at, updated_at`,
        [params.email, params.name, passwordHash],
      );
      const row = inserted.rows[0];
      if (!row) {
        throw new ApiError('INTERNAL', 'Bootstrap failed to create the admin user.');
      }
      const user = toUserDto(row);
      return this.issueSession(user, client);
    });
  }

  async login(
    params: { email: string; password: string },
    clientIp: string,
  ): Promise<SessionResult> {
    const key = rateLimitKey(params.email, clientIp);
    const decision = this.rateLimit.check(key);
    if (!decision.allowed) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Too many failed login attempts. Try again later.',
          retryAfter: decision.retryAfterSeconds ?? 900,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const row = await this.users.findWithPasswordByEmail(params.email);
    if (!row) {
      // Burn a bcrypt compare so unknown-email timing matches wrong-password.
      await this.passwords.timingDummy();
      this.rateLimit.registerFailure(key);
      throw this.badCredentials();
    }
    if (!row.is_active) {
      this.rateLimit.registerFailure(key);
      throw this.badCredentials();
    }
    const passwordOk = await this.passwords.verify(params.password, row.password_hash);
    if (!passwordOk) {
      this.rateLimit.registerFailure(key);
      throw this.badCredentials();
    }

    this.rateLimit.clear(key);
    return this.issueSession(toUserDto(row));
  }

  /**
   * Rotates the presented refresh token. Any reuse of a rotated-out token
   * revokes every refresh token of that user (replay defense, contract).
   */
  async refresh(rawToken: string | null): Promise<RefreshResult> {
    if (!rawToken) {
      throw this.badRefreshToken();
    }
    const stored = await this.refreshTokens.find(rawToken);
    if (!stored || stored.revoked_at !== null) {
      throw this.badRefreshToken();
    }
    if (stored.rotated_at !== null) {
      // Reuse of a rotated token: nuke all sessions of this user.
      await this.refreshTokens.revokeAllForUser(stored.user_id);
      throw this.badRefreshToken();
    }
    if (stored.expires_at.getTime() <= Date.now()) {
      throw this.badRefreshToken();
    }
    const row = await this.users.findById(stored.user_id);
    if (!row || !row.is_active) {
      await this.refreshTokens.revokeAllForUser(stored.user_id);
      throw this.badRefreshToken();
    }

    await this.refreshTokens.markRotated(stored.token_hash);
    const issued = this.tokens.generateRefreshToken();
    await this.refreshTokens.issue(row.id, issued.raw);
    // Tombstones for this user whose expiry passed are dead weight; drop them.
    await this.refreshTokens.sweepExpired(row.id);

    return {
      accessToken: this.tokens.signAccessToken({ id: row.id, role: row.role }),
      refreshToken: issued.raw,
    };
  }

  /** Logout revokes the presented token (if still active); idempotent. */
  async logout(rawToken: string | null): Promise<void> {
    if (!rawToken) return;
    const stored = await this.refreshTokens.find(rawToken);
    if (stored && stored.rotated_at === null && stored.revoked_at === null) {
      await this.refreshTokens.revoke(stored.token_hash);
    }
  }

  async me(userId: string): Promise<UserDto> {
    const row = await this.users.findById(userId);
    if (!row || !row.is_active) {
      throw this.badCredentials();
    }
    return toUserDto(row);
  }

  /**
   * PATCH /auth/me: name change and/or password change. Password change
   * requires current_password + new_password; wrong current password is a
   * 400 VALIDATION_ERROR (contract), not 401.
   */
  async updateMe(
    userId: string,
    params: { name?: string; current_password?: string; new_password?: string },
  ): Promise<UserDto> {
    const wantsPasswordChange =
      params.new_password !== undefined || params.current_password !== undefined;
    if (wantsPasswordChange && (params.new_password === undefined || params.current_password === undefined)) {
      throw new ApiError('VALIDATION_ERROR', 'Password change requires current_password and new_password.', [
        {
          field: params.current_password === undefined ? 'current_password' : 'new_password',
          issue: 'is required when changing the password',
        },
      ]);
    }

    if (params.new_password !== undefined && params.current_password !== undefined) {
      const row = await this.users.findWithPasswordById(userId);
      if (!row) {
        throw this.badCredentials();
      }
      const currentOk = await this.passwords.verify(params.current_password, row.password_hash);
      if (!currentOk) {
        throw new ApiError('VALIDATION_ERROR', 'Current password is incorrect.', [
          { field: 'current_password', issue: 'does not match your current password' },
        ]);
      }
      await this.users.updatePassword(userId, await this.passwords.hash(params.new_password), false);
      // Hardening beyond the letter of the contract: after a password change,
      // refresh tokens issued under the old password stop working. The just
      // used access token stays valid until its short 15-min expiry.
      await this.refreshTokens.revokeActiveForUser(userId);
    }
    if (params.name !== undefined) {
      await this.users.updateName(userId, params.name);
    }
    return this.me(userId);
  }

  /** Shared session issuer: access JWT + refresh token persistence. The
   * optional client is the open bootstrap transaction — the token insert must
   * see (and commit with) the not-yet-visible user row. */
  private async issueSession(user: UserDto, client?: PoolClient): Promise<SessionResult> {
    const refreshToken = this.tokens.generateRefreshToken();
    await this.refreshTokens.issue(user.id, refreshToken.raw, client ?? undefined);
    return {
      user,
      accessToken: this.tokens.signAccessToken({ id: user.id, role: user.role }),
      refreshToken: refreshToken.raw,
    };
  }

  private badCredentials(): HttpException {
    return new HttpException(
      { code: 'UNAUTHENTICATED', message: UNAUTH_MESSAGE },
      HttpStatus.UNAUTHORIZED,
    );
  }

  private badRefreshToken(): HttpException {
    return new HttpException(
      { code: 'UNAUTHENTICATED', message: REFRESH_UNAUTH_MESSAGE },
      HttpStatus.UNAUTHORIZED,
    );
  }

  /** Exposed for tests/config surfacing; unused at runtime today. */
  get accessTokenTtlSeconds(): number {
    return ACCESS_TOKEN_TTL_SECONDS;
  }

  get cookieSecure(): boolean {
    // config.refreshCookieSecure is the documented dev-relax flag: when true,
    // the Secure attribute is dropped for plain-HTTP local development.
    return !this.config.refreshCookieSecure;
  }
}
