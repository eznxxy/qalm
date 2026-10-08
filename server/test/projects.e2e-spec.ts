import {
  createTestApp,
  resetDb,
  resetRateLimit,
  seedUser,
  SHARED_FIXTURE_PASSWORD,
  TestApp,
} from './helpers';
import type request from 'supertest';
import { UserRole } from '../src/auth/current-user';

/** Project resource as it arrives over HTTP (untyped JSON until asserted). */
interface ProjectData {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface ListMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

const listOf = (res: request.Response): ProjectData[] => res.body.data as ProjectData[];
const metaOf = (res: request.Response): ListMeta => res.body.meta as ListMeta;
const bodyKeys = (res: request.Response): string[] =>
  Object.keys(res.body as Record<string, unknown>).sort();

/**
 * Integration: the full projects contract, docs/api-projects.md, against the
 * real scratch database (migrations applied) through the production HTTP
 * wiring. Covers every PRD-projects.md acceptance criterion (1-6) plus the
 * conventions envelope/pagination rules.
 */
describe('Projects API (integration)', () => {
  let test: TestApp;
  const tokens: Partial<Record<UserRole, string>> = {};

  const as = (role: UserRole): { Authorization: string } => ({
    Authorization: `Bearer ${tokens[role]}`,
  });

  beforeAll(async () => {
    test = await createTestApp();
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
      await seedUser(test.db, { email, role, name: `${role} User` });
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

  const createProject = (
    role: UserRole,
    body: Record<string, unknown>,
  ) => test.req.post('/api/v1/projects').set(as(role)).send(body);

  describe('POST /api/v1/projects', () => {
    it('creates as Admin: 201 envelope with normalized key, active, created_by (AC1, AC2)', async () => {
      const res = await createProject('admin', {
        name: 'Payments',
        key: 'pay',
        description: 'Checkout and billing flows',
      });
      expect(res.status).toBe(201);
      expect(bodyKeys(res)).toEqual(['data']);
      expect(res.body.data).toEqual({
        id: expect.any(String),
        key: 'PAY',
        name: 'Payments',
        description: 'Checkout and billing flows',
        status: 'active',
        created_by: expect.any(String),
        created_at: expect.any(String),
        updated_at: expect.any(String),
      });
      expect(res.body.data.created_at).toBe(res.body.data.updated_at);
    });

    it('creates as Lead (AC1, AC3); created_by is the lead', async () => {
      const res = await createProject('lead', { name: 'Mobile App', key: 'MOB' });
      expect(res.status).toBe(201);
      const me = await test.req.get('/api/v1/auth/me').set(as('lead'));
      expect(res.body.data.created_by).toBe(me.body.data.id);
    });

    it('403 for Tester and Viewer (AC3, AC6)', async () => {
      for (const role of ['tester', 'viewer'] as UserRole[]) {
        const res = await createProject(role, { name: 'Nope', key: 'NOP' });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
      const count = await test.db.query<{ count: string }>(
        'SELECT count(*) AS count FROM projects',
      );
      expect(Number(count.rows[0]?.count)).toBe(0);
    });

    it('401 without / with a garbage token', async () => {
      const none = await test.req.post('/api/v1/projects').send({ name: 'X', key: 'XY' });
      expect(none.status).toBe(401);
      const garbage = await test.req
        .post('/api/v1/projects')
        .set('Authorization', 'Bearer not.a.jwt')
        .send({ name: 'X', key: 'XY' });
      expect(garbage.status).toBe(401);
      expect(garbage.body).toEqual(none.body);
      expect(garbage.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('400 VALIDATION_ERROR with details naming the field', async () => {
      const badKey = await createProject('admin', { name: 'X', key: '1BAD' });
      expect(badKey.status).toBe(400);
      expect(badKey.body.error.code).toBe('VALIDATION_ERROR');
      expect(badKey.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'key' })]),
      );

      const longName = await createProject('admin', { name: 'x'.repeat(101), key: 'OKK' });
      expect(longName.status).toBe(400);
      expect(longName.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'name' })]),
      );

      const longDesc = await createProject('admin', {
        name: 'X', key: 'OKK', description: 'd'.repeat(501),
      });
      expect(longDesc.status).toBe(400);
      expect(longDesc.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'description' })]),
      );

      const missing = await createProject('admin', { key: 'OKK' });
      expect(missing.status).toBe(400);
      expect(missing.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'name' })]),
      );
    });

    it('409 CONFLICT on duplicate name (case-insensitive), details naming name (AC2)', async () => {
      await createProject('admin', { name: 'Payments', key: 'PAY' });
      const res = await createProject('lead', { name: 'payments', key: 'OTH' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(res.body.error.details).toEqual([
        { field: 'name', issue: 'already in use' },
      ]);
    });

    it('409 CONFLICT on duplicate key (case-insensitive), details naming key (AC2)', async () => {
      await createProject('admin', { name: 'Payments', key: 'PAY' });
      const res = await createProject('lead', { name: 'Billing', key: 'PaY' });
      expect(res.status).toBe(409);
      expect(res.body.error.details).toEqual([
        { field: 'key', issue: 'already in use' },
      ]);
    });

    it('concurrent duplicates: exactly one 201, the other 409 (unique-index race)', async () => {
      const [a, b] = await Promise.all([
        createProject('admin', { name: 'Race', key: 'RACE' }),
        createProject('lead', { name: 'Race', key: 'RACE2' }),
      ]);
      const created = [a, b].filter((r) => r.status === 201);
      const conflicted = [a, b].filter((r) => r.status === 409);
      expect(created).toHaveLength(1);
      expect(conflicted).toHaveLength(1);
      expect(conflicted[0]!.body.error.code).toBe('CONFLICT');
    });
  });

  describe('GET /api/v1/projects', () => {
    beforeEach(async () => {
      await createProject('admin', { name: 'Alpha', key: 'ALPHA' });
      await createProject('admin', { name: 'Beta', key: 'BETA' });
    });

    it('lists for every authenticated role, sorted by name asc, with meta (AC1)', async () => {
      for (const role of ['admin', 'lead', 'tester', 'viewer'] as UserRole[]) {
        const res = await test.req.get('/api/v1/projects').set(as(role));
        expect(res.status).toBe(200);
        expect(bodyKeys(res)).toEqual(['data', 'meta']);
        expect(listOf(res).map((p) => p.name)).toEqual([
          'Alpha',
          'Beta',
        ]);
        expect(res.body.meta).toEqual({ page: 1, limit: 25, total: 2, total_pages: 1 });
      }
    });

    it('401 unauthenticated', async () => {
      const res = await test.req.get('/api/v1/projects');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('query filters by case-insensitive name substring', async () => {
      await createProject('admin', { name: 'Gamma Ray', key: 'GAMMA' });
      const res = await test.req
        .get('/api/v1/projects')
        .query({ query: 'mma r' })
        .set(as('viewer'));
      expect(res.status).toBe(200);
      expect(listOf(res).map((p) => p.name)).toEqual(['Gamma Ray']);
      expect(metaOf(res).total).toBe(1);
    });

    it('LIKE wildcards in query are literals', async () => {
      await createProject('admin', { name: '100% done', key: 'HUNDRED' });
      const res = await test.req
        .get('/api/v1/projects')
        .query({ query: '0% d' })
        .set(as('admin'));
      expect(res.status).toBe(200);
      expect(listOf(res).map((p) => p.name)).toEqual(['100% done']);
    });

    it('paginates with page/limit and consistent meta', async () => {
      for (let i = 1; i <= 3; i++) {
        await createProject('admin', { name: `P${i}`, key: `P0${i}` });
      }
      const page1 = await test.req
        .get('/api/v1/projects')
        .query({ page: 1, limit: 2 })
        .set(as('admin'));
      expect(listOf(page1).map((p) => p.name)).toEqual([
        'Alpha',
        'Beta',
      ]);
      expect(metaOf(page1)).toEqual({ page: 1, limit: 2, total: 5, total_pages: 3 });
      const page3 = await test.req
        .get('/api/v1/projects')
        .query({ page: 3, limit: 2 })
        .set(as('admin'));
      expect(listOf(page3).map((p) => p.name)).toEqual(['P3']);
    });

    it('rejects invalid pagination and status values with 400 + details', async () => {
      for (const query of [
        { page: '0' },
        { limit: '0' },
        { limit: '101' },
        { limit: 'abc' },
        { status: 'ACTIVE' },
        { status: 'deleted' },
      ]) {
        const res = await test.req.get('/api/v1/projects').query(query).set(as('admin'));
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.details!.length).toBeGreaterThan(0);
      }
    });
  });

  describe('GET /api/v1/projects/:id', () => {
    it('returns the project for every role (AC6: viewer can open)', async () => {
      const created = await createProject('admin', { name: 'Open Me', key: 'OPEN' });
      const id = created.body.data.id as string;
      for (const role of ['admin', 'lead', 'tester', 'viewer'] as UserRole[]) {
        const res = await test.req.get(`/api/v1/projects/${id}`).set(as(role));
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ id, key: 'OPEN', status: 'active' });
      }
    });

    it('404 for an unknown id; 400 for a malformed uuid', async () => {
      const missing = await test.req
        .get('/api/v1/projects/00000000-0000-0000-0000-000000000000')
        .set(as('viewer'));
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('NOT_FOUND');

      const malformed = await test.req.get('/api/v1/projects/not-a-uuid').set(as('viewer'));
      expect(malformed.status).toBe(400);
      expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('401 unauthenticated', async () => {
      const created = await createProject('admin', { name: 'Secret', key: 'SEC' });
      const id = created.body.data.id as string;
      const res = await test.req.get(`/api/v1/projects/${id}`);
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /api/v1/projects/:id — Admin only (AC3)', () => {
    let projectId: string;

    beforeEach(async () => {
      const created = await createProject('admin', { name: 'Editable', key: 'EDIT' });
      projectId = created.body.data.id as string;
    });

    it('Admin edits name/key/description; status untouched', async () => {
      const res = await test.req
        .patch(`/api/v1/projects/${projectId}`)
        .set(as('admin'))
        .send({ name: 'Edited', key: 'edit2', description: 'new desc' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        name: 'Edited',
        key: 'EDIT2',
        description: 'new desc',
        status: 'active',
      });
    });

    it('Lead/Tester/Viewer get 403 (Lead edit forbidden — AC3)', async () => {
      for (const role of ['lead', 'tester', 'viewer'] as UserRole[]) {
        const res = await test.req
          .patch(`/api/v1/projects/${projectId}`)
          .set(as(role))
          .send({ name: 'Hacked' });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
      const after = await test.req.get(`/api/v1/projects/${projectId}`).set(as('admin'));
      expect(after.body.data.name).toBe('Editable');
    });

    it('status is not settable via PATCH (whitelist → 400)', async () => {
      const res = await test.req
        .patch(`/api/v1/projects/${projectId}`)
        .set(as('admin'))
        .send({ status: 'archived' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      const after = await test.req.get(`/api/v1/projects/${projectId}`).set(as('admin'));
      expect(after.body.data.status).toBe('active');
    });

    it('409 naming the field when renaming onto a taken name/key; self-put is fine', async () => {
      await createProject('admin', { name: 'Other', key: 'OTHER' });
      const nameClash = await test.req
        .patch(`/api/v1/projects/${projectId}`)
        .set(as('admin'))
        .send({ name: 'other' });
      expect(nameClash.status).toBe(409);
      expect(nameClash.body.error.details).toEqual([
        { field: 'name', issue: 'already in use' },
      ]);
      const keyClash = await test.req
        .patch(`/api/v1/projects/${projectId}`)
        .set(as('admin'))
        .send({ key: 'other' });
      expect(keyClash.status).toBe(409);
      expect(keyClash.body.error.details).toEqual([
        { field: 'key', issue: 'already in use' },
      ]);
      const self = await test.req
        .patch(`/api/v1/projects/${projectId}`)
        .set(as('admin'))
        .send({ name: 'EDITABLE', key: 'edit' });
      expect(self.status).toBe(200);
    });

    it('404 for unknown id', async () => {
      const res = await test.req
        .patch('/api/v1/projects/00000000-0000-0000-0000-000000000000')
        .set(as('admin'))
        .send({ name: 'X' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('empty body → 400 VALIDATION_ERROR, never a 500', async () => {
      const res = await test.req
        .patch(`/api/v1/projects/${projectId}`)
        .set(as('admin'))
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      const after = await test.req.get(`/api/v1/projects/${projectId}`).set(as('admin'));
      expect(after.body.data.name).toBe('Editable');
    });

    it('explicit null name/key → 400 VALIDATION_ERROR naming the field, never a 500', async () => {
      const nullName = await test.req
        .patch(`/api/v1/projects/${projectId}`)
        .set(as('admin'))
        .send({ name: null });
      expect(nullName.status).toBe(400);
      expect(nullName.body.error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(nullName.body.error.details)).toContain('"field":"name"');
      const nullKey = await test.req
        .patch(`/api/v1/projects/${projectId}`)
        .set(as('admin'))
        .send({ key: null });
      expect(nullKey.status).toBe(400);
      expect(nullKey.body.error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(nullKey.body.error.details)).toContain('"field":"key"');
      const after = await test.req.get(`/api/v1/projects/${projectId}`).set(as('admin'));
      expect(after.body.data).toMatchObject({ name: 'Editable', key: 'EDIT' });
    });

    it('explicit null description clears the field (200, description null)', async () => {
      await test.req
        .patch(`/api/v1/projects/${projectId}`)
        .set(as('admin'))
        .send({ description: 'has text' });
      const res = await test.req
        .patch(`/api/v1/projects/${projectId}`)
        .set(as('admin'))
        .send({ description: null });
      expect(res.status).toBe(200);
      expect(res.body.data.description).toBeNull();
    });
  });

  describe('POST /api/v1/projects/:id/archive — Admin and Lead (AC3, AC4)', () => {
    let projectId: string;

    beforeEach(async () => {
      const created = await createProject('admin', { name: 'Doomed', key: 'DOOM' });
      projectId = created.body.data.id as string;
    });

    it('Admin archives; response is 200 with archived status', async () => {
      const res = await test.req
        .post(`/api/v1/projects/${projectId}/archive`)
        .set(as('admin'));
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('archived');
    });

    it('Lead archives too (allowed)', async () => {
      const res = await test.req
        .post(`/api/v1/projects/${projectId}/archive`)
        .set(as('lead'));
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('archived');
    });

    it('Tester/Viewer get 403', async () => {
      for (const role of ['tester', 'viewer'] as UserRole[]) {
        const res = await test.req
          .post(`/api/v1/projects/${projectId}/archive`)
          .set(as(role));
        expect(res.status).toBe(403);
      }
    });

    it('is idempotent: archiving an archived project returns 200 again', async () => {
      const first = await test.req
        .post(`/api/v1/projects/${projectId}/archive`)
        .set(as('admin'));
      const second = await test.req
        .post(`/api/v1/projects/${projectId}/archive`)
        .set(as('lead'));
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body.data.status).toBe('archived');
    });

    it('archived project vanishes from the default list for EVERYONE (AC4)', async () => {
      await test.req.post(`/api/v1/projects/${projectId}/archive`).set(as('admin'));
      for (const role of ['admin', 'lead', 'tester', 'viewer'] as UserRole[]) {
        const res = await test.req.get('/api/v1/projects').set(as(role));
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
        expect(res.body.meta.total).toBe(0);
      }
    });

    it('archived project GET :id → 200 for Admin, 404 for everyone else (AC4)', async () => {
      await test.req.post(`/api/v1/projects/${projectId}/archive`).set(as('admin'));
      const admin = await test.req.get(`/api/v1/projects/${projectId}`).set(as('admin'));
      expect(admin.status).toBe(200);
      expect(admin.body.data.status).toBe('archived');
      for (const role of ['lead', 'tester', 'viewer'] as UserRole[]) {
        const res = await test.req.get(`/api/v1/projects/${projectId}`).set(as(role));
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
    });

    it('status=archived filter: Admin-only; non-Admin → 403 (AC4)', async () => {
      await test.req.post(`/api/v1/projects/${projectId}/archive`).set(as('lead'));
      const adminList = await test.req
        .get('/api/v1/projects')
        .query({ status: 'archived' })
        .set(as('admin'));
      expect(adminList.status).toBe(200);
      expect(listOf(adminList).map((p) => p.id)).toEqual([projectId]);
      expect(metaOf(adminList)).toEqual({
        page: 1,
        limit: 25,
        total: 1,
        total_pages: 1,
      });
      for (const role of ['lead', 'tester', 'viewer'] as UserRole[]) {
        const res = await test.req
          .get('/api/v1/projects')
          .query({ status: 'archived' })
          .set(as(role));
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    });

    it('status=active filter excludes archived rows for Admin too', async () => {
      await test.req.post(`/api/v1/projects/${projectId}/archive`).set(as('admin'));
      const res = await test.req
        .get('/api/v1/projects')
        .query({ status: 'active' })
        .set(as('admin'));
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('Admin can still PATCH an archived project (status stays archived)', async () => {
      await test.req.post(`/api/v1/projects/${projectId}/archive`).set(as('admin'));
      const res = await test.req
        .patch(`/api/v1/projects/${projectId}`)
        .set(as('admin'))
        .send({ description: 'fix metadata while archived' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('archived');
      expect(res.body.data.description).toBe('fix metadata while archived');
    });

    it('404 archiving an unknown id', async () => {
      const res = await test.req
        .post('/api/v1/projects/00000000-0000-0000-0000-000000000000/archive')
        .set(as('admin'));
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/projects/:id/restore — Admin only (AC3, AC5)', () => {
    let projectId: string;

    beforeEach(async () => {
      const created = await createProject('admin', { name: 'Phoenix', key: 'PHX' });
      projectId = created.body.data.id as string;
      await test.req.post(`/api/v1/projects/${projectId}/archive`).set(as('admin'));
    });

    it('Admin restores; the project reappears in the default list (AC5)', async () => {
      const res = await test.req
        .post(`/api/v1/projects/${projectId}/restore`)
        .set(as('admin'));
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('active');
      for (const role of ['admin', 'lead', 'tester', 'viewer'] as UserRole[]) {
        const list = await test.req.get('/api/v1/projects').set(as(role));
        expect(listOf(list).map((p) => p.id)).toEqual([projectId]);
        const detail = await test.req.get(`/api/v1/projects/${projectId}`).set(as(role));
        expect(detail.status).toBe(200);
      }
    });

    it('Lead/Tester/Viewer get 403 (Lead restore forbidden — AC3)', async () => {
      for (const role of ['lead', 'tester', 'viewer'] as UserRole[]) {
        const res = await test.req
          .post(`/api/v1/projects/${projectId}/restore`)
          .set(as(role));
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
      const still = await test.req
        .get('/api/v1/projects')
        .query({ status: 'archived' })
        .set(as('admin'));
      expect(still.body.data).toHaveLength(1);
    });

    it('is idempotent: restoring an active project returns 200 again', async () => {
      const first = await test.req
        .post(`/api/v1/projects/${projectId}/restore`)
        .set(as('admin'));
      const second = await test.req
        .post(`/api/v1/projects/${projectId}/restore`)
        .set(as('admin'));
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body.data.status).toBe('active');
    });

    it('404 for an unknown id', async () => {
      const res = await test.req
        .post('/api/v1/projects/00000000-0000-0000-0000-000000000000/restore')
        .set(as('admin'));
      expect(res.status).toBe(404);
    });
  });

  describe('contract hygiene', () => {
    it('NO DELETE endpoint exists (data-safety rule)', async () => {
      const created = await createProject('admin', { name: 'Undeletable', key: 'KEEP' });
      const id = created.body.data.id as string;
      const res = await test.req.delete(`/api/v1/projects/${id}`).set(as('admin'));
      expect([404, 405]).toContain(res.status);
      expect(res.body.error?.code).toBe('NOT_FOUND');
      const still = await test.req.get(`/api/v1/projects/${id}`).set(as('admin'));
      expect(still.status).toBe(200);
    });

    it('every write a Viewer can reach returns 403 (AC6)', async () => {
      const created = await createProject('admin', { name: 'Locked', key: 'LOCK' });
      const id = created.body.data.id as string;
      const writes: Array<() => Promise<request.Response>> = [
        () => createProject('viewer', { name: 'V', key: 'VKEY' }),
        () => test.req.patch(`/api/v1/projects/${id}`).set(as('viewer')).send({ name: 'V' }),
        () => test.req.post(`/api/v1/projects/${id}/archive`).set(as('viewer')),
        () => test.req.post(`/api/v1/projects/${id}/restore`).set(as('viewer')),
      ];
      for (const write of writes) {
        expect((await write()).status).toBe(403);
      }
    });

    it('lead can create and archive but not edit or restore (AC3 matrix)', async () => {
      const created = await createProject('lead', { name: 'Lead Life', key: 'LEAD' });
      expect(created.status).toBe(201);
      const id = created.body.data.id as string;

      const edit = await test.req
        .patch(`/api/v1/projects/${id}`)
        .set(as('lead'))
        .send({ name: 'Nope' });
      expect(edit.status).toBe(403);

      const archive = await test.req
        .post(`/api/v1/projects/${id}/archive`)
        .set(as('lead'));
      expect(archive.status).toBe(200);

      const restore = await test.req
        .post(`/api/v1/projects/${id}/restore`)
        .set(as('lead'));
      expect(restore.status).toBe(403);
    });
  });
});
