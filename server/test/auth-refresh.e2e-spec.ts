import {
  createTestApp,
  resetDb,
  resetRateLimit,
  refreshCookieOf,
  refreshCookieHeaders,
  seedUser,
  insertRefreshToken,
  SHARED_FIXTURE_PASSWORD,
  TestApp,
} from './helpers';

/**
 * Integration: refresh rotation + reuse defense, logout, and /auth/me
 * mutations (PATCH name, password change) against the real scratch DB.
 */
describe('Auth API — refresh, logout, me mutations (integration)', () => {
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

  async function loginAndGetSession(email: string, password: string) {
    const res = await test.req.post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return {
      accessToken: res.body.data.access_token as string,
      refreshToken: refreshCookieOf(res) as string,
      cookieHeaders: refreshCookieHeaders(res),
    };
  }

  describe('refresh cookie attributes', () => {
    it('sets HttpOnly, SameSite=Lax, Path=/api/v1/auth, Max-Age=2592000', async () => {
      await seedUser(test.db, { email: 'ada@example.com', role: 'viewer' });
      const { cookieHeaders } = await loginAndGetSession('ada@example.com', SHARED_FIXTURE_PASSWORD);
      expect(cookieHeaders).toHaveLength(1);
      const cookie = cookieHeaders[0] ?? '';
      expect(cookie.startsWith('qalm_refresh=')).toBe(true);
      expect(cookie).toContain('HttpOnly');
      expect(cookie.toLowerCase()).toContain('samesite=lax');
      expect(cookie).toContain('Path=/api/v1/auth');
      expect(cookie).toContain('Max-Age=2592000');
    });

    it('omits Secure when the dev-relax flag is set (this test env), per contract note', async () => {
      // .env.test sets REFRESH_COOKIE_SECURE=true (plain-HTTP loopback run);
      // the contract explicitly allows relaxing Secure there. Production
      // (flag unset) always gets Secure — covered by unit tests of the
      // cookieSecure inversion and documented in the README.
      await seedUser(test.db, { email: 'ada@example.com', role: 'viewer' });
      const { cookieHeaders } = await loginAndGetSession('ada@example.com', SHARED_FIXTURE_PASSWORD);
      expect(/Secure/i.test(cookieHeaders[0] ?? '')).toBe(false);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('rotates: returns new access token + new cookie, old cookie value dies', async () => {
      await seedUser(test.db, { email: 'ada@example.com', role: 'tester' });
      const first = await loginAndGetSession('ada@example.com', SHARED_FIXTURE_PASSWORD);

      const res = await test.req
        .post('/api/v1/auth/refresh')
        .set('Cookie', `qalm_refresh=${first.refreshToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: { access_token: expect.any(String), token_type: 'Bearer', expires_in: 900 },
      });
      // JWT iat has 1s granularity: a rotation within the same second yields a
      // byte-identical token (same claims). Assert validity, not inequality.
      const me = await test.req.get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.data.access_token}`);
      expect(me.status).toBe(200);
      const rotated = refreshCookieOf(res);
      expect(rotated).toBeDefined();
      expect(rotated).not.toBe(first.refreshToken);
    });

    it('reuse of a rotated token -> 401 AND revokes every token of that user', async () => {
      await seedUser(test.db, { email: 'ada@example.com', role: 'admin' });
      const original = await loginAndGetSession('ada@example.com', SHARED_FIXTURE_PASSWORD);

      const rotate1 = await test.req.post('/api/v1/auth/refresh').set('Cookie', `qalm_refresh=${original.refreshToken}`);
      expect(rotate1.status).toBe(200);
      const secondGen = refreshCookieOf(rotate1) as string;

      // Replay the original (rotated-out) token: must 401...
      const replay = await test.req.post('/api/v1/auth/refresh').set('Cookie', `qalm_refresh=${original.refreshToken}`);
      expect(replay.status).toBe(401);
      expect(replay.body.error.code).toBe('UNAUTHENTICATED');

      // ...and kill the token issued in the legitimate rotation, too.
      const after = await test.req.post('/api/v1/auth/refresh').set('Cookie', `qalm_refresh=${secondGen}`);
      expect(after.status).toBe(401);

      // A fresh login works again (revocation is per token set, not per user).
      const fresh = await loginAndGetSession('ada@example.com', SHARED_FIXTURE_PASSWORD);
      expect(fresh.refreshToken).toBeDefined();
    });

    it('missing cookie, unknown token and expired token all 401 identically', async () => {
      await seedUser(test.db, { email: 'ada@example.com', role: 'viewer' });

      const missing = await test.req.post('/api/v1/auth/refresh');
      const unknown = await test.req.post('/api/v1/auth/refresh').set('Cookie', 'qalm_refresh=deadbeef'.padEnd(129, 'a'));

      const expiredRaw = 'e'.repeat(128);
      const seeded = await seedUser(test.db, { email: 'old@example.com', role: 'viewer' });
      await insertRefreshToken(test.db, seeded.id, expiredRaw, -3600);
      const expired = await test.req.post('/api/v1/auth/refresh').set('Cookie', `qalm_refresh=${expiredRaw}`);

      expect(missing.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(expired.status).toBe(401);
      expect(missing.body).toEqual(unknown.body);
      expect(unknown.body).toEqual(expired.body);
    });

    it('a deactivated user cannot refresh even with a valid active token', async () => {
      const seeded = await seedUser(test.db, { email: 'ada@example.com', role: 'viewer' });
      const raw = 'c'.repeat(128);
      await insertRefreshToken(test.db, seeded.id, raw, 3600);

      await test.db.query('UPDATE users SET is_active = false WHERE id = $1', [seeded.id]);
      const res = await test.req.post('/api/v1/auth/refresh').set('Cookie', `qalm_refresh=${raw}`);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('revokes the presented refresh token and clears the cookie (204)', async () => {
      await seedUser(test.db, { email: 'ada@example.com', role: 'lead' });
      const session = await loginAndGetSession('ada@example.com', SHARED_FIXTURE_PASSWORD);

      const logout = await test.req
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .set('Cookie', `qalm_refresh=${session.refreshToken}`);
      expect(logout.status).toBe(204);
      const cleared = refreshCookieHeaders(logout);
      expect(cleared.join('|')).toContain('qalm_refresh=;');

      const reuse = await test.req.post('/api/v1/auth/refresh').set('Cookie', `qalm_refresh=${session.refreshToken}`);
      expect(reuse.status).toBe(401);
    });

    it('requires authentication (401 without bearer)', async () => {
      const res = await test.req.post('/api/v1/auth/logout');
      expect(res.status).toBe(401);
    });

    it('is 204 even without any refresh cookie', async () => {
      await seedUser(test.db, { email: 'ada@example.com', role: 'viewer' });
      const session = await loginAndGetSession('ada@example.com', SHARED_FIXTURE_PASSWORD);
      const res = await test.req
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${session.accessToken}`);
      expect(res.status).toBe(204);
    });
  });

  describe('PATCH /api/v1/auth/me', () => {
    it('changes the display name', async () => {
      await seedUser(test.db, { email: 'ada@example.com', role: 'tester', name: 'Ada' });
      const session = await loginAndGetSession('ada@example.com', SHARED_FIXTURE_PASSWORD);

      const res = await test.req
        .patch('/api/v1/auth/me')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({ name: 'Ada Lovelace' });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Ada Lovelace');
      const me = await test.req.get('/api/v1/auth/me').set('Authorization', `Bearer ${session.accessToken}`);
      expect(me.body.data.name).toBe('Ada Lovelace');
    });

    it('changes the password with current_password; clears must_change_password', async () => {
      await seedUser(test.db, {
        email: 'grace@example.com', role: 'tester', mustChangePassword: true,
      });
      const session = await loginAndGetSession('grace@example.com', SHARED_FIXTURE_PASSWORD);
      expect(session.accessToken).toBeTruthy();

      const bad = await test.req
        .patch('/api/v1/auth/me')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({ current_password: 'totally-wrong1', new_password: 'brand-new-Pw1' });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');
      expect(bad.body.error.details).toEqual([
        expect.objectContaining({ field: 'current_password' }),
      ]);

      const ok = await test.req
        .patch('/api/v1/auth/me')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({ current_password: SHARED_FIXTURE_PASSWORD, new_password: 'brand-new-Pw1' });
      expect(ok.status).toBe(200);
      expect(ok.body.data.must_change_password).toBe(false);

      // Old password no longer works; new one does; old refresh token is dead.
      const oldLogin = await test.req.post('/api/v1/auth/login').send({
        email: 'grace@example.com', password: SHARED_FIXTURE_PASSWORD,
      });
      expect(oldLogin.status).toBe(401);
      const newLogin = await test.req.post('/api/v1/auth/login').send({
        email: 'grace@example.com', password: 'brand-new-Pw1',
      });
      expect(newLogin.status).toBe(200);
      const oldRefresh = await test.req.post('/api/v1/auth/refresh')
        .set('Cookie', `qalm_refresh=${session.refreshToken}`);
      expect(oldRefresh.status).toBe(401);
    });

    it('400 on weak new password, half-specified change, empty body', async () => {
      await seedUser(test.db, { email: 'ada@example.com', role: 'viewer' });
      const session = await loginAndGetSession('ada@example.com', SHARED_FIXTURE_PASSWORD);
      const auth = { Authorization: `Bearer ${session.accessToken}` };

      const weak = await test.req.patch('/api/v1/auth/me').set(auth)
        .send({ current_password: SHARED_FIXTURE_PASSWORD, new_password: 'short' });
      expect(weak.status).toBe(400);

      const half = await test.req.patch('/api/v1/auth/me').set(auth)
        .send({ new_password: 'brand-new-Pw1' });
      expect(half.status).toBe(400);

      const empty = await test.req.patch('/api/v1/auth/me').set(auth).send({});
      expect(empty.status).toBe(400);
    });

    it('401 without a bearer token', async () => {
      const res = await test.req.patch('/api/v1/auth/me').send({ name: 'Nope' });
      expect(res.status).toBe(401);
    });
  });
});
