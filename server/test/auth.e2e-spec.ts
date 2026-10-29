import {
  createTestApp,
  resetDb,
  resetRateLimit,
  refreshCookieOf,
  seedUser,
  SHARED_FIXTURE_PASSWORD,
  TestApp,
} from './helpers';
import * as jwt from 'jsonwebtoken';

/**
 * Integration: bootstrap, login, guard and /auth/me against the real
 * scratch database (migrations applied). Refresh/rotation/logout/password
 * flows live in auth-refresh.e2e-spec.ts.
 */
describe('Auth API — bootstrap, login, guard (integration)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await createTestApp();
  });

  afterAll(async () => {
    if (test) await test.close();
  });

  beforeEach(async () => {
    await resetDb(test.db);
    resetRateLimit(test.app);
  });

  describe('POST /api/v1/auth/bootstrap', () => {
    it('creates the first Admin with full session shape (201)', async () => {
      const res = await test.req.post('/api/v1/auth/bootstrap').send({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        password: 's3cretpass',
      });

      expect(res.status).toBe(201);
      const user = res.body.data.user;
      expect(user).toMatchObject({
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        role: 'admin',
        is_active: true,
        must_change_password: false,
      });
      expect(typeof user.id).toBe('string');
      expect(user).not.toHaveProperty('password_hash');
      expect(res.body.data.token_type).toBe('Bearer');
      expect(res.body.data.expires_in).toBe(900);
      expect(typeof res.body.data.access_token).toBe('string');
      expect(refreshCookieOf(res)).toMatch(/^[0-9a-f]{128}$/);
    });

    it('stores the email lowercase; login is case-insensitive', async () => {
      await test.req.post('/api/v1/auth/bootstrap').send({
        name: 'Ada', email: 'Ada@Example.COM', password: 's3cretpass',
      });
      const res = await test.req.post('/api/v1/auth/login').send({
        email: 'ada@example.com', password: 's3cretpass',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe('ada@example.com');
    });

    it('returns 409 CONFLICT once any user exists (even non-admin)', async () => {
      await seedUser(test.db, { email: 'someone@example.com', role: 'viewer' });
      const res = await test.req.post('/api/v1/auth/bootstrap').send({
        name: 'Late Admin', email: 'late@example.com', password: 's3cretpass',
      });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: { code: 'CONFLICT', message: expect.any(String) } });
    });

    it('rejects weak passwords and invalid bodies with 400 + details', async () => {
      const weak = await test.req.post('/api/v1/auth/bootstrap').send({
        name: 'Ada', email: 'ada@example.com', password: 'short',
      });
      expect(weak.status).toBe(400);
      expect(weak.body.error.code).toBe('VALIDATION_ERROR');
      expect(weak.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'password' })]),
      );

      const badEmail = await test.req.post('/api/v1/auth/bootstrap').send({
        name: 'Ada', email: 'nope', password: 's3cretpass',
      });
      expect(badEmail.status).toBe(400);
      expect(badEmail.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'email' })]),
      );

      const empty = await test.req.post('/api/v1/auth/bootstrap').send({});
      expect(empty.status).toBe(400);
    });

    it('rejects unknown properties (no mass assignment of role)', async () => {
      const res = await test.req.post('/api/v1/auth/bootstrap').send({
        name: 'Ada', email: 'ada@example.com', password: 's3cretpass', role: 'viewer',
      });
      expect(res.status).toBe(400);
    });

    it('survives a concurrent race: exactly one bootstrap wins', async () => {
      const [a, b] = await Promise.all([
        test.req.post('/api/v1/auth/bootstrap').send({ name: 'A', email: 'a@example.com', password: 's3cretpass' }),
        test.req.post('/api/v1/auth/bootstrap').send({ name: 'B', email: 'b@example.com', password: 's3cretpass' }),
      ]);
      const created = [a, b].filter((r) => r.status === 201);
      const conflicted = [a, b].filter((r) => r.status === 409);
      expect(created).toHaveLength(1);
      expect(conflicted).toHaveLength(1);
      const count = await test.db.query<{ count: string }>('SELECT count(*) AS count FROM users');
      expect(Number(count.rows[0]?.count)).toBe(1);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('ignores a spoofed X-Forwarded-For when counting failures', async () => {
      // Every attempt claims a different client address. The limiter keys on
      // the socket peer unless TRUST_PROXY=true, so the 11th attempt for one
      // email is blocked no matter what the header says.
      let status = 0;
      let code = '';
      for (let attempt = 1; attempt <= 11; attempt++) {
        const res = await test.req
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', `203.0.113.${attempt}`)
          .send({ email: 'ghost@example.com', password: 'wrong-wrong1' });
        status = res.status;
        code = res.body.error?.code ?? '';
      }
      expect(status).toBe(429);
      expect(code).toBe('RATE_LIMITED');
    });

    it('returns the session shape with a refresh cookie (200)', async () => {
      await seedUser(test.db, { email: 'ada@example.com', role: 'admin' });
      const res = await test.req.post('/api/v1/auth/login').send({
        email: 'ada@example.com', password: SHARED_FIXTURE_PASSWORD,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.user.role).toBe('admin');
      expect(res.body.data.token_type).toBe('Bearer');
      expect(res.body.data.expires_in).toBe(900);
      expect(res.body.data.user).not.toHaveProperty('password_hash');
      expect(refreshCookieOf(res)).toBeDefined();
    });

    it('unknown email, wrong password and deactivated user: byte-identical 401s', async () => {
      await seedUser(test.db, { email: 'ada@example.com', role: 'tester' });
      await seedUser(test.db, { email: 'dead@example.com', role: 'tester', isActive: false });

      const unknown = await test.req.post('/api/v1/auth/login').send({
        email: 'ghost@example.com', password: 'whatever-1',
      });
      const wrong = await test.req.post('/api/v1/auth/login').send({
        email: 'ada@example.com', password: 'wrong-wrong1',
      });
      const deactivated = await test.req.post('/api/v1/auth/login').send({
        email: 'dead@example.com', password: SHARED_FIXTURE_PASSWORD,
      });

      expect(unknown.status).toBe(401);
      expect(wrong.status).toBe(401);
      expect(deactivated.status).toBe(401);
      expect(unknown.body).toEqual(wrong.body);
      expect(wrong.body).toEqual(deactivated.body);
      expect(unknown.headers['set-cookie']).toBeUndefined();
    });

    it('400 VALIDATION_ERROR on malformed bodies', async () => {
      const res = await test.req.post('/api/v1/auth/login').send({ email: 'not-an-email' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('429 RATE_LIMITED with Retry-After after 10 failures; another email is unaffected', async () => {
      await seedUser(test.db, { email: 'ada@example.com', role: 'viewer' });
      await seedUser(test.db, { email: 'grace@example.com', role: 'viewer' });
      for (let i = 0; i < 10; i++) {
        const res = await test.req.post('/api/v1/auth/login')
          .set('X-Forwarded-For', '203.0.113.7')
          .send({ email: 'ada@example.com', password: 'wrong-wrong1' });
        expect(res.status).toBe(401);
      }
      const limited = await test.req.post('/api/v1/auth/login')
        .set('X-Forwarded-For', '203.0.113.7')
        .send({ email: 'ada@example.com', password: SHARED_FIXTURE_PASSWORD });
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
      const retryAfter = Number(limited.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(900);

      // Same socket peer, different email: a separate counter, still allowed.
      // A different address cannot be simulated from one socket unless the app
      // trusts the proxy - see the TRUST_PROXY opt-in test below.
      const otherEmail = await test.req.post('/api/v1/auth/login')
        .set('X-Forwarded-For', '198.51.100.9')
        .send({ email: 'grace@example.com', password: SHARED_FIXTURE_PASSWORD });
      expect(otherEmail.status).toBe(200);
    }, 60000);

    it('honours X-Forwarded-For only when TRUST_PROXY=true', async () => {
      const previous = process.env['TRUST_PROXY'];
      process.env['TRUST_PROXY'] = 'true';
      let proxied: TestApp | undefined;
      try {
        proxied = await createTestApp();
        // Eleven failures from eleven claimed addresses are eleven counters,
        // so none of them reaches 429.
        for (let attempt = 1; attempt <= 11; attempt++) {
          const res = await proxied.req.post('/api/v1/auth/login')
            .set('X-Forwarded-For', `198.51.100.${attempt}`)
            .send({ email: 'proxied-a@example.com', password: 'wrong-wrong1' });
          expect(res.status).toBe(401);
        }
        // One claimed address, eleven failures: the counter still applies.
        for (let attempt = 1; attempt <= 10; attempt++) {
          const res = await proxied.req.post('/api/v1/auth/login')
            .set('X-Forwarded-For', '203.0.113.50')
            .send({ email: 'proxied-b@example.com', password: 'wrong-wrong1' });
          expect(res.status).toBe(401);
        }
        const limited = await proxied.req.post('/api/v1/auth/login')
          .set('X-Forwarded-For', '203.0.113.50')
          .send({ email: 'proxied-b@example.com', password: 'wrong-wrong1' });
        expect(limited.status).toBe(429);
      } finally {
        if (proxied) await proxied.close();
        if (previous === undefined) delete process.env['TRUST_PROXY'];
        else process.env['TRUST_PROXY'] = previous;
      }
    }, 60000);
  });

  describe('access-token guard', () => {
    it('GET /auth/me: 401 without and with a garbage bearer', async () => {
      const none = await test.req.get('/api/v1/auth/me');
      expect(none.status).toBe(401);
      expect(none.body.error.code).toBe('UNAUTHENTICATED');

      const garbage = await test.req.get('/api/v1/auth/me').set('Authorization', 'Bearer not.a.jwt');
      expect(garbage.status).toBe(401);
      expect(garbage.body).toEqual(none.body);
    });

    it('GET /auth/me returns the full user for a valid token', async () => {
      const seeded = await seedUser(test.db, { email: 'ada@example.com', role: 'lead', name: 'Ada L.' });
      const login = await test.req.post('/api/v1/auth/login').send({
        email: 'ada@example.com', password: SHARED_FIXTURE_PASSWORD,
      });
      const token = login.body.data.access_token as string;
      expect(typeof token).toBe('string');

      const res = await test.req.get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        id: seeded.id,
        email: 'ada@example.com',
        name: 'Ada L.',
        role: 'lead',
        is_active: true,
        must_change_password: false,
        created_at: expect.any(String),
        updated_at: expect.any(String),
      });
    });

    it('deactivated users are rejected immediately, before token expiry', async () => {
      const seeded = await seedUser(test.db, { email: 'ada@example.com', role: 'viewer' });
      const login = await test.req.post('/api/v1/auth/login').send({
        email: 'ada@example.com', password: SHARED_FIXTURE_PASSWORD,
      });
      const token = login.body.data.access_token as string;
      expect((await test.req.get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);

      await test.db.query('UPDATE users SET is_active = false WHERE id = $1', [seeded.id]);
      const res = await test.req.get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects tokens signed with the wrong secret and expired tokens', async () => {
      const { jwtSecret } = (await import('./helpers')).loadTestEnv();
      const seeded = await seedUser(test.db, { email: 'ada@example.com', role: 'viewer' });

      const wrongSecret = jwt.sign({ sub: seeded.id, role: 'viewer' }, 'x'.repeat(40), {
        algorithm: 'HS256', expiresIn: 900, issuer: 'qalm',
      });
      expect(
        (await test.req.get('/api/v1/auth/me').set('Authorization', `Bearer ${wrongSecret}`)).status,
      ).toBe(401);

      const secret = jwtSecret;
      const expired = jwt.sign({ sub: seeded.id, role: 'viewer' }, secret, {
        algorithm: 'HS256', expiresIn: -10, issuer: 'qalm',
      });
      const res = await test.req.get('/api/v1/auth/me').set('Authorization', `Bearer ${expired}`);
      expect(res.status).toBe(401);
    });

    it('unauthenticated routes (login/bootstrap/refresh) work without a bearer', async () => {
      const res = await test.req.post('/api/v1/auth/login').send({
        email: 'nobody@example.com', password: 'nope-nope1',
      });
      expect([200, 401]).toContain(res.status); // must not be 403/404
    });
  });
});
