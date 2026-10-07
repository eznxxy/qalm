import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import {
  createTestApp,
  resetDb,
  resetRateLimit,
  refreshCookieOf,
  SHARED_FIXTURE_PASSWORD,
  TestApp,
} from './helpers';
import { UserRole } from '../src/auth/current-user';

/**
 * Integration: the admin user-management contract, docs/api-auth.md
 * § Endpoints — user management + § Role matrix, against the real scratch
 * database (migrations applied) through the production HTTP wiring.
 * Last-admin, must_change_password and token-rejection semantics are
 * exercised end-to-end (login/refresh round-trips included).
 *
 * Timeout note: this suite issues several real bcrypt(12) hashes per test
 * (4 seeded fixtures + 4 logins in beforeEach, plus Admin-API creates that
 * hash again). bcrypt(12) is contractually expensive, so the suite allows
 * 30 s per hook/test instead of jest's 5 s default — an accommodation of
 * real crypto cost on a shared box, not a weakened assertion.
 */
jest.setTimeout(30000);
interface UserData {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
}

interface ListMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

const dataOf = (res: request.Response): UserData => res.body.data as UserData;
const listOf = (res: request.Response): UserData[] => res.body.data as UserData[];
const metaOf = (res: request.Response): ListMeta => res.body.meta as ListMeta;
/** First list row with a fixture-style guard (listings are never empty here). */
const firstUser = (res: request.Response): UserData => {
  const user = listOf(res)[0];
  if (!user) throw new Error('fixture expected a non-empty user list');
  return user;
};

describe('Admin user management API (integration)', () => {
  let test: TestApp;
  const tokens: Partial<Record<UserRole, string>> = {};
  /**
   * One bcrypt(12) hash of SHARED_FIXTURE_PASSWORD, computed once per suite.
   * All four role fixtures share the same known password, so they can share
   * one hash: this cuts the per-test fixture cost from 8 bcrypt ops
   * (4 seeds + 4 login verifies) to 4 verifies, which keeps the suite stable
   * on a loaded box. Tokens still come from the real login path; the
   * Admin-created users in each test still hash for real through the API.
   */
  let fixtureHash = '';

  const as = (role: UserRole): { Authorization: string } => ({
    Authorization: `Bearer ${tokens[role]}`,
  });

  beforeAll(async () => {
    test = await createTestApp();
    fixtureHash = bcrypt.hashSync(SHARED_FIXTURE_PASSWORD, 12);
  });

  afterAll(async () => {
    if (test) await test.close();
  });

  beforeEach(async () => {
    await resetDb(test.db);
    resetRateLimit(test.app);
    // One real user per role; tokens come from the real login path.
    for (const role of ['admin', 'lead', 'tester', 'viewer'] as UserRole[]) {
      const email = `${role}@example.com`;
      await test.db.query(
        `INSERT INTO users (email, name, role, password_hash, is_active, must_change_password)
         VALUES ($1, $2, $3, $4, true, false)`,
        [email, `${role} User`, role, fixtureHash],
      );
      const res = await test.req
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '203.0.113.50')
        .send({ email, password: SHARED_FIXTURE_PASSWORD });
      const token = res.body?.data?.access_token;
      if (typeof token !== 'string') {
        throw new Error(`login fixture failed for ${role}: ${res.status}`);
      }
      tokens[role] = token;
    }
  });

  /** Creates a user through the Admin API (the contract path). */
  const createUser = (
    body: Record<string, unknown>,
    role: UserRole = 'admin',
  ) => test.req.post('/api/v1/users').set(as(role)).send(body);

  const VALID_CREATE = {
    email: 'grace@example.com',
    name: 'Grace Hopper',
    role: 'tester',
    password: 'temporal1',
  };
  /** Initial password for every Admin-created fixture (real known value). */
  const VALID_CREATE_PASSWORD = VALID_CREATE.password;

  describe('GET /api/v1/users', () => {
    it('lists users sorted by email ascending with the pagination envelope', async () => {
      const res = await test.req.get('/api/v1/users').set(as('admin'));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(4);
      expect(listOf(res).map((u) => u.email)).toEqual([
        'admin@example.com',
        'lead@example.com',
        'tester@example.com',
        'viewer@example.com',
      ]);
      expect(metaOf(res)).toEqual({ page: 1, limit: 25, total: 4, total_pages: 1 });
      for (const user of listOf(res)) {
        expect(Object.keys(user).sort()).toEqual([
          'created_at',
          'email',
          'id',
          'is_active',
          'must_change_password',
          'name',
          'role',
          'updated_at',
        ]);
        expect(user).not.toHaveProperty('password_hash');
      }
    });

    it('searches by email substring, case-insensitively', async () => {
      const res = await test.req
        .get('/api/v1/users')
        .query({ query: 'LEAD@' })
        .set(as('admin'));
      expect(res.status).toBe(200);
      expect(listOf(res).map((u) => u.email)).toEqual(['lead@example.com']);
      expect(metaOf(res).total).toBe(1);
    });

    it('searches by name substring too', async () => {
      const res = await test.req
        .get('/api/v1/users')
        .query({ query: 'viewer user' })
        .set(as('admin'));
      expect(res.status).toBe(200);
      expect(listOf(res).map((u) => u.email)).toEqual(['viewer@example.com']);
    });

    it('LIKE wildcards in the search are literal', async () => {
      await createUser({ ...VALID_CREATE, email: 'a_b@example.com', name: 'Underscore' });
      const res = await test.req
        .get('/api/v1/users')
        .query({ query: 'a_b' })
        .set(as('admin'));
      expect(listOf(res).map((u) => u.email)).toEqual(['a_b@example.com']);
    });

    it('filters by role and combines with search', async () => {
      const leads = await test.req
        .get('/api/v1/users')
        .query({ role: 'lead' })
        .set(as('admin'));
      expect(listOf(leads).map((u) => u.email)).toEqual(['lead@example.com']);

      const none = await test.req
        .get('/api/v1/users')
        .query({ query: 'admin', role: 'viewer' })
        .set(as('admin'));
      expect(none.status).toBe(200);
      expect(listOf(none)).toEqual([]);
      expect(metaOf(none)).toEqual({ page: 1, limit: 25, total: 0, total_pages: 1 });
    });

    it('rejects an unknown role filter with 400 (contract-literal whitelist)', async () => {
      const res = await test.req
        .get('/api/v1/users')
        .query({ role: 'Admin' })
        .set(as('admin'));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'role' })]),
      );
    });

    it('paginates: page/limit respected, meta consistent, beyond-last empty', async () => {
      await createUser({ ...VALID_CREATE });
      await createUser({ ...VALID_CREATE, email: 'ada@example.com', name: 'Ada' });
      await createUser({ ...VALID_CREATE, email: 'linus@example.com', name: 'Linus' });

      const page1 = await test.req
        .get('/api/v1/users')
        .query({ page: 1, limit: 3 })
        .set(as('admin'));
      expect(listOf(page1).map((u) => u.email)).toEqual([
        'ada@example.com',
        'admin@example.com',
        'grace@example.com',
      ]);
      expect(metaOf(page1)).toEqual({ page: 1, limit: 3, total: 7, total_pages: 3 });

      const page2 = await test.req
        .get('/api/v1/users')
        .query({ page: 2, limit: 3 })
        .set(as('admin'));
      expect(listOf(page2).map((u) => u.email)).toEqual([
        'lead@example.com',
        'linus@example.com',
        'tester@example.com',
      ]);

      const beyond = await test.req
        .get('/api/v1/users')
        .query({ page: 4, limit: 3 })
        .set(as('admin'));
      expect(listOf(beyond)).toEqual([]);
      expect(metaOf(beyond).total).toBe(7);
    });

    it('rejects out-of-bounds pagination with 400 + details', async () => {
      for (const query of ['page=0', 'limit=0', 'limit=101', 'limit=abc']) {
        const res = await test.req.get(`/api/v1/users?${query}`).set(as('admin'));
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('401 without a token; 403 for every non-Admin role', async () => {
      const anon = await test.req.get('/api/v1/users');
      expect(anon.status).toBe(401);
      expect(anon.body.error.code).toBe('UNAUTHENTICATED');

      for (const role of ['lead', 'tester', 'viewer'] as UserRole[]) {
        const res = await test.req.get('/api/v1/users').set(as(role));
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    });
  });

  describe('POST /api/v1/users', () => {
    it('creates a user: 201, must_change_password=true, no hash leaked', async () => {
      const res = await createUser(VALID_CREATE);
      expect(res.status).toBe(201);
      const user = dataOf(res);
      expect(user).toMatchObject({
        email: 'grace@example.com',
        name: 'Grace Hopper',
        role: 'tester',
        is_active: true,
        must_change_password: true,
      });
      expect(user).not.toHaveProperty('password_hash');
      expect(typeof user.id).toBe('string');
      expect(user.created_at).toBe(user.updated_at);
    });

    it('stores the email lowercase (case-insensitive login afterwards)', async () => {
      const created = await createUser({ ...VALID_CREATE, email: 'Grace@Example.COM' });
      expect(dataOf(created).email).toBe('grace@example.com');

      const login = await test.req.post('/api/v1/auth/login').send({
        email: 'grace@example.com',
        password: 'temporal1',
      });
      expect(login.status).toBe(200);
    });

    it('409 CONFLICT on a case-insensitive duplicate email', async () => {
      await createUser(VALID_CREATE);
      const res = await createUser({ ...VALID_CREATE, email: 'GRACE@example.com' });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: {
          code: 'CONFLICT',
          message: expect.any(String),
          details: [{ field: 'email', issue: 'already in use' }],
        },
      });
    });

    it('400 VALIDATION_ERROR for invalid email, weak password, unknown role', async () => {
      const badEmail = await createUser({ ...VALID_CREATE, email: 'nope' });
      expect(badEmail.status).toBe(400);
      expect(badEmail.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'email' })]),
      );

      const weak = await createUser({ ...VALID_CREATE, password: 'short' });
      expect(weak.status).toBe(400);
      expect(weak.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'password' })]),
      );

      const badRole = await createUser({ ...VALID_CREATE, role: 'superuser' });
      expect(badRole.status).toBe(400);
      expect(badRole.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'role' })]),
      );
    });

    it('rejects mass-assignment of must_change_password (Admin cannot preset it)', async () => {
      const res = await createUser({ ...VALID_CREATE, must_change_password: false });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'must_change_password' })]),
      );
    });

    it('403 for every non-Admin role', async () => {
      for (const role of ['lead', 'tester', 'viewer'] as UserRole[]) {
        const res = await createUser(VALID_CREATE, role);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    });
  });

  describe('GET /api/v1/users/:id', () => {
    it('returns the user by id', async () => {
      const created = await createUser(VALID_CREATE);
      const res = await test.req.get(`/api/v1/users/${dataOf(created).id}`).set(as('admin'));
      expect(res.status).toBe(200);
      expect(dataOf(res).email).toBe('grace@example.com');
    });

    it('404 for an unknown id; 400 for a malformed uuid', async () => {
      // The nil UUID can never collide with a fixture id (fresh TRUNCATE per
      // test), so it is a valid-but-absent id with no seeding needed.
      const missing = await test.req.get('/api/v1/users/00000000-0000-0000-0000-000000000000').set(as('admin'));
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('NOT_FOUND');

      const malformed = await test.req.get('/api/v1/users/not-a-uuid').set(as('admin'));
      expect(malformed.status).toBe(400);
      expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('403 for every non-Admin role', async () => {
      const created = await createUser(VALID_CREATE);
      const id = dataOf(created).id;
      for (const role of ['lead', 'tester', 'viewer'] as UserRole[]) {
        const res = await test.req.get(`/api/v1/users/${id}`).set(as(role));
        expect(res.status).toBe(403);
      }
    });
  });

  describe('PATCH /api/v1/users/:id', () => {
    it('changes name and role', async () => {
      const created = await createUser(VALID_CREATE);
      const id = dataOf(created).id;
      const res = await test.req
        .patch(`/api/v1/users/${id}`)
        .set(as('admin'))
        .send({ name: 'Grace Brewster Hopper', role: 'lead' });
      expect(res.status).toBe(200);
      expect(dataOf(res)).toMatchObject({
        name: 'Grace Brewster Hopper',
        role: 'lead',
        email: 'grace@example.com',
      });
    });

    it('empty PATCH is a 200 no-op', async () => {
      const created = await createUser(VALID_CREATE);
      const res = await test.req
        .patch(`/api/v1/users/${dataOf(created).id}`)
        .set(as('admin'))
        .send({});
      expect(res.status).toBe(200);
      expect(dataOf(res).name).toBe('Grace Hopper');
    });

    it('400 for an unknown role; 404 for an unknown id', async () => {
      const created = await createUser(VALID_CREATE);
      const id = dataOf(created).id;
      const badRole = await test.req
        .patch(`/api/v1/users/${id}`)
        .set(as('admin'))
        .send({ role: 'root' });
      expect(badRole.status).toBe(400);

      const missing = await test.req
        .patch('/api/v1/users/00000000-0000-0000-0000-000000000000')
        .set(as('admin'))
        .send({ name: 'Nobody' });
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('NOT_FOUND');
    });

    it('password reset: must_change_password=true, old password dies, new one logs in', async () => {
      const created = await createUser(VALID_CREATE);
      const id = dataOf(created).id;
      const res = await test.req
        .patch(`/api/v1/users/${id}`)
        .set(as('admin'))
        .send({ password: 'resetpw1' });
      expect(res.status).toBe(200);
      expect(dataOf(res).must_change_password).toBe(true);

      const oldLogin = await test.req
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '203.0.113.77')
        .send({ email: 'grace@example.com', password: 'temporal1' });
      expect(oldLogin.status).toBe(401);

      const newLogin = await test.req
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '203.0.113.77')
        .send({ email: 'grace@example.com', password: 'resetpw1' });
      expect(newLogin.status).toBe(200);

      // The user clears the banner with a real self password change.
      const selfChange = await test.req
        .patch('/api/v1/auth/me')
        .set(as('tester'))
        .set('Authorization', `Bearer ${newLogin.body.data.access_token}`)
        .send({ current_password: 'resetpw1', new_password: 'freshpw99' });
      expect(selfChange.status).toBe(200);

      const detail = await test.req.get(`/api/v1/users/${id}`).set(as('admin'));
      expect(dataOf(detail).must_change_password).toBe(false);
    });

    it('a password reset revokes the target refresh session; a name-only PATCH does not', async () => {
      const created = await createUser(VALID_CREATE);
      const id = dataOf(created).id;
      const login = await test.req
        .post('/api/v1/auth/login')
        .send({ email: 'grace@example.com', password: 'temporal1' });
      const cookie = refreshCookieOf(login);
      expect(cookie).toBeDefined();

      const noop = await test.req
        .patch(`/api/v1/users/${id}`)
        .set(as('admin'))
        .send({ name: 'Grace G.' });
      expect(noop.status).toBe(200);
      const stillAlive = await test.req
        .post('/api/v1/auth/refresh')
        .set('Cookie', `qalm_refresh=${cookie}`);
      expect(stillAlive.status).toBe(200);

      await test.req
        .patch(`/api/v1/users/${id}`)
        .set(as('admin'))
        .send({ password: 'resetpw1' });
      const after = await test.req
        .post('/api/v1/auth/refresh')
        .set('Cookie', `qalm_refresh=${cookie}`);
      expect(after.status).toBe(401);
      expect(after.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('deactivation: login 401s, the unexpired access token is rejected immediately, no hard delete', async () => {
      const created = await createUser(VALID_CREATE);
      const id = dataOf(created).id;
      const login = await test.req
        .post('/api/v1/auth/login')
        .send({ email: 'grace@example.com', password: 'temporal1' });
      const accessToken = login.body.data.access_token;
      expect(accessToken).toBeTruthy();

      const res = await test.req
        .patch(`/api/v1/users/${id}`)
        .set(as('admin'))
        .send({ is_active: false });
      expect(res.status).toBe(200);
      expect(dataOf(res).is_active).toBe(false);

      // Contract: tokens of deactivated users are rejected before exp.
      const me = await test.req.get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
      expect(me.status).toBe(401);

      const relogin = await test.req
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '203.0.113.88')
        .send({ email: 'grace@example.com', password: 'temporal1' });
      expect(relogin.status).toBe(401);

      // Soft delete only: the row is still there and re-activatable.
      const listed = await test.req
        .get('/api/v1/users')
        .query({ query: 'grace' })
        .set(as('admin'));
      expect(listed.status).toBe(200);
      expect(listOf(listed).map((u) => u.is_active)).toEqual([false]);

      const revived = await test.req
        .patch(`/api/v1/users/${id}`)
        .set(as('admin'))
        .send({ is_active: true });
      expect(revived.status).toBe(200);
      expect(dataOf(revived).is_active).toBe(true);
    });

    describe('last-active-Admin invariant', () => {
      it('409 demoting the only active admin', async () => {
        const admin = firstUser(
          await test.req.get('/api/v1/users').query({ role: 'admin' }).set(as('admin')),
        );
        const res = await test.req
          .patch(`/api/v1/users/${admin.id}`)
          .set(as('admin'))
          .send({ role: 'lead' });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('CONFLICT');

        // Nothing changed.
        const after = await test.req.get(`/api/v1/users/${admin.id}`).set(as('admin'));
        expect(dataOf(after).role).toBe('admin');
      });

      it('409 deactivating the only active admin', async () => {
        const admin = firstUser(
          await test.req.get('/api/v1/users').query({ role: 'admin' }).set(as('admin')),
        );
        const res = await test.req
          .patch(`/api/v1/users/${admin.id}`)
          .set(as('admin'))
          .send({ is_active: false });
        expect(res.status).toBe(409);
      });

      it('409 even when the second admin exists but is deactivated', async () => {
        await createUser({ ...VALID_CREATE, email: 'admin2@example.com', name: 'Second', role: 'admin' });
        const admins = listOf(
          await test.req.get('/api/v1/users').query({ role: 'admin' }).set(as('admin')),
        );
        expect(admins).toHaveLength(2);
        const second = admins.find((u) => u.email === 'admin2@example.com')!;
        await test.req
          .patch(`/api/v1/users/${second.id}`)
          .set(as('admin'))
          .send({ is_active: false });

        const first = admins.find((u) => u.email === 'admin@example.com')!;
        const res = await test.req
          .patch(`/api/v1/users/${first.id}`)
          .set(as('admin'))
          .send({ role: 'tester' });
        expect(res.status).toBe(409);
      });

      it('demotion and deactivation succeed once a second active admin exists', async () => {
        const second = await createUser({
          ...VALID_CREATE,
          email: 'admin2@example.com',
          name: 'Second',
          role: 'admin',
        });
        const admin = firstUser(
          await test.req.get('/api/v1/users').query({ query: 'admin@example' }).set(as('admin')),
        );

        const demote = await test.req
          .patch(`/api/v1/users/${admin.id}`)
          .set(as('admin'))
          .send({ role: 'lead' });
        expect(demote.status).toBe(200);
        expect(dataOf(demote).role).toBe('lead');

        // The fixtures are now stale: the caller is a Lead, so the second
        // admin logs in for the rest of this test.
        const relogin = await test.req.post('/api/v1/auth/login').send({
          email: 'admin2@example.com',
          password: VALID_CREATE_PASSWORD,
        });
        expect(relogin.status).toBe(200);
        const admin2Token = relogin.body.data.access_token as string;

        // Demoting the fixture admin leaves admin2 as the sole active admin;
        // it now deactivates the demoted account — still one active admin.
        const deactivate = await test.req
          .patch(`/api/v1/users/${admin.id}`)
          .set('Authorization', `Bearer ${admin2Token}`)
          .send({ is_active: false });
        expect(deactivate.status).toBe(200);
        expect(dataOf(deactivate).is_active).toBe(false);
      });

      it('name/password-only changes to the last admin never 409', async () => {
        const admin = firstUser(
          await test.req.get('/api/v1/users').query({ query: 'admin@example' }).set(as('admin')),
        );
        const rename = await test.req
          .patch(`/api/v1/users/${admin.id}`)
          .set(as('admin'))
          .send({ name: 'Ada K. Lovelace' });
        expect(rename.status).toBe(200);

        const reset = await test.req
          .patch(`/api/v1/users/${admin.id}`)
          .set(as('admin'))
          .send({ password: 'resetpw9' });
        expect(reset.status).toBe(200);
        expect(dataOf(reset).must_change_password).toBe(true);
      });

      it('403 for every non-Admin role (no writes at all)', async () => {
        const created = await createUser(VALID_CREATE);
        const id = dataOf(created).id;
        for (const role of ['lead', 'tester', 'viewer'] as UserRole[]) {
          const res = await test.req
            .patch(`/api/v1/users/${id}`)
            .set(as(role))
            .send({ name: 'X' });
          expect(res.status).toBe(403);
          expect(res.body.error.code).toBe('FORBIDDEN');
        }
      });
    });

    it('NO DELETE endpoint exists (users are deactivated, never hard-deleted)', async () => {
      const created = await createUser(VALID_CREATE);
      const id = dataOf(created).id;
      const res = await test.req.delete(`/api/v1/users/${id}`).set(as('admin'));
      expect(res.status).toBe(404);

      const stillThere = await test.req.get(`/api/v1/users/${id}`).set(as('admin'));
      expect(stillThere.status).toBe(200);
    });
  });
});
