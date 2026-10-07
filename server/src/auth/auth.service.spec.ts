import { Test } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ApiError } from '../errors';
import { APP_CONFIG } from '../config.module';
import { AppConfig } from '../config';
import { DbService } from '../db/db.service';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { RateLimitService } from './rate-limit.service';
import { RefreshTokenStore } from './refresh-token.store';
import { TokensService } from './tokens.service';
import { UsersService } from '../users/users.service';

const CONFIG: AppConfig = {
  port: 0,
  databaseUrl: 'postgres://test@localhost/test',
  jwtSecret: 'unit-test-secret-that-is-definitely-32b',
  refreshCookieSecure: false,
};

interface FakeUser {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

interface FakeToken {
  token_hash: string;
  user_id: string;
  expires_at: Date;
  rotated_at: Date | null;
  revoked_at: Date | null;
}

/**
 * Decision-logic tests for AuthService over a precise in-memory fake of the
 * two tables involved. SQL semantics mirrored here: uniform 401s, rate
 * limiting, rotation tombstones and reuse-revoke. Real SQL is covered by the
 * integration suite (auth.e2e-spec.ts).
 */
describe('AuthService (unit, in-memory tables)', () => {
  let service: AuthService;
  let passwords: PasswordService;
  let tokens: TokensService;
  let users: FakeUser[];
  let refreshTokens: FakeToken[];
  let rateLimit: RateLimitService;

  const FIXTURE_PASSWORD = 'Correct-Horse1';

  const withoutPasswordHash = (user: FakeUser): Record<string, unknown> => {
    const copy: Record<string, unknown> = { ...user };
    delete copy['password_hash'];
    return copy;
  };

  beforeEach(async () => {
    users = [];
    refreshTokens = [];

    const respond = (text: string, values: unknown[]): { rows: unknown[] } => {
      const t = text.replace(/\s+/g, ' ');
      if (t.includes('FROM users WHERE lower(email)')) {
        const email = String(values[0]).toLowerCase();
        const found = users.filter((u) => u.email.toLowerCase() === email);
        if (t.includes('password_hash')) return { rows: found };
        return { rows: found.map(withoutPasswordHash) };
      }
      if (t.includes('FROM users WHERE id')) {
        const found = users.filter((u) => u.id === values[0]);
        if (t.includes('password_hash')) return { rows: found };
        return { rows: found.map(withoutPasswordHash) };
      }
      if (t.startsWith('UPDATE users SET name')) {
        const target = users.find((u) => u.id === values[0]);
        if (target) {
          target.name = String(values[1]);
          target.updated_at = new Date();
        }
        return { rows: target ? [withoutPasswordHash(target)] : [] };
      }
      if (t.startsWith('UPDATE users SET password_hash')) {
        const target = users.find((u) => u.id === values[0]);
        if (target) {
          target.password_hash = String(values[1]);
          target.must_change_password = Boolean(values[2]);
          target.updated_at = new Date();
        }
        return { rows: target ? [withoutPasswordHash(target)] : [] };
      }
      if (t.startsWith('INSERT INTO refresh_tokens')) {
        const seconds = Number(values[2]);
        refreshTokens.push({
          token_hash: String(values[0]),
          user_id: String(values[1]),
          expires_at: new Date(Date.now() + seconds * 1000),
          rotated_at: null,
          revoked_at: null,
        });
        return { rows: [] };
      }
      if (t.includes('FROM refresh_tokens WHERE token_hash')) {
        return { rows: refreshTokens.filter((tok) => tok.token_hash === values[0]) };
      }
      if (t.startsWith('UPDATE refresh_tokens SET rotated_at')) {
        const target = refreshTokens.find((tok) => tok.token_hash === values[0]);
        if (target) target.rotated_at = new Date();
        return { rows: [] };
      }
      if (t.startsWith('UPDATE refresh_tokens SET revoked_at')) {
        const onlyActive = t.includes('AND rotated_at IS NULL');
        const byUser = t.includes('WHERE user_id');
        for (const tok of refreshTokens) {
          if (tok.revoked_at !== null) continue;
          if (byUser && tok.user_id !== values[0]) continue;
          if (!byUser && tok.token_hash !== values[0]) continue;
          if (onlyActive && tok.rotated_at !== null) continue;
          tok.revoked_at = new Date();
        }
        return { rows: [] };
      }
      if (t.startsWith('DELETE FROM refresh_tokens')) {
        refreshTokens = refreshTokens.filter(
          (tok) => tok.user_id !== values[0] || tok.expires_at.getTime() > Date.now(),
        );
        return { rows: [] };
      }
      throw new Error(`Fake DbService: unhandled SQL: ${text}`);
    };

    const db = {
      query: (text: string, values: unknown[] = []): Promise<{ rows: unknown[] }> =>
        Promise.resolve(respond(text, values)),
    };

    passwords = new PasswordService();
    rateLimit = new RateLimitService();
    tokens = new TokensService(CONFIG);

    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: APP_CONFIG, useValue: CONFIG },
        { provide: DbService, useValue: db },
        { provide: PasswordService, useValue: passwords },
        { provide: RateLimitService, useValue: rateLimit },
        { provide: TokensService, useValue: tokens },
        RefreshTokenStore,
        UsersService,
        AuthService,
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  async function seedActiveUser(overrides: Partial<FakeUser> = {}): Promise<FakeUser> {
    const user: FakeUser = {
      id: 'u-1',
      email: 'ada@example.com',
      name: 'Ada',
      role: 'admin',
      is_active: true,
      must_change_password: false,
      password_hash: await passwords.hash(FIXTURE_PASSWORD),
      created_at: new Date(0),
      updated_at: new Date(0),
      ...overrides,
    };
    users.push(user);
    return user;
  }

  const httpErrorOf = async (promise: Promise<unknown>): Promise<HttpException> =>
    promise.then(
      () => {
        throw new Error('expected the promise to reject');
      },
      (e: unknown) => e as HttpException,
    );

  const apiErrorOf = async (promise: Promise<unknown>): Promise<ApiError> =>
    promise.then(
      () => {
        throw new Error('expected the promise to reject');
      },
      (e: unknown) => e as ApiError,
    );

  describe('login', () => {
    it('accepts valid credentials and returns user + tokens', async () => {
      await seedActiveUser();
      const session = await service.login({ email: 'ada@example.com', password: FIXTURE_PASSWORD }, 'ip1');
      expect(session.user.email).toBe('ada@example.com');
      expect(session.user).not.toHaveProperty('password_hash');
      expect(tokens.verifyAccessToken(session.accessToken)?.sub).toBe('u-1');
      expect(session.refreshToken).toMatch(/^[0-9a-f]{128}$/);
    });

    it('login email match is case-insensitive', async () => {
      await seedActiveUser({ email: 'ADA@Example.com' });
      const session = await service.login({ email: 'ada@example.com', password: FIXTURE_PASSWORD }, 'ip1');
      expect(session.user.id).toBe('u-1');
    });

    it('unknown email -> same 401 envelope as wrong password', async () => {
      await seedActiveUser();
      const unknownEmail = await httpErrorOf(service.login({ email: 'ghost@x.com', password: FIXTURE_PASSWORD }, 'ip1'));
      const wrongPassword = await httpErrorOf(
        service.login({ email: 'ada@example.com', password: 'wrong-wrong1' }, 'ip-other'),
      );
      expect(unknownEmail.getStatus()).toBe(401);
      expect(wrongPassword.getStatus()).toBe(401);
      expect(unknownEmail.getResponse()).toEqual(wrongPassword.getResponse());
    });

    it('deactivated user -> same 401 envelope (no account-state leak)', async () => {
      await seedActiveUser({ is_active: false });
      const deactivated = await httpErrorOf(service.login({ email: 'ada@example.com', password: FIXTURE_PASSWORD }, 'ip1'));
      expect(deactivated.getStatus()).toBe(401);
      const wrongPassword = await httpErrorOf(
        service.login({ email: 'nobody@x.com', password: 'wrong-wrong1' }, 'ip2'),
      );
      expect(deactivated.getResponse()).toEqual(wrongPassword.getResponse());
    });

    it('10 failures per email+IP trigger 429 with Retry-After; another IP is unaffected', async () => {
      await seedActiveUser();
      // Semantics (api-auth.md): the 429 fires once 10 failed attempts exist
      // in the window — so the 10th attempt still gets a real 401, and every
      // attempt after it is rate-limited until the window slides.
      for (let i = 0; i < 10; i++) {
        const err = await httpErrorOf(service.login({ email: 'ada@example.com', password: 'wrong-wrong1' }, '9.9.9.9'));
        expect(err.getStatus()).toBe(401);
      }
      const limited = await httpErrorOf(service.login({ email: 'ada@example.com', password: FIXTURE_PASSWORD }, '9.9.9.9'));
      expect(limited.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect((limited.getResponse() as Record<string, unknown>)['retryAfter']).toBeGreaterThan(0);
      // Same email, different IP: not limited.
      await expect(service.login({ email: 'ada@example.com', password: FIXTURE_PASSWORD }, '8.8.8.8')).resolves.toBeTruthy();
    }, 30000);

    it('a successful login clears prior failures (window must hold <10 for that)', async () => {
      await seedActiveUser();
      for (let i = 0; i < 9; i++) {
        await httpErrorOf(service.login({ email: 'ada@example.com', password: 'wrong-wrong1' }, '7.7.7.7'));
      }
      // Success clears the 9 failures...
      await expect(service.login({ email: 'ada@example.com', password: FIXTURE_PASSWORD }, '7.7.7.7')).resolves.toBeTruthy();
      // ...so 9 further failures are still under the limit...
      for (let i = 0; i < 9; i++) {
        const err = await httpErrorOf(service.login({ email: 'ada@example.com', password: 'wrong-wrong1' }, '7.7.7.7'));
        expect(err.getStatus()).toBe(401);
      }
      // ...the 10th failure lands, and everything after it is 429.
      await httpErrorOf(service.login({ email: 'ada@example.com', password: 'wrong-wrong1' }, '7.7.7.7'));
      const blocked = await httpErrorOf(service.login({ email: 'ada@example.com', password: FIXTURE_PASSWORD }, '7.7.7.7'));
      expect(blocked.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }, 45000);

    it('after 10 failures even the CORRECT password is rate-limited until the window slides', async () => {
      // Documented consequence of the contract-literal reading: 10 failed
      // attempts in 15 min -> that email+IP is locked out of the limiter.
      await seedActiveUser();
      for (let i = 0; i < 10; i++) {
        await httpErrorOf(service.login({ email: 'ada@example.com', password: 'wrong-wrong1' }, '6.6.6.6'));
      }
      const correct = await httpErrorOf(service.login({ email: 'ada@example.com', password: FIXTURE_PASSWORD }, '6.6.6.6'));
      expect(correct.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }, 30000);
  });

  describe('refresh rotation and reuse defense', () => {
    it('rotates tokens; reusing the rotated one revokes ALL tokens of that user', async () => {
      await seedActiveUser();
      const session = await service.login({ email: 'ada@example.com', password: FIXTURE_PASSWORD }, 'ip1');

      const first = await service.refresh(session.refreshToken);
      expect(first.refreshToken).not.toBe(session.refreshToken);
      expect(tokens.verifyAccessToken(first.accessToken)?.sub).toBe('u-1');

      // Tombstone row still exists, marked rotated.
      const tombstones = refreshTokens.filter((tok) => tok.rotated_at !== null);
      expect(tombstones).toHaveLength(1);

      // Reuse -> 401 AND the brand-new token is dead too.
      const reuse = await httpErrorOf(service.refresh(session.refreshToken));
      expect(reuse.getStatus()).toBe(401);
      const afterRevoke = await httpErrorOf(service.refresh(first.refreshToken));
      expect(afterRevoke.getStatus()).toBe(401);
      expect(refreshTokens.every((tok) => tok.revoked_at !== null)).toBe(true);
    });

    it('missing and unknown tokens produce the same 401', async () => {
      const missing = await httpErrorOf(service.refresh(null));
      const unknown = await httpErrorOf(service.refresh('f'.repeat(128)));
      expect(missing.getStatus()).toBe(401);
      expect(unknown.getStatus()).toBe(401);
      expect(missing.getResponse()).toEqual(unknown.getResponse());
    });

    it('logout revokes exactly the presented token; idempotent; null-safe', async () => {
      await seedActiveUser();
      const session = await service.login({ email: 'ada@example.com', password: FIXTURE_PASSWORD }, 'ip1');
      await service.logout(session.refreshToken);
      await expect(service.refresh(session.refreshToken)).rejects.toMatchObject({ status: 401 });
      await expect(service.logout(session.refreshToken)).resolves.toBeUndefined();
      await expect(service.logout(null)).resolves.toBeUndefined();
    });
  });

  describe('updateMe', () => {
    it('changes the name; clears must_change_password on password change', async () => {
      await seedActiveUser({ must_change_password: true });
      const renamed = await service.updateMe('u-1', { name: 'Ada Lovelace' });
      expect(renamed.name).toBe('Ada Lovelace');
      expect(renamed.must_change_password).toBe(true); // untouched by name change

      const changed = await service.updateMe('u-1', {
        current_password: FIXTURE_PASSWORD,
        new_password: 'brand-new-Pw1',
      });
      expect(changed.must_change_password).toBe(false);
      expect(await passwords.verify('brand-new-Pw1', users[0]?.password_hash ?? '')).toBe(true);
    });

    it('wrong current password -> 400 VALIDATION_ERROR with field detail', async () => {
      await seedActiveUser();
      const error = await apiErrorOf(
        service.updateMe('u-1', { current_password: 'totally-wrong1', new_password: 'brand-new-Pw1' }),
      );
      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(400);
      expect(error.toEnvelope()).toMatchObject({
        error: { code: 'VALIDATION_ERROR', details: [{ field: 'current_password' }] },
      });
    });

    it('half-specified password change -> 400', async () => {
      await seedActiveUser();
      const first = await apiErrorOf(service.updateMe('u-1', { new_password: 'brand-new-Pw1' }));
      const second = await apiErrorOf(service.updateMe('u-1', { current_password: FIXTURE_PASSWORD }));
      expect(first.status).toBe(400);
      expect(second.status).toBe(400);
    });

    it('password change revokes the user\'s active refresh tokens', async () => {
      await seedActiveUser();
      const session = await service.login({ email: 'ada@example.com', password: FIXTURE_PASSWORD }, 'ip1');
      await service.updateMe('u-1', { current_password: FIXTURE_PASSWORD, new_password: 'brand-new-Pw1' });
      await expect(service.refresh(session.refreshToken)).rejects.toMatchObject({ status: 401 });
      // New login with the new password works.
      await expect(
        service.login({ email: 'ada@example.com', password: 'brand-new-Pw1' }, 'ip1'),
      ).resolves.toBeTruthy();
    });
  });
});
