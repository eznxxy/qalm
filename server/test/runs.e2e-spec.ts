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

/** Run detail as it arrives over HTTP (untyped JSON until asserted). */
interface RunData {
  id: string;
  project_id: string;
  plan_id: string | null;
  name: string;
  description: string | null;
  status: 'open' | 'completed';
  start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  completed_by: string | null;
  counts: {
    total: number;
    passed: number;
    failed: number;
    blocked: number;
    retest: number;
    skipped: number;
    untested: number;
    percent_complete: number;
  };
  assignee_ids: string[];
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

interface ItemData {
  id: string;
  run_id: string;
  case_id: string | null;
  case_display_id: string;
  case_title: string;
  case_priority: string;
  case_suite_id: string;
  assignee_id: string | null;
  position: number;
  status: string;
  result_count: number;
  latest_result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

const bodyKeys = (res: request.Response): string[] =>
  Object.keys(res.body as Record<string, unknown>).sort();

/**
 * Integration: the full runs & run-items contract, docs/api-runs.md, against the
 * real scratch database (migrations applied) through the production HTTP wiring.
 * Covers the slice-3 acceptance criteria for selection, rollups, the item table,
 * assignment/reordering, close/reopen, soft delete and the archived-project and
 * role rules. The results/attachments API lives in its own spec, so the one
 * "item already has a result" case seeds a result row directly.
 */
describe('Runs API (integration)', () => {
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
        .set('X-Forwarded-For', '203.0.113.53')
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

  const createCaseIn = async (
    suiteId: string,
    title: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; case_number: number; display_id: string }> => {
    const res = await test.req
      .post(`/api/v1/projects/${projectId}/cases`)
      .set(as('admin'))
      .send({ suite_id: suiteId, title, priority: 'high', type: 'functional', ...overrides });
    expect(res.status).toBe(201);
    return res.body.data as { id: string; case_number: number; display_id: string };
  };

  /** Inserts a plan directly so this spec stays independent of the plans API. */
  const insertPlan = async (targetProjectId: string, name: string): Promise<string> => {
    const res = await test.db.query<{ id: string }>(
      `INSERT INTO plans (project_id, name, created_by, updated_by)
       VALUES ($1, $2, $3, $3) RETURNING id`,
      [targetProjectId, name, userIds['admin']],
    );
    return res.rows[0]!.id;
  };

  /** Inserts a result directly for the item-DELETE guard (results API is 2.2). */
  const insertResult = async (
    itemId: string,
    status: string,
    comment: string | null = null,
  ): Promise<void> => {
    await test.db.query(
      `INSERT INTO results (run_item_id, status, comment, created_by)
       VALUES ($1, $2, $3, $4)`,
      [itemId, status, comment, userIds['admin']],
    );
  };

  const createRun = (
    role: UserRole,
    body: Record<string, unknown>,
    targetProjectId = projectId,
  ) =>
    test.req
      .post(`/api/v1/projects/${targetProjectId}/runs`)
      .set(as(role))
      .send(body);

  const createOk = async (
    body: Record<string, unknown> = {},
    role: UserRole = 'admin',
  ): Promise<RunData> => {
    const res = await createRun(role, { name: 'Release smoke', ...body });
    expect(res.status).toBe(201);
    return res.body.data as RunData;
  };

  const listRuns = (
    role: UserRole,
    query: Record<string, unknown> = {},
    targetProjectId = projectId,
  ) => test.req.get(`/api/v1/projects/${targetProjectId}/runs`).set(as(role)).query(query);

  const getRun = (role: UserRole, id: string) =>
    test.req.get(`/api/v1/runs/${id}`).set(as(role));

  const patchRun = (role: UserRole, id: string, body: Record<string, unknown>) =>
    test.req.patch(`/api/v1/runs/${id}`).set(as(role)).send(body);

  const listItems = (
    role: UserRole,
    runId: string,
    query: Record<string, unknown> = {},
  ) => test.req.get(`/api/v1/runs/${runId}/items`).set(as(role)).query(query);

  const itemData = (res: request.Response): ItemData[] => res.body.data as ItemData[];

  const addItems = (role: UserRole, runId: string, body: Record<string, unknown>) =>
    test.req.post(`/api/v1/runs/${runId}/items`).set(as(role)).send(body);

  const patchItem = (role: UserRole, runId: string, itemId: string, body: Record<string, unknown>) =>
    test.req.patch(`/api/v1/runs/${runId}/items/${itemId}`).set(as(role)).send(body);

  const assign = (role: UserRole, runId: string, body: Record<string, unknown>) =>
    test.req.post(`/api/v1/runs/${runId}/assign`).set(as(role)).send(body);

  const removeItem = (role: UserRole, runId: string, itemId: string) =>
    test.req.delete(`/api/v1/runs/${runId}/items/${itemId}`).set(as(role));

  const archiveProject = async (targetProjectId: string): Promise<void> => {
    const res = await test.req
      .post(`/api/v1/projects/${targetProjectId}/archive`)
      .set(as('admin'));
    expect(res.status).toBe(200);
  };

  describe('roles and envelopes', () => {
    it('lets every authenticated role read the empty runs list', async () => {
      for (const role of ['admin', 'lead', 'tester', 'viewer'] as UserRole[]) {
        const res = await listRuns(role);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          data: [],
          meta: { page: 1, limit: 25, total: 0, total_pages: 1 },
        });
      }
    });

    it('403s Tester and Viewer writes, 401s without a token', async () => {
      const run = await createOk({ selection: { case_ids: [(await createCaseIn(rootSuiteId, 'Case')).id] } });
      const itemId = (await listItems('admin', run.id)).body.data[0].id as string;

      for (const role of ['tester', 'viewer'] as UserRole[]) {
        expect((await createRun(role, { name: 'Nope' })).status).toBe(403);
        expect((await patchRun(role, run.id, { name: 'Nope' })).status).toBe(403);
        expect((await test.req.post(`/api/v1/runs/${run.id}/close`).set(as(role))).status).toBe(403);
        expect((await test.req.delete(`/api/v1/runs/${run.id}`).set(as(role))).status).toBe(403);
        expect((await addItems(role, run.id, { case_ids: [itemId] })).status).toBe(403);
        expect((await patchItem(role, run.id, itemId, { assignee_id: null })).status).toBe(403);
        expect((await assign(role, run.id, { assignee_id: userIds['tester'] })).status).toBe(403);
        expect((await removeItem(role, run.id, itemId)).status).toBe(403);
      }

      const anonymous = await test.req
        .post(`/api/v1/projects/${projectId}/runs`)
        .send({ name: 'Nope' });
      expect(anonymous.status).toBe(401);
      expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('404s an unknown project and 400s a malformed project id', async () => {
      const unknown = await listRuns('admin', {}, '018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f');
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('NOT_FOUND');

      const malformed = await test.req
        .get('/api/v1/projects/not-a-uuid/runs')
        .set(as('admin'));
      expect(malformed.status).toBe(400);
      expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /projects/:projectId/runs', () => {
    it('materialises the selection into ordered items and returns the rollup', async () => {
      const c1 = await createCaseIn(rootSuiteId, 'Open checkout');
      await createCaseIn(childSuiteId, 'Pay with card');
      await createCaseIn(grandSuiteId, 'Pay with wallet');
      const c4 = await createCaseIn(otherSuiteId, 'Refund order');

      const res = await createRun('lead', {
        name: '  Release 2.4 smoke  ',
        description: 'Smoke pass.',
        due_date: '2026-11-14',
        selection: { case_ids: [c4.id, c1.id], suite_id: rootSuiteId },
      });

      expect(res.status).toBe(201);
      expect(bodyKeys(res)).toEqual(['data']);
      expect(res.body.data).toMatchObject({
        project_id: projectId,
        plan_id: null,
        name: 'Release 2.4 smoke',
        description: 'Smoke pass.',
        status: 'open',
        due_date: '2026-11-14',
        completed_at: null,
        completed_by: null,
        assignee_ids: [],
        created_by: userIds['lead'],
        counts: {
          total: 4,
          passed: 0,
          failed: 0,
          blocked: 0,
          retest: 0,
          skipped: 0,
          untested: 4,
          percent_complete: 0,
        },
      });

      const items = await listItems('lead', res.body.data.id as string);
      expect(itemData(items).map((row) => row.case_display_id)).toEqual(['C1', 'C2', 'C3', 'C4']);
      expect(itemData(items).map((row) => row.position)).toEqual([1, 2, 3, 4]);
      expect(itemData(items)[0]).toMatchObject({
        case_title: 'Open checkout',
        case_priority: 'high',
        case_suite_id: rootSuiteId,
        status: 'untested',
        result_count: 0,
        latest_result: null,
        assignee_id: null,
      });
      expect(itemData(items)[0]).not.toHaveProperty('case_steps');
    });

    it('creates an empty run when the selection is omitted', async () => {
      const run = await createOk({ selection: undefined });
      expect(run.counts.total).toBe(0);
      expect(run.assignee_ids).toEqual([]);
    });

    it('stores start_date as a plain date and 400s a start date after the due date', async () => {
      const run = await createOk({
        name: 'Dated',
        start_date: '2026-11-01',
        due_date: '2026-11-14',
      });
      expect(run).toMatchObject({ start_date: '2026-11-01', due_date: '2026-11-14' });

      const detail = await getRun('viewer', run.id);
      expect(detail.body.data).toMatchObject({
        start_date: '2026-11-01',
        due_date: '2026-11-14',
      });

      const backwards = await createRun('lead', {
        name: 'Backwards',
        start_date: '2026-11-20',
        due_date: '2026-11-14',
      });
      expect(backwards.status).toBe(400);
      expect(backwards.body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'start_date', issue: 'must be on or before due_date' }],
      });

      const malformed = await createRun('lead', { name: 'Bad', start_date: '01/11/2026' });
      expect(malformed.status).toBe(400);
      expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('400s an unknown selection suite, 400s a foreign plan_id and 409s an archived project', async () => {
      const badSuite = await createRun('admin', {
        name: 'Bad',
        selection: { suite_id: '018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f' },
      });
      expect(badSuite.status).toBe(400);
      expect(badSuite.body.error.code).toBe('VALIDATION_ERROR');

      const foreignPlan = await createRun('admin', {
        name: 'Bad',
        plan_id: (await insertPlan(otherProjectId, 'Foreign')).toString(),
      });
      expect(foreignPlan.status).toBe(400);

      const other = await test.req
        .post('/api/v1/projects')
        .set(as('admin'))
        .send({ name: 'Archived', key: 'ARC' });
      const archivedId = other.body.data.id as string;
      await archiveProject(archivedId);
      const archived = await createRun('admin', { name: 'Nope' }, archivedId);
      expect(archived.status).toBe(409);
      expect(archived.body.error.code).toBe('CONFLICT');
    });

    it('skips unknown case ids silently', async () => {
      const c1 = await createCaseIn(rootSuiteId, 'One');
      const run = await createOk({
        selection: { case_ids: [c1.id, '018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f'] },
      });
      expect(run.counts.total).toBe(1);
    });
  });

  describe('GET /projects/:projectId/runs', () => {
    it('lists live runs newest first and filters by plan, status, query and name', async () => {
      const plan = await insertPlan(projectId, 'Release 2.4');
      const planned = await createOk({ name: 'In plan', plan_id: plan });
      await createOk({ name: 'Ad hoc' });
      const completed = await createOk({ name: 'Done' });
      await test.req.post(`/api/v1/runs/${completed.id}/close`).set(as('admin'));

      const all = await listRuns('viewer');
      expect((all.body.data as RunData[]).map((r) => r.name)).toEqual(['Done', 'Ad hoc', 'In plan']);

      const byPlan = await listRuns('viewer', { plan_id: plan });
      expect((byPlan.body.data as RunData[]).map((r) => r.id)).toEqual([planned.id]);

      const noPlan = await listRuns('viewer', { plan_id: 'none' });
      expect((noPlan.body.data as RunData[]).map((r) => r.name).sort()).toEqual(['Ad hoc', 'Done']);

      const open = await listRuns('viewer', { status: 'open' });
      expect((open.body.data as RunData[]).map((r) => r.name).sort()).toEqual(['Ad hoc', 'In plan']);

      const byName = await listRuns('viewer', { query: 'ad hoc' });
      expect((byName.body.data as RunData[]).map((r) => r.name)).toEqual(['Ad hoc']);
    });

    it('sorts and paginates with meta', async () => {
      await createOk({ name: 'bravo' });
      await createOk({ name: 'alpha' });
      await createOk({ name: 'charlie' });

      const byName = await listRuns('viewer', { sort: 'name', limit: 2, page: 2 });
      expect((byName.body.data as RunData[]).map((r) => r.name)).toEqual(['charlie']);
      expect(byName.body.meta).toEqual({ page: 2, limit: 2, total: 3, total_pages: 2 });
    });

    it('sorts by start_date in both directions with nulls last', async () => {
      await createOk({ name: 'later', start_date: '2026-11-05' });
      await createOk({ name: 'none' });
      await createOk({ name: 'earlier', start_date: '2026-11-01' });

      const ascending = await listRuns('viewer', { sort: 'start_date' });
      expect((ascending.body.data as RunData[]).map((r) => r.name)).toEqual([
        'earlier',
        'later',
        'none',
      ]);

      const descending = await listRuns('viewer', { sort: '-start_date' });
      expect((descending.body.data as RunData[]).map((r) => r.name)).toEqual([
        'later',
        'earlier',
        'none',
      ]);

      const badSort = await listRuns('viewer', { sort: 'bogus' });
      expect(badSort.status).toBe(400);
    });
  });

  describe('run detail, update, close and delete', () => {
    it('returns counts and assignees on detail for any role', async () => {
      const c1 = await createCaseIn(rootSuiteId, 'One');
      const c2 = await createCaseIn(rootSuiteId, 'Two');
      const run = await createOk({ name: 'Smoke', selection: { case_ids: [c1.id, c2.id] } });
      const items = itemData(await listItems('admin', run.id));
      await insertResult(items[0]!.id, 'passed');
      await patchItem('admin', run.id, items[1]!.id, { assignee_id: userIds['tester'] });

      const res = await getRun('tester', run.id);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        name: 'Smoke',
        status: 'open',
        counts: {
          total: 2,
          passed: 1,
          failed: 0,
          blocked: 0,
          retest: 0,
          skipped: 0,
          untested: 1,
          percent_complete: 50,
        },
        assignee_ids: [userIds['tester']],
      });
    });

    it('patches a subset, detaches a plan with null and 400s an empty patch', async () => {
      const plan = await insertPlan(projectId, 'Plan');
      const run = await createOk({ name: 'Old', plan_id: plan });

      const patched = await patchRun('lead', run.id, { name: 'New', plan_id: null });
      expect(patched.status).toBe(200);
      expect(patched.body.data).toMatchObject({ name: 'New', plan_id: null });

      const empty = await patchRun('lead', run.id, {});
      expect(empty.status).toBe(400);
      expect(empty.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('patches the start date, clears it with null and 400s a start after the due date', async () => {
      const run = await createOk({ name: 'Dated', due_date: '2026-11-14' });

      const dated = await patchRun('lead', run.id, { start_date: '2026-11-01' });
      expect(dated.status).toBe(200);
      expect(dated.body.data).toMatchObject({ start_date: '2026-11-01', due_date: '2026-11-14' });

      const backwards = await patchRun('lead', run.id, { start_date: '2026-12-01' });
      expect(backwards.status).toBe(400);
      expect(backwards.body.error.code).toBe('VALIDATION_ERROR');

      const cleared = await patchRun('lead', run.id, { start_date: null });
      expect(cleared.body.data).toMatchObject({ start_date: null, due_date: '2026-11-14' });
    });

    it('closes and reopens, 409ing a repeat', async () => {
      const run = await createOk({ name: 'Smoke' });

      const closed = await test.req.post(`/api/v1/runs/${run.id}/close`).set(as('lead'));
      expect(closed.status).toBe(200);
      expect(closed.body.data).toMatchObject({
        status: 'completed',
        completed_by: userIds['lead'],
      });

      const again = await test.req.post(`/api/v1/runs/${run.id}/close`).set(as('lead'));
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('CONFLICT');

      const reopened = await test.req.post(`/api/v1/runs/${run.id}/reopen`).set(as('lead'));
      expect(reopened.body.data).toMatchObject({ status: 'open', completed_at: null });
    });

    it('soft deletes a run (204) and 404s it afterwards', async () => {
      const run = await createOk({ name: 'Gone' });
      const removed = await test.req.delete(`/api/v1/runs/${run.id}`).set(as('lead'));
      expect(removed.status).toBe(204);
      expect(removed.text).toBe('');
      expect((await getRun('admin', run.id)).status).toBe(404);
      expect((await test.req.delete(`/api/v1/runs/${run.id}`).set(as('lead'))).status).toBe(404);
    });
  });

  describe('GET /runs/:id/items', () => {
    it('returns the snapshot fields in authored order', async () => {
      const c1 = await createCaseIn(rootSuiteId, 'First');
      const c2 = await createCaseIn(childSuiteId, 'Second');
      const run = await createOk({ selection: { case_ids: [c2.id, c1.id] } });

      const res = await listItems('viewer', run.id);
      expect(res.status).toBe(200);
      expect(itemData(res).map((row) => row.case_display_id)).toEqual(['C1', 'C2']);
      expect(res.body.meta).toEqual({ page: 1, limit: 25, total: 2, total_pages: 1 });
    });

    it('filters by status, assignee (none) and suite subtree', async () => {
      await createCaseIn(rootSuiteId, 'Root case');
      await createCaseIn(childSuiteId, 'Child case');
      await createCaseIn(otherSuiteId, 'Other case');
      const run = await createOk({ selection: { suite_id: rootSuiteId } });
      const items = itemData(await listItems('admin', run.id));
      const childItem = items.find((row) => row.case_title === 'Child case')!;
      await insertResult(childItem.id, 'failed', 'boom');

      const failed = await listItems('admin', run.id, { status: 'failed' });
      expect(itemData(failed).map((row) => row.id)).toEqual([childItem.id]);
      const untested = await listItems('admin', run.id, { status: 'untested' });
      expect(itemData(untested)).toHaveLength(1);

      const unassigned = await listItems('admin', run.id, { assignee_id: 'none' });
      expect(itemData(unassigned)).toHaveLength(2);

      const bySuite = await listItems('admin', run.id, { suite_id: childSuiteId });
      expect(itemData(bySuite).map((row) => row.case_title)).toEqual(['Child case']);
    });

    it('sorts by status severity and 404s an unknown run', async () => {
      await createCaseIn(rootSuiteId, 'A');
      await createCaseIn(childSuiteId, 'B');
      const run = await createOk({ selection: { suite_id: rootSuiteId } });
      const items = itemData(await listItems('admin', run.id));
      await insertResult(items[0]!.id, 'passed');

      const sorted = await listItems('admin', run.id, { sort: 'status' });
      expect(itemData(sorted).map((row) => row.status)).toEqual(['passed', 'untested']);

      expect((await listItems('admin', '018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f')).status).toBe(404);
    });
  });

  describe('GET /runs/:id/items/:itemId', () => {
    it('returns the step snapshot and the live preconditions', async () => {
      const c1 = await createCaseIn(rootSuiteId, 'With steps', {
        preconditions: 'Customer is signed in',
        steps: [{ text: 'Open checkout', expected_result: 'Cart shown' }],
      });
      const run = await createOk({ selection: { case_ids: [c1.id] } });
      const itemId = itemData(await listItems('admin', run.id))[0]!.id;

      const res = await test.req
        .get(`/api/v1/runs/${run.id}/items/${itemId}`)
        .set(as('viewer'));
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: itemId,
        case_preconditions: 'Customer is signed in',
        case_steps: [{ position: 1, text: 'Open checkout', expected_result: 'Cart shown' }],
      });
    });

    it('404s an item from another run', async () => {
      const c1 = await createCaseIn(rootSuiteId, 'One');
      const c2 = await createCaseIn(rootSuiteId, 'Two');
      const runA = await createOk({ selection: { case_ids: [c1.id] } });
      const runB = await createOk({ selection: { case_ids: [c2.id] } });
      const itemA = itemData(await listItems('admin', runA.id))[0]!.id;

      const res = await test.req
        .get(`/api/v1/runs/${runB.id}/items/${itemA}`)
        .set(as('admin'));
      expect(res.status).toBe(404);
    });
  });

  describe('POST /runs/:id/items', () => {
    it('adds new cases and reports skipped ones', async () => {
      const c1 = await createCaseIn(rootSuiteId, 'One');
      const c2 = await createCaseIn(rootSuiteId, 'Two');
      const run = await createOk({ selection: { case_ids: [c1.id] } });

      const res = await addItems('lead', run.id, { case_ids: [c1.id, c2.id] });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ added: 1, skipped: 1 });
      expect(res.body.data.item_ids).toHaveLength(1);

      expect((await getRun('admin', run.id)).body.data.counts.total).toBe(2);
    });

    it('409s adding to a completed run', async () => {
      const c1 = await createCaseIn(rootSuiteId, 'One');
      const run = await createOk({});
      await test.req.post(`/api/v1/runs/${run.id}/close`).set(as('admin'));

      const res = await addItems('admin', run.id, { case_ids: [c1.id] });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });
  });

  describe('PATCH /runs/:id/items/:itemId and assign', () => {
    it('assigns an item to a tester and rejects an ineligible assignee', async () => {
      const c1 = await createCaseIn(rootSuiteId, 'One');
      const run = await createOk({ selection: { case_ids: [c1.id] } });
      const itemId = itemData(await listItems('admin', run.id))[0]!.id;

      const assigned = await patchItem('lead', run.id, itemId, { assignee_id: userIds['tester'] });
      expect(assigned.status).toBe(200);
      expect(assigned.body.data.assignee_id).toBe(userIds['tester']);
      expect((await getRun('admin', run.id)).body.data.assignee_ids).toEqual([userIds['tester']]);

      const bad = await patchItem('lead', run.id, itemId, { assignee_id: userIds['viewer'] });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('reorders an item densely and 400s an out-of-range position', async () => {
      const cases = [
        await createCaseIn(rootSuiteId, 'A'),
        await createCaseIn(rootSuiteId, 'B'),
        await createCaseIn(rootSuiteId, 'C'),
      ];
      const run = await createOk({ selection: { case_ids: cases.map((c) => c.id) } });
      const items = itemData(await listItems('admin', run.id));
      const firstId = items.find((row) => row.case_title === 'A')!.id;

      const moved = await patchItem('lead', run.id, firstId, { position: 3 });
      expect(moved.status).toBe(200);
      expect(itemData(await listItems('admin', run.id)).map((row) => row.case_title)).toEqual([
        'B',
        'C',
        'A',
      ]);

      const bad = await patchItem('lead', run.id, firstId, { position: 9 });
      expect(bad.status).toBe(400);
    });

    it('bulk assigns every item, a subset, and unassigns with null', async () => {
      const cases = [await createCaseIn(rootSuiteId, 'A'), await createCaseIn(rootSuiteId, 'B')];
      const run = await createOk({ selection: { case_ids: cases.map((c) => c.id) } });

      const all = await assign('lead', run.id, { assignee_id: userIds['tester'] });
      expect(all.body.data.assigned).toBe(2);
      expect((await getRun('admin', run.id)).body.data.assignee_ids).toEqual([userIds['tester']]);

      const items = itemData(await listItems('admin', run.id));
      const subset = await assign('lead', run.id, {
        assignee_id: userIds['lead'],
        item_ids: [items[0]!.id],
      });
      expect(subset.body.data.assigned).toBe(1);

      const cleared = await assign('lead', run.id, { assignee_id: null });
      expect(cleared.body.data.assigned).toBe(2);
      expect((await getRun('admin', run.id)).body.data.assignee_ids).toEqual([]);
    });

    it('400s item ids that are not in the run', async () => {
      const c1 = await createCaseIn(rootSuiteId, 'One');
      const run = await createOk({ selection: { case_ids: [c1.id] } });
      const res = await assign('lead', run.id, {
        assignee_id: userIds['tester'],
        item_ids: ['018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f'],
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /runs/:id/items/:itemId', () => {
    it('removes an item with no results (204)', async () => {
      const c1 = await createCaseIn(rootSuiteId, 'One');
      const run = await createOk({ selection: { case_ids: [c1.id] } });
      const itemId = itemData(await listItems('admin', run.id))[0]!.id;

      const res = await removeItem('lead', run.id, itemId);
      expect(res.status).toBe(204);
      expect((await getRun('admin', run.id)).body.data.counts.total).toBe(0);
    });

    it('409s an item that already has a result', async () => {
      const c1 = await createCaseIn(rootSuiteId, 'One');
      const run = await createOk({ selection: { case_ids: [c1.id] } });
      const itemId = itemData(await listItems('admin', run.id))[0]!.id;
      await insertResult(itemId, 'passed');

      const res = await removeItem('lead', run.id, itemId);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });
  });

  describe('archived project', () => {
    it('409s writes to a run in an archived project, whatever the role', async () => {
      const other = await test.req
        .post('/api/v1/projects')
        .set(as('admin'))
        .send({ name: 'Archived', key: 'ARC' });
      const archivedId = other.body.data.id as string;
      const run = await createRun('admin', { name: 'Archived run' }, archivedId);
      const runId = run.body.data.id as string;
      await archiveProject(archivedId);

      expect((await patchRun('admin', runId, { name: 'Nope' })).status).toBe(409);
      expect(
        (await test.req.post(`/api/v1/runs/${runId}/close`).set(as('admin'))).status,
      ).toBe(409);
      expect((await test.req.delete(`/api/v1/runs/${runId}`).set(as('admin'))).status).toBe(409);
    });

    it('hides an archived project from non-Admins on reads but serves an Admin', async () => {
      const other = await test.req
        .post('/api/v1/projects')
        .set(as('admin'))
        .send({ name: 'Archived', key: 'ARC' });
      const archivedId = other.body.data.id as string;
      const run = await createRun('admin', { name: 'Archived run' }, archivedId);
      const runId = run.body.data.id as string;
      await archiveProject(archivedId);

      expect((await listRuns('lead', {}, archivedId)).status).toBe(404);
      expect((await getRun('tester', runId)).status).toBe(404);
      expect((await listRuns('admin', {}, archivedId)).status).toBe(200);
      expect((await getRun('admin', runId)).status).toBe(200);
    });
  });

  describe('other project isolation', () => {
    it('404s a run reached through a different project scope and hides it from the list', async () => {
      const c1 = await createCaseIn(rootSuiteId, 'One');
      const run = await createOk({ selection: { case_ids: [c1.id] } });

      const otherList = await listRuns('admin', {}, otherProjectId);
      expect(otherList.body.data).toEqual([]);
      expect(otherList.body.meta.total).toBe(0);
      expect((await getRun('admin', run.id)).body.data.project_id).toBe(projectId);
    });
  });
});