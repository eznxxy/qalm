import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DbService } from '../db/db.service';
import { TokensService } from './tokens.service';

export type UserRole = 'admin' | 'lead' | 'tester' | 'viewer';

export const ROLES_KEY = 'qalm_roles';
/**
 * Declares which roles may call the route. No @Roles() on a guarded route
 * means every authenticated role is allowed (contract role matrix).
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Authenticated user attached to the request by AuthGuard. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
}

interface RequestWithUser extends Request {
  authUser?: AuthUser;
}

/**
 * Cookie header parser. The scaffold has no cookie-parser dependency and the
 * contract only requires reading `qalm_refresh`, so this stays dependency-free
 * and RFC 6265-simple: `name=value` pairs separated by `;`.
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const rawValue = part.slice(eq + 1).trim();
    if (!name) continue;
    let value = rawValue;
    if (value.includes('%')) {
      try {
        value = decodeURIComponent(value);
      } catch {
        // Malformed percent-encoding: treat as literal instead of a 500.
      }
    }
    out[name] = value;
  }
  return out;
}

/** Name of the refresh cookie, docs/api-auth.md § Refresh token. */
export const REFRESH_COOKIE = 'qalm_refresh';

/** Reads the raw refresh token from the request's cookies, or null. */
export function readRefreshCookie(request: Request): string | null {
  const cookies = parseCookies(request.headers.cookie);
  return cookies[REFRESH_COOKIE] ?? null;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TokensService) private readonly tokens: TokensService,
    @Inject(DbService) private readonly db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const header = request.headers.authorization;

    let token = '';
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      token = header.slice('Bearer '.length);
    }
    const payload = token ? this.tokens.verifyAccessToken(token) : null;
    if (!payload) {
      throw this.unauthenticated();
    }

    // Contract: deactivated users are rejected immediately, even with a
    // valid, unexpired token — hence the per-request DB check.
    const result = await this.db.query<{
      id: string;
      email: string;
      name: string;
      role: UserRole;
      is_active: boolean;
      must_change_password: boolean;
    }>('SELECT id, email, name, role, is_active, must_change_password FROM users WHERE id = $1', [
      payload.sub,
    ]);
    const row = result.rows[0];
    if (!row || !row.is_active) {
      throw this.unauthenticated();
    }

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(row.role)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action.',
      });
    }

    request.authUser = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      isActive: row.is_active,
      mustChangePassword: row.must_change_password,
    };
    return true;
  }

  /** Uniform 401 body — never reveals whether the token was expired, malformed
   * or the user deactivated. */
  private unauthenticated(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'UNAUTHENTICATED',
      message: 'Missing or invalid access token.',
    });
  }
}

/** Injects the authenticated user (set by AuthGuard) into a handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.authUser;
    if (!user) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Missing or invalid access token.',
      });
    }
    return user;
  },
);

/** Injects the client IP for the login rate limiter. */
export const ClientIp = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<Request>();
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return first;
    }
    return request.socket?.remoteAddress || 'unknown';
  },
);
