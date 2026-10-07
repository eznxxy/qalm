import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { AppConfig } from '../config';
import { APP_CONFIG } from '../config.module';

/** docs/api-auth.md § Access token: HS256, 15 min, iss "qalm". */
export const ACCESS_TOKEN_TTL_SECONDS = 900;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const REFRESH_COOKIE_NAME = 'qalm_refresh';
/** Contract pins the cookie to the auth path so it is not sent elsewhere. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export interface AccessTokenPayload {
  /** user id */
  sub: string;
  role: string;
  iat: number;
  exp: number;
  iss: 'qalm';
}

export interface IssuedRefreshToken {
  /** Value that goes into the cookie — never persisted. */
  raw: string;
  /** SHA-256 hex digest — the only form stored server-side. */
  hash: string;
}

/**
 * Access (JWT) and refresh token primitives. Stateless; all persistence is in
 * RefreshTokenStore (service layer), keeping this unit-testable.
 */
@Injectable()
export class TokensService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  signAccessToken(user: { id: string; role: string }): string {
    return jwt.sign({ sub: user.id, role: user.role }, this.config.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      issuer: 'qalm',
    });
  }

  /**
   * Verifies signature, algorithm (pinned — no alg confusion), issuer and
   * expiry. Returns null for any invalid token; callers translate to 401.
   */
  verifyAccessToken(token: string): AccessTokenPayload | null {
    try {
      const payload = jwt.verify(token, this.config.jwtSecret, {
        algorithms: ['HS256'],
        issuer: 'qalm',
      });
      if (typeof payload === 'string') return null;
      const p = payload;
      if (typeof p.sub !== 'string' || typeof p['role'] !== 'string') return null;
      const role = p['role'];
      if (typeof role !== 'string') return null;
      return {
        sub: p.sub,
        role,
        iat: typeof p.iat === 'number' ? p.iat : 0,
        exp: typeof p.exp === 'number' ? p.exp : 0,
        iss: 'qalm',
      };
    } catch {
      return null;
    }
  }

  /** 64 random bytes; only the SHA-256 hex digest is ever stored. */
  generateRefreshToken(): IssuedRefreshToken {
    const raw = randomBytes(64).toString('hex');
    return { raw, hash: hashRefreshToken(raw) };
  }
}

/** SHA-256 hex of a refresh token — the form stored in refresh_tokens. */
export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Constant-time string comparison for token/secret-shaped values.
 * (Not used on password paths — bcrypt handles those.)
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still burn a comparison to keep timing flat for differing lengths.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
