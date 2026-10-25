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

/** Case detail as it arrives over HTTP (untyped JSON until asserted). */
interface CaseData {
  id: string;
  project_id: string;
  suite_id: string | null;
  case_number: number;
  display_id: string;
  title: string;
  preconditions: string | null;
  steps: Array<{ position: number; text: string; expected_result: string | null }>;
  priority: string;
  type: string;
  tags: string[];
  estimate_minutes: number | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

type CaseListItem = Omit<CaseData, 'steps' | 'preconditions'> & { step_count: number };

interface HistoryData {
  id: string;
  case_id: string;
  actor_id: string;
  action: string;
  changes: Record<string, unknown>;
  created_at: string;
}

const bodyKeys = (res: request.Response): string[] =>
  Object.keys(res.body as Record<string, unknown>).sort();

/**
 * Integration: the full cases contract, docs/api-cases.md, against the real
 * scratch database (migrations applied) through the production HTTP wiring.
 * Covers the PRD-suites-cases.md acceptance criteria AC6-AC9 plus the archived
 * project rules, soft-delete/number-reservation semantics and the audit trail.
 */
describe('Cases API (integration)', () => {
  let test: TestApp;
  let projectId: string;
  let otherProjectId: string;
  let rootSuiteId: string;
  let childSuiteId: string;
  let grandSuiteId: string;
  let otherSuiteId: string;
  const tokens: Partial<Record<UserRole, string>> = {};
  const userIds: Partial<Record<UserRole, string>> = {};

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
    for (const role of ['admin', 'lead', 'tester', 'viewer'] as UserRole[]) {
      const email = `${role}@example.com`;
      const user = await seedUser(test.db, { email, role, name: `${role} User` });
      userIds[role] = user.id;
      const res = await test.req
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '203.0.113.52')
        .send({ email, password: SHARED_FIXTURE_PASSWORD });
      const token = res.body?.data?.access_token;
      if (typeof token !== 'string') {
        throw new Error(`login fixture failed for ${role}: ${res.status}`);
      }
      tokens[role] = token;
    }

    const project = await test.req
      .post('/api/v1/projects')
      .set(as('admin'))
      .send({ name: 'Payments', key: 'PAY' });
    projectId = project.body.data.id as string;
    const other = await test.req
      .post('/api/v1/projects')
      .set(as('admin'))
      .send({ name: 'Mobile', key: 'MOB' });
    otherProjectId = other.body.data.id as string;

    const createSuite = async (
      targetProjectId: string,
      name: string,
      parentId: string | null = null,
    ): Promise<string> => {
      const res = await test.req
        .post(`/api/v1/projects/${targetProjectId}/suites`)
        .set(as('admin'))
        .send(parentId === null ? { name } : { name, parent_id: parentId });
      expect(res.status).toBe(201);
      return res.body.data.id as string;
    };
    rootSuiteId = await createSuite(projectId, 'Checkout');
    childSuiteId = await createSuite(projectId, 'Payment', rootSuiteId);
    grandSuiteId = await createSuite(projectId, 'Wallet', childSuiteId);
    otherSuiteId = await createSuite(projectId, 'Account');
  });

  const createCase = (
    role: UserRole,
    targetProjectId: string,
    body: Record<string, unknown>,
  ) =>
    test.req
      .post(`/api/v1/projects/${targetProjectId}/cases`)
      .set(as(role))
      .send(body);

  const baseCase = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    suite_id: rootSuiteId,
    title: 'Pay with saved card',
    priority: 'high',
    type: 'functional',
    ...overrides,
  });

  const createOk = async (
    overrides: Record<string, unknown> = {},
    role: UserRole = 'admin',
  ): Promise<CaseData> => {
    const res = await createCase(role, projectId, baseCase(overrides));
    expect(res.status).toBe(201);
    return res.body.data as CaseData;
  };

  const listCases = (
    role: UserRole,
    query: Record<string, unknown> = {},
    targetProjectId = projectId,
  ) => test.req.get(`/api/v1/projects/${targetProjectId}/cases`).set(as(role)).query(query);

  const getCase = (role: UserRole, id: string) =>
    test.req.get(`/api/v1/cases/${id}`).set(as(role));

  const detailOf = async (role: UserRole, id: string): Promise<CaseData> => {
    const res = await getCase(role, id);
    expect(res.status).toBe(200);
    return res.body.data as CaseData;
  };

  const patchCase = (role: UserRole, id: string, body: Record<string, unknown>) =>
    test.req.patch(`/api/v1/cases/${id}`).set(as(role)).send(body);

  const deleteCase = (role: UserRole, id: string) =>
    test.req.delete(`/api/v1/cases/${id}`).set(as(role));

  const bulkMove = (
    role: UserRole,
    body: Record<string, unknown>,
    targetProjectId = projectId,
  ) =>
    test.req
      .post(`/api/v1/projects/${targetProjectId}/cases/bulk-move`)
      .set(as(role))
      .send(body);

  const historyOf = (
    role: UserRole,
    id: string,
    query: Record<string, unknown> = {},
  ) => test.req.get(`/api/v1/cases/${id}/history`).set(as(role)).query(query);

  const archiveProject = async (): Promise<void> => {
    const res = await test.req
      .post(`/api/v1/projects/${projectId}/archive`)
      .set(as('admin'));
    expect(res.status).toBe(200);
  };

  const listData = (res: request.Response): CaseListItem[] =>
    res.body.data as CaseListItem[];

  const listMeta = (res: request.Response): Record<string, number> =>
    res.body.meta as Record<string, number>;

  const historyData = (res: request.Response): HistoryData[] =>
    res.body.data as HistoryData[];

  describe('roles and envelopes', () => {
    it('lets every authenticated role read the empty case list', async () => {
      for (const role of ['admin', 'lead', 'tester', 'viewer'] as UserRole[]) {
        const res = await listCases(role);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          data: [],
          meta: { page: 1, limit: 25, total: 0, total_pages: 1 },
        });
      }
    });

    it('403s Tester and Viewer writes, 401s without a token', async () => {
      const created = await createOk();
      for (const role of ['tester', 'viewer'] as UserRole[]) {
        const create = await createCase(role, projectId, baseCase({ title: 'Nope' }));
        expect(create.status).toBe(403);
        expect(create.body.error.code).toBe('FORBIDDEN');

        const patch = await patchCase(role, created.id, { title: 'Nope' });
        expect(patch.status).toBe(403);
        expect(patch.body.error.code).toBe('FORBIDDEN');

        const remove = await deleteCase(role, created.id);
        expect(remove.status).toBe(403);
        expect(remove.body.error.code).toBe('FORBIDDEN');

        const move = await bulkMove(role, { case_ids: [created.id], suite_id: otherSuiteId });
        expect(move.status).toBe(403);
        expect(move.body.error.code).toBe('FORBIDDEN');
      }

      const anonymous = await test.req
        .post(`/api/v1/projects/${projectId}/cases`)
        .send(baseCase());
      expect(anonymous.status).toBe(401);
      expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('404s an unknown project and 400s a malformed project id', async () => {
      const unknown = await listCases(
        'admin',
        {},
        '018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f',
      );
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('NOT_FOUND');

      const malformed = await test.req
        .get('/api/v1/projects/not-a-uuid/cases')
        .set(as('admin'));
      expect(malformed.status).toBe(400);
      expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /projects/:projectId/cases', () => {
    it('creates a case with an allocated number, display id, ordered steps and normalised tags', async () => {
      const res = await createCase('lead', projectId, {
        suite_id: childSuiteId,
        title: '  Pay with saved card  ',
        preconditions: '  Customer has a saved card  ',
        steps: [
          { position: 7, text: '  Open checkout ', expected_result: ' Cart total is shown ' },
          { text: 'Pay with the saved card', expected_result: '' },
        ],
        priority: 'high',
        type: 'functional',
        tags: [' Payments ', 'smoke', 'payments'],
        estimate_minutes: 15,
      });

      expect(res.status).toBe(201);
      expect(bodyKeys(res)).toEqual(['data']);
      expect(res.body.data).toEqual({
        id: expect.any(String),
        project_id: projectId,
        suite_id: childSuiteId,
        case_number: 1,
        display_id: 'C1',
        title: 'Pay with saved card',
        preconditions: 'Customer has a saved card',
        steps: [
          { position: 1, text: 'Open checkout', expected_result: 'Cart total is shown' },
          { position: 2, text: 'Pay with the saved card', expected_result: null },
        ],
        priority: 'high',
        type: 'functional',
        tags: ['payments', 'smoke'],
        estimate_minutes: 15,
        created_by: userIds['lead'],
        updated_by: userIds['lead'],
        created_at: expect.any(String),
        updated_at: expect.any(String),
      });
      expect(Number.isNaN(Date.parse(res.body.data.created_at as string))).toBe(false);

      const history = await historyOf('admin', res.body.data.id as string);
      expect(historyData(history)).toEqual([
        expect.objectContaining({ action: 'created', changes: {}, actor_id: userIds['lead'] }),
      ]);
    });

    it('defaults optional fields to empty values', async () => {
      const created = await createOk({
        preconditions: '   ',
        steps: [],
        tags: [],
        estimate_minutes: null,
      });
      expect(created.preconditions).toBeNull();
      expect(created.steps).toEqual([]);
      expect(created.tags).toEqual([]);
      expect(created.estimate_minutes).toBeNull();
    });

    it('numbers cases per project from a counter that never reuses a number', async () => {
      const first = await createOk({ title: 'One' });
      const second = await createOk({ title: 'Two' });

      const otherSuite = await test.req
        .post(`/api/v1/projects/${otherProjectId}/suites`)
        .set(as('admin'))
        .send({ name: 'Mobile checkout' });
      const other = await createCase(
        'admin',
        otherProjectId,
        baseCase({
          suite_id: otherSuite.body.data.id as string,
          title: 'Other project',
          priority: 'low',
          type: 'other',
        }),
      );

      expect([first.case_number, second.case_number]).toEqual([1, 2]);
      expect([first.display_id, second.display_id]).toEqual(['C1', 'C2']);
      expect(other.status).toBe(201);
      expect(other.body.data).toMatchObject({ case_number: 1, display_id: 'C1' });
    });

    it('400s missing required fields, bad enums, unknown fields and over-long values', async () => {
      const missing = await createCase('admin', projectId, {});
      expect(missing.status).toBe(400);
      expect(missing.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'suite_id' }),
          expect.objectContaining({ field: 'title' }),
          expect.objectContaining({ field: 'priority' }),
          expect.objectContaining({ field: 'type' }),
        ]),
      );

      const badEnum = await createCase(
        'admin',
        projectId,
        baseCase({ priority: 'urgent', type: 'manual' }),
      );
      expect(badEnum.status).toBe(400);
      const badEnumFields = (badEnum.body.error.details as Array<{ field: string }>).map(
        (detail) => detail.field,
      );
      expect(badEnumFields).toEqual(expect.arrayContaining(['priority', 'type']));

      const extra = await createCase('admin', projectId, baseCase({ case_number: 99 }));
      expect(extra.status).toBe(400);
      expect(extra.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'case_number' })]),
      );

      const estimate = await createCase(
        'admin',
        projectId,
        baseCase({ estimate_minutes: 10_081 }),
      );
      expect(estimate.status).toBe(400);
      expect(estimate.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'estimate_minutes' })]),
      );

      const tags = await createCase('admin', projectId, baseCase({ tags: ['ok', ''] }));
      expect(tags.status).toBe(400);
      expect(tags.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'tags' })]),
      );
    });

    it('names the offending step by index (steps[1].text)', async () => {
      const res = await createCase(
        'admin',
        projectId,
        baseCase({
          steps: [{ text: 'Open checkout' }, { text: '   ' }],
        }),
      );
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'steps[1].text' })]),
      );
    });

    it('404s an unknown project, an unknown suite or a suite from another project', async () => {
      const unknownProject = await createCase(
        'admin',
        '018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f',
        baseCase(),
      );
      expect(unknownProject.status).toBe(404);

      const unknownSuite = await createCase(
        'admin',
        projectId,
        baseCase({ suite_id: '018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f' }),
      );
      expect(unknownSuite.status).toBe(404);
      expect(unknownSuite.body.error.code).toBe('NOT_FOUND');

      const foreign = await test.req
        .post(`/api/v1/projects/${otherProjectId}/suites`)
        .set(as('admin'))
        .send({ name: 'Foreign' });
      const foreignSuiteId = foreign.body.data.id as string;
      const foreignSuite = await createCase(
        'admin',
        projectId,
        baseCase({ suite_id: foreignSuiteId }),
      );
      expect(foreignSuite.status).toBe(404);
      expect(foreignSuite.body.error.code).toBe('NOT_FOUND');
    });

    it('409s every case write in an archived project, including for an Admin', async () => {
      const created = await createOk();
      await archiveProject();

      const create = await createCase('admin', projectId, baseCase({ title: 'Nope' }));
      expect(create.status).toBe(409);
      expect(create.body.error.code).toBe('CONFLICT');

      expect((await patchCase('admin', created.id, { title: 'Nope' })).status).toBe(409);
      expect((await deleteCase('admin', created.id)).status).toBe(409);
      expect(
        (await bulkMove('admin', { case_ids: [created.id], suite_id: childSuiteId })).status,
      ).toBe(409);
    });
  });

  describe('GET /projects/:projectId/cases', () => {
    it('returns list items: display id and step_count, no step bodies or preconditions', async () => {
      const created = await createOk({
        steps: [
          { text: 'Open', expected_result: null },
          { text: 'Pay', expected_result: 'Done' },
        ],
        preconditions: 'Saved card',
      });

      const res = await listCases('viewer');
      expect(res.status).toBe(200);
      expect(listData(res)).toEqual([
        {
          id: created.id,
          project_id: projectId,
          suite_id: rootSuiteId,
          case_number: 1,
          display_id: 'C1',
          title: 'Pay with saved card',
          priority: 'high',
          type: 'functional',
          tags: [],
          estimate_minutes: null,
          step_count: 2,
          created_by: userIds['admin'],
          updated_by: userIds['admin'],
          created_at: expect.any(String),
          updated_at: expect.any(String),
        },
      ]);
      expect(listData(res)[0]).not.toHaveProperty('steps');
      expect(listData(res)[0]).not.toHaveProperty('preconditions');
      expect(listMeta(res)).toEqual({ page: 1, limit: 25, total: 1, total_pages: 1 });
    });

    it('restricts to a suite subtree by default and to direct cases when asked', async () => {
      await createOk({ title: 'Root', suite_id: rootSuiteId });
      await createOk({ title: 'Child', suite_id: childSuiteId });
      await createOk({ title: 'Grand', suite_id: grandSuiteId });
      await createOk({ title: 'Other', suite_id: otherSuiteId });

      const subtree = await listCases('tester', { suite_id: rootSuiteId });
      expect(listData(subtree).map((row) => row.title)).toEqual(['Root', 'Child', 'Grand']);

      const direct = await listCases('tester', {
        suite_id: rootSuiteId,
        include_descendants: 'false',
      });
      expect(listData(direct).map((row) => row.title)).toEqual(['Root']);

      // Unknown (or foreign-project) suite ids are not an error: the resolved
      // id set is empty, so the page is empty. The contract only requires 400
      // for malformed ids (covered by the validation test below).
      const empty = await listCases('tester', {
        suite_id: '018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f',
      });
      expect(empty.status).toBe(200);
      expect(listData(empty)).toEqual([]);
    });

    it('applies query, priority/type OR and tag AND filters together (AC8)', async () => {
      await createOk({
        title: 'Pay with saved card',
        priority: 'high',
        type: 'functional',
        tags: ['payments', 'smoke'],
      });
      await createOk({
        title: 'Pay with new card',
        priority: 'low',
        type: 'smoke',
        tags: ['payments'],
      });
      await createOk({
        title: 'Refund order',
        priority: 'high',
        type: 'functional',
        tags: ['payments', 'smoke'],
      });

      const byQuery = await listCases('viewer', { query: 'SAVED' });
      expect(listData(byQuery).map((row) => row.title)).toEqual(['Pay with saved card']);

      const byPriority = await listCases('viewer', { priority: ['high', 'low'] });
      expect(listData(byPriority)).toHaveLength(3);

      const byType = await listCases('viewer', { type: ['smoke'] });
      expect(listData(byType).map((row) => row.title)).toEqual(['Pay with new card']);

      const byTag = await listCases('viewer', { tag: ['payments', 'smoke'] });
      expect(listData(byTag).map((row) => row.title)).toEqual([
        'Pay with saved card',
        'Refund order',
      ]);

      const combined = await listCases('viewer', {
        query: 'pay',
        priority: ['high'],
        tag: ['smoke'],
      });
      expect(listData(combined).map((row) => row.title)).toEqual(['Pay with saved card']);
    });

    it('sorts by title in both directions, paginates and moves edited cases to the top of -updated_at', async () => {
      const first = await createOk({ title: 'alpha' });
      await createOk({ title: 'bravo' });
      await createOk({ title: 'charlie' });

      const ascending = await listCases('viewer', { sort: 'title' });
      expect(listData(ascending).map((row) => row.title)).toEqual([
        'alpha',
        'bravo',
        'charlie',
      ]);
      const descending = await listCases('viewer', { sort: '-title' });
      expect(listData(descending).map((row) => row.title)).toEqual([
        'charlie',
        'bravo',
        'alpha',
      ]);

      const page = await listCases('viewer', { page: 2, limit: 2 });
      expect(listData(page).map((row) => row.title)).toEqual(['charlie']);
      expect(listMeta(page)).toEqual({ page: 2, limit: 2, total: 3, total_pages: 2 });

      expect((await patchCase('admin', first.id, { priority: 'critical' })).status).toBe(200);
      const newest = await listCases('viewer', { sort: '-updated_at' });
      expect(listData(newest)[0]!.id).toBe(first.id);
    });

    it('never returns soft-deleted cases', async () => {
      const created = await createOk();
      expect((await deleteCase('admin', created.id)).status).toBe(204);

      const res = await listCases('admin');
      expect(listData(res)).toEqual([]);
      expect(listMeta(res)['total']).toBe(0);
    });

    it('400s malformed query values', async () => {
      for (const query of [
        { sort: 'priority' },
        { page: '0' },
        { limit: '101' },
        { priority: 'urgent' },
        { type: 'manual' },
        { suite_id: 'not-a-uuid' },
        { include_descendants: 'yes' },
        { page_size: '10' },
      ]) {
        const res = await listCases('admin', query);
        expect([query, res.status]).toEqual([query, 400]);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('404s reads in an archived project for non-Admins but serves them to an Admin', async () => {
      await createOk();
      await archiveProject();

      for (const role of ['lead', 'tester', 'viewer'] as UserRole[]) {
        const res = await listCases(role);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
      const admin = await listCases('admin');
      expect(admin.status).toBe(200);
      expect(listData(admin)).toHaveLength(1);
    });
  });

  describe('GET /cases/:id', () => {
    it('returns the full detail shape', async () => {
      const created = await createOk({
        steps: [{ text: 'Open', expected_result: null }],
      });

      const res = await getCase('viewer', created.id);
      expect(res.status).toBe(200);
      expect(bodyKeys(res)).toEqual(['data']);
      expect(res.body.data).toEqual(created);
    });

    it('404s unknown and soft-deleted cases and 400s a malformed id', async () => {
      const created = await createOk();
      await deleteCase('admin', created.id);

      expect((await getCase('admin', created.id)).status).toBe(404);
      expect(
        (await getCase('admin', '018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f')).status,
      ).toBe(404);
      expect((await getCase('admin', 'not-a-uuid')).status).toBe(400);
    });

    it('hides an archived project from non-Admins and serves it to an Admin', async () => {
      const created = await createOk();
      await archiveProject();

      for (const role of ['lead', 'tester', 'viewer'] as UserRole[]) {
        expect((await getCase(role, created.id)).status).toBe(404);
      }
      expect((await getCase('admin', created.id)).status).toBe(200);
    });
  });

  describe('PATCH /cases/:id', () => {
    it('updates fields and records one updated row with from → to values', async () => {
      const created = await createOk({
        steps: [
          { text: 'Open', expected_result: null },
          { text: 'Pay', expected_result: 'Done' },
        ],
      });

      const res = await patchCase('lead', created.id, {
        title: 'Pay by card',
        priority: 'critical',
        tags: ['payments'],
        steps: [{ text: 'Open checkout', expected_result: null }],
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        title: 'Pay by card',
        priority: 'critical',
        tags: ['payments'],
        updated_by: userIds['lead'],
      });
      expect(res.body.data.steps).toEqual([
        { position: 1, text: 'Open checkout', expected_result: null },
      ]);

      const history = await historyOf('viewer', created.id);
      const updated = historyData(history).find((row) => row.action === 'updated');
      expect(updated?.changes).toEqual({
        title: { from: 'Pay with saved card', to: 'Pay by card' },
        priority: { from: 'high', to: 'critical' },
        tags: { from: [], to: ['payments'] },
        steps: { from: 2, to: 1 },
      });
    });

    it('writes nothing when a patch does not change any stored value', async () => {
      const created = await createOk();

      const res = await patchCase('admin', created.id, {
        title: created.title,
        tags: [...created.tags],
      });

      expect(res.status).toBe(200);
      expect(res.body.data.updated_at).toBe(created.updated_at);
      const history = await historyOf('admin', created.id);
      expect(historyData(history).map((row) => row.action)).toEqual(['created']);
    });

    it('records a suite change as a moved row, alongside updated when other fields change', async () => {
      const created = await createOk();

      await patchCase('admin', created.id, { suite_id: childSuiteId });
      let history = await historyOf('admin', created.id);
      expect(historyData(history).map((row) => row.action)).toEqual(['moved', 'created']);
      expect(historyData(history)[0]!.changes).toEqual({
        suite_id: { from: rootSuiteId, to: childSuiteId },
      });

      await patchCase('admin', created.id, { suite_id: grandSuiteId, title: 'Moved' });
      history = await historyOf('admin', created.id);
      // updated + moved share one transaction (one `now()`): their relative
      // order is the id tiebreaker, so assert content rather than order.
      const actions = historyData(history).map((row) => row.action);
      expect(actions).toHaveLength(4);
      expect(actions.filter((action) => action === 'created')).toHaveLength(1);
      expect(actions.filter((action) => action === 'moved')).toHaveLength(2);
      expect(actions.filter((action) => action === 'updated')).toHaveLength(1);
      expect(historyData(history).map((row) => row.changes)).toEqual(
        expect.arrayContaining([
          { suite_id: { from: childSuiteId, to: grandSuiteId } },
          { title: { from: 'Pay with saved card', to: 'Moved' } },
        ]),
      );
    });

    it('400s an empty body, a bad step index and a null suite', async () => {
      const created = await createOk();

      expect((await patchCase('admin', created.id, {})).status).toBe(400);

      const badStep = await patchCase('admin', created.id, {
        steps: [{ text: 'ok' }, { text: '' }],
      });
      expect(badStep.status).toBe(400);
      expect(badStep.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'steps[1].text' })]),
      );

      expect((await patchCase('admin', created.id, { suite_id: null })).status).toBe(400);
    });

    it('404s an unknown suite or case and 409s an archived project', async () => {
      const created = await createOk();

      expect(
        (
          await patchCase('admin', created.id, {
            suite_id: '018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f',
          })
        ).status,
      ).toBe(404);
      expect(
        (await patchCase('admin', '018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f', { title: 'x' }))
          .status,
      ).toBe(404);

      const foreign = await test.req
        .post(`/api/v1/projects/${otherProjectId}/suites`)
        .set(as('admin'))
        .send({ name: 'Foreign' });
      expect(
        (await patchCase('admin', created.id, { suite_id: foreign.body.data.id as string }))
          .status,
      ).toBe(404);

      await deleteCase('admin', created.id);
      expect((await patchCase('admin', created.id, { title: 'x' })).status).toBe(404);
    });
  });

  describe('DELETE /cases/:id', () => {
    it('soft deletes on 204: gone from reads and lists, number stays reserved, history survives', async () => {
      const created = await createOk({ title: 'One' });

      const res = await deleteCase('lead', created.id);
      expect(res.status).toBe(204);
      expect(res.text).toBe('');

      expect((await getCase('admin', created.id)).status).toBe(404);
      expect(listData(await listCases('admin'))).toEqual([]);
      expect((await historyOf('admin', created.id)).status).toBe(404);

      const next = await createOk({ title: 'Two' });
      expect(next.case_number).toBe(2);
      expect(next.display_id).toBe('C2');
    });

    it('404s a second DELETE and an unknown id, 400s a malformed id', async () => {
      const created = await createOk();
      expect((await deleteCase('admin', created.id)).status).toBe(204);
      expect((await deleteCase('admin', created.id)).status).toBe(404);
      expect(
        (await deleteCase('admin', '018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f')).status,
      ).toBe(404);
      expect((await deleteCase('admin', 'not-a-uuid')).status).toBe(400);
    });
  });

  describe('POST /projects/:projectId/cases/bulk-move', () => {
    it('moves cases atomically and writes one moved row per re-assigned case (AC9)', async () => {
      const first = await createOk({ title: 'One' });
      const second = await createOk({ title: 'Two' });

      const res = await bulkMove('lead', {
        case_ids: [first.id, second.id],
        suite_id: grandSuiteId,
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: { moved: 2, case_ids: [first.id, second.id] },
      });
      expect((await detailOf('admin', first.id)).suite_id).toBe(grandSuiteId);
      expect((await detailOf('admin', second.id)).suite_id).toBe(grandSuiteId);
      // AC7: the project-scoped number and display id survive a move.
      expect(await detailOf('admin', first.id)).toMatchObject({
        case_number: 1,
        display_id: 'C1',
      });

      for (const id of [first.id, second.id]) {
        const history = historyData(await historyOf('admin', id));
        expect(history.map((row) => row.action)).toEqual(['moved', 'created']);
        expect(history[0]!.changes).toEqual({
          suite_id: { from: rootSuiteId, to: grandSuiteId },
        });
      }
    });

    it('de-duplicates ids and counts only cases that actually moved', async () => {
      const alreadyThere = await createOk({ title: 'Already', suite_id: childSuiteId });
      const moving = await createOk({ title: 'Move me' });

      const res = await bulkMove('admin', {
        case_ids: [alreadyThere.id, moving.id, moving.id],
        suite_id: childSuiteId,
      });

      expect(res.body.data).toEqual({ moved: 1, case_ids: [moving.id] });
      expect(historyData(await historyOf('admin', alreadyThere.id))).toHaveLength(1);
      expect(historyData(await historyOf('admin', moving.id))).toHaveLength(2);
    });

    it('moves nothing when any id is unknown or soft-deleted (atomic)', async () => {
      const first = await createOk();
      const deleted = await createOk({ title: 'Deleted' });
      await deleteCase('admin', deleted.id);

      const failed = await bulkMove('admin', {
        case_ids: [first.id, '018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f'],
        suite_id: otherSuiteId,
      });
      expect(failed.status).toBe(400);
      expect(failed.body.error.code).toBe('VALIDATION_ERROR');
      expect(failed.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'case_ids' })]),
      );

      const deletedAttempt = await bulkMove('admin', {
        case_ids: [first.id, deleted.id],
        suite_id: otherSuiteId,
      });
      expect(deletedAttempt.status).toBe(400);

      expect((await detailOf('admin', first.id)).suite_id).toBe(rootSuiteId);
      expect(historyData(await historyOf('admin', first.id))).toHaveLength(1);
    });

    it('400s a case from another project and a target suite from another project', async () => {
      const created = await createOk();
      const foreignSuite = await test.req
        .post(`/api/v1/projects/${otherProjectId}/suites`)
        .set(as('admin'))
        .send({ name: 'Foreign' });
      const foreignSuiteId = foreignSuite.body.data.id as string;
      const foreignCase = await test.req
        .post(`/api/v1/projects/${otherProjectId}/cases`)
        .set(as('admin'))
        .send({
          suite_id: foreignSuiteId,
          title: 'Foreign case',
          priority: 'low',
          type: 'other',
        });

      const crossProjectCase = await bulkMove('admin', {
        case_ids: [created.id, foreignCase.body.data.id as string],
        suite_id: otherSuiteId,
      });
      expect(crossProjectCase.status).toBe(400);

      const crossProjectSuite = await bulkMove('admin', {
        case_ids: [created.id],
        suite_id: foreignSuiteId,
      });
      expect(crossProjectSuite.status).toBe(400);
      expect(crossProjectSuite.body.error.details).toEqual([
        { field: 'suite_id', issue: 'must belong to the same project' },
      ]);
    });

    it('404s an unknown suite or project and 409s an archived project', async () => {
      const created = await createOk();
      expect(
        (
          await bulkMove('admin', {
            case_ids: [created.id],
            suite_id: '018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f',
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await bulkMove(
            'admin',
            { case_ids: [created.id], suite_id: rootSuiteId },
            '018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f',
          )
        ).status,
      ).toBe(404);

      await archiveProject();
      expect(
        (await bulkMove('admin', { case_ids: [created.id], suite_id: childSuiteId })).status,
      ).toBe(409);
    });

    it('400s an empty list, a malformed id and more than 200 ids', async () => {
      const created = await createOk();

      expect((await bulkMove('admin', { case_ids: [], suite_id: otherSuiteId })).status).toBe(
        400,
      );
      expect(
        (await bulkMove('admin', { case_ids: [created.id, 'nope'], suite_id: otherSuiteId }))
          .status,
      ).toBe(400);

      const tooMany = Array.from(
        { length: 201 },
        (_, index) => `018f2c55-1a2b-7c3d-9e4f-5a6b7c8d9e${String(index).padStart(2, '0')}`,
      );
      expect((await bulkMove('admin', { case_ids: tooMany, suite_id: otherSuiteId })).status).toBe(
        400,
      );
    });
  });

  describe('GET /cases/:id/history', () => {
    it('returns the audit trail newest first with pagination meta', async () => {
      const created = await createOk();
      await patchCase('admin', created.id, { title: 'Edited once' });
      await patchCase('admin', created.id, { suite_id: childSuiteId });

      const res = await historyOf('tester', created.id);
      expect(res.status).toBe(200);
      expect(historyData(res).map((row) => row.action)).toEqual([
        'moved',
        'updated',
        'created',
      ]);
      expect(historyData(res)[0]).toEqual({
        id: expect.any(String),
        case_id: created.id,
        actor_id: userIds['admin'],
        action: 'moved',
        changes: { suite_id: { from: rootSuiteId, to: childSuiteId } },
        created_at: expect.any(String),
      });
      expect(listMeta(res)).toEqual({ page: 1, limit: 25, total: 3, total_pages: 1 });

      const page = await historyOf('tester', created.id, { page: 2, limit: 2 });
      expect(historyData(page).map((row) => row.action)).toEqual(['created']);
      expect(listMeta(page)).toEqual({ page: 2, limit: 2, total: 3, total_pages: 2 });
    });

    it('404s deleted/unknown cases and 400s a malformed id', async () => {
      const created = await createOk();
      await deleteCase('admin', created.id);

      expect((await historyOf('admin', created.id)).status).toBe(404);
      expect(
        (await historyOf('admin', '018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f')).status,
      ).toBe(404);
      expect((await historyOf('admin', 'not-a-uuid')).status).toBe(400);
      expect((await historyOf('admin', created.id, { limit: '101' })).status).toBe(400);
    });

    it('applies the archived-project read rules', async () => {
      const created = await createOk();
      await archiveProject();

      for (const role of ['lead', 'tester', 'viewer'] as UserRole[]) {
        expect((await historyOf(role, created.id)).status).toBe(404);
      }
      expect((await historyOf('admin', created.id)).status).toBe(200);
    });
  });
});
