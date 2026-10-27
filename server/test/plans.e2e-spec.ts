import { UserRole } from '../src/auth/current-user';
import {
  createTestApp,
  resetDb,
  resetRateLimit,
  seedUser,
  SHARED_FIXTURE_PASSWORD,
  TestApp,
} from './helpers';

/** Plan as it arrives over HTTP (untyped JSON until asserted). */
interface PlanData {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  due_date: string | null;
  run_count: number;
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
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

const planKeys = [
  'counts',
  'created_at',
  'created_by',
  'description',
  'due_date',
  'id',
  'name',
  'project_id',
  'run_count',
  'updated_at',
  'updated_by',
].sort();

const countKeys = [
  'blocked',
  'failed',
  'passed',
  'percent_complete',
  'retest',
  'skipped',
  'total',
  'untested',
].sort();

/**
 * Integration: the plans contract, docs/api-plans.md, against the real scratch
 * database (migrations applied) through the production HTTP wiring. Covers CRUD,
 * validation, the duplicate-name rule, ordering/filtering, the read rollup over
 * runs → items → latest result (a completed run still counts, a soft-deleted run
 * does not) and detach-runs-on-delete (PRD decision 7). Decision logic is also
 * pinned by src/plans/plans.service.spec.ts.
 */
describe('Plans API (integration)', () => {
  let test: TestApp;
  let projectId: string;
  let otherProjectId: string;
  let suiteId: string;
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

    const createProject = async (name: string, key: string): Promise<string> => {
      const res = await test.req.post('/api/v1/projects').set(as('admin')).send({ name, key });
      expect(res.status).toBe(201);
      return res.body.data.id as string;
    };
    projectId = await createProject('Payments', 'PAY');
    otherProjectId = await createProject('Mobile', 'MOB');

    const suite = await test.req
      .post(`/api/v1/projects/${projectId}/suites`)
      .set(as('admin'))
      .send({ name: 'Checkout' });
    expect(suite.status).toBe(201);
    suiteId = suite.body.data.id as string;
  });

  const createPlan = (
    role: UserRole,
    body: Record<string, unknown>,
    targetProjectId = projectId,
  ) =>
    test.req
      .post(`/api/v1/projects/${targetProjectId}/plans`)
      .set(as(role))
      .send(body);

  const createPlanOk = async (
    body: Record<string, unknown> = {},
    role: UserRole = 'admin',
  ): Promise<PlanData> => {
    const res = await createPlan(role, {
      name: 'Release 2.4',
      runs: [{ name: 'Release 2.4 smoke' }],
      ...body,
    });
    expect(res.status).toBe(201);
    return res.body.data as PlanData;
  };

  const listPlans = (
    role: UserRole,
    query: Record<string, unknown> = {},
    targetProjectId = projectId,
  ) => test.req.get(`/api/v1/projects/${targetProjectId}/plans`).set(as(role)).query(query);

  const getPlan = (role: UserRole, id: string) => test.req.get(`/api/v1/plans/${id}`).set(as(role));

  const patchPlan = (role: UserRole, id: string, body: Record<string, unknown>) =>
    test.req.patch(`/api/v1/plans/${id}`).set(as(role)).send(body);

  const deletePlan = (role: UserRole, id: string) =>
    test.req.delete(`/api/v1/plans/${id}`).set(as(role));

  const createCase = async (title: string): Promise<string> => {
    const res = await test.req
      .post(`/api/v1/projects/${projectId}/cases`)
      .set(as('admin'))
      .send({ suite_id: suiteId, title, priority: 'high', type: 'functional' });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };

  /** Creates a run in the project, optionally attached to a plan. */
  const createRun = async (
    caseIds: string[],
    planId?: string,
  ): Promise<{ runId: string; itemIds: string[] }> => {
    const res = await test.req
      .post(`/api/v1/projects/${projectId}/runs`)
      .set(as('admin'))
      .send({
        name: 'Release smoke',
        ...(planId === undefined ? {} : { plan_id: planId }),
        selection: { case_ids: caseIds },
      });
    expect(res.status).toBe(201);
    const runId = res.body.data.id as string;
    const items = await test.req.get(`/api/v1/runs/${runId}/items`).set(as('admin'));
    expect(items.status).toBe(200);
    return { runId, itemIds: (items.body.data as { id: string }[]).map((item) => item.id) };
  };

  const record = (
    runId: string,
    itemId: string,
    body: Record<string, unknown>,
  ) =>
    test.req
      .post(`/api/v1/runs/${runId}/items/${itemId}/results`)
      .set(as('admin'))
      .send(body);

  const archiveProject = async (targetProjectId: string): Promise<void> => {
    const res = await test.req
      .post(`/api/v1/projects/${targetProjectId}/archive`)
      .set(as('admin'));
    expect(res.status).toBe(200);
  };

  describe('roles and envelopes', () => {
    it('lets every authenticated role read the empty plans list', async () => {
      for (const role of ['admin', 'lead', 'tester', 'viewer'] as UserRole[]) {
        const res = await listPlans(role);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          data: [],
          meta: { page: 1, limit: 25, total: 0, total_pages: 1 },
        });
      }
    });

    it('creates as Admin and Lead, and forbids Tester and Viewer', async () => {
      const lead = await createPlan('lead', { name: 'By lead', runs: [{ name: 'Run' }] });
      expect(lead.status).toBe(201);
      for (const role of ['tester', 'viewer'] as UserRole[]) {
        const res = await createPlan(role, {
          name: `By ${role}`,
          runs: [{ name: 'Run' }],
        });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    });

    it('returns the documented plan shape with the exact keys', async () => {
      const plan = await createPlanOk({ description: 'x', due_date: '2026-11-14' });
      expect(Object.keys(plan).sort()).toEqual(planKeys);
      expect(Object.keys(plan.counts).sort()).toEqual(countKeys);
      expect(plan.created_by).toBe(userIds['admin']);
      expect(plan.updated_by).toBe(userIds['admin']);
    });
  });

  describe('create validation', () => {
    it('trims the name and stores blank description as null', async () => {
      const plan = await createPlanOk({ name: '  Release 2.4  ', description: '   ' });
      expect(plan.name).toBe('Release 2.4');
      expect(plan.description).toBeNull();
      expect(plan.due_date).toBeNull();
      expect(plan.run_count).toBe(1);
      expect(plan.counts).toEqual({
        total: 0,
        passed: 0,
        failed: 0,
        blocked: 0,
        retest: 0,
        skipped: 0,
        untested: 0,
        percent_complete: 0,
      });
    });

    it('rejects a missing name, an over-long name and a bad due_date', async () => {
      const missing = await createPlan('admin', { runs: [{ name: 'Run' }] });
      expect(missing.status).toBe(400);
      expect(missing.body.error.code).toBe('VALIDATION_ERROR');
      expect(missing.body.error.details).toContainEqual(
        expect.objectContaining({ field: 'name' }),
      );

      const long = await createPlan('admin', {
        name: 'x'.repeat(121),
        runs: [{ name: 'Run' }],
      });
      expect(long.status).toBe(400);
      expect(long.body.error.details).toContainEqual(
        expect.objectContaining({ field: 'name' }),
      );

      const badDate = await createPlan('admin', {
        name: 'Ok',
        due_date: '2026/11/14',
        runs: [{ name: 'Run' }],
      });
      expect(badDate.status).toBe(400);
      expect(badDate.body.error.details).toContainEqual(
        expect.objectContaining({ field: 'due_date' }),
      );
    });

    it('requires at least one run and caps them at 20', async () => {
      for (const body of [
        { name: 'No runs' },
        { name: 'Empty runs', runs: [] },
        {
          name: 'Too many',
          runs: Array.from({ length: 21 }, (_, index) => ({ name: `Run ${index}` })),
        },
      ]) {
        const res = await createPlan('admin', body);
        expect(res.status).toBe(400);
        expect(res.body.error.details).toContainEqual(
          expect.objectContaining({ field: 'runs' }),
        );
      }
    });

    it('names the offending run by index', async () => {
      const blank = await createPlan('admin', {
        name: 'Release 2.4',
        runs: [{ name: 'Fine' }, { name: '   ' }],
      });
      expect(blank.status).toBe(400);
      expect(blank.body.error.details).toContainEqual(
        expect.objectContaining({ field: 'runs[1].name' }),
      );

      const backwards = await createPlan('admin', {
        name: 'Release 2.4',
        runs: [{ name: 'Fine', start_date: '2026-11-09', due_date: '2026-11-02' }],
      });
      expect(backwards.status).toBe(400);
      expect(backwards.body.error.details).toContainEqual(
        expect.objectContaining({ field: 'runs[0].start_date' }),
      );
    });

    it('rejects unknown fields (whitelist)', async () => {
      const res = await createPlan('admin', { name: 'Ok', nope: true, runs: [{ name: 'Run' }] });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('is 404 for an unknown project and 409 on an archived project', async () => {
      const unknown = await createPlan(
        'admin',
        { name: 'X', runs: [{ name: 'Run' }] },
        '00000000-0000-4000-8000-000000000000',
      );
      expect(unknown.status).toBe(404);
      await archiveProject(otherProjectId);
      const archived = await createPlan(
        'admin',
        { name: 'X', runs: [{ name: 'Run' }] },
        otherProjectId,
      );
      expect(archived.status).toBe(409);
    });
  });

  describe('create with runs', () => {
    it('creates every run under the new plan with its own fields', async () => {
      const plan = await createPlanOk({
        name: 'Release 2.4',
        runs: [
          {
            name: '  Smoke  ',
            description: '  first  ',
            start_date: '2026-11-02',
            due_date: '2026-11-06',
          },
          { name: 'Full regression', description: '   ' },
        ],
      });
      expect(plan.run_count).toBe(2);

      const runs = await test.req
        .get(`/api/v1/projects/${projectId}/runs`)
        .set(as('admin'))
        .query({ plan_id: plan.id });
      expect(runs.status).toBe(200);
      const byName = new Map(
        (runs.body.data as Array<Record<string, unknown>>).map((run) => [run['name'], run]),
      );
      expect(byName.size).toBe(2);
      expect(byName.get('Smoke')).toMatchObject({
        description: 'first',
        start_date: '2026-11-02',
        due_date: '2026-11-06',
        plan_id: plan.id,
        counts: expect.objectContaining({ total: 0 }),
      });
      expect(byName.get('Full regression')).toMatchObject({
        description: null,
        start_date: null,
        due_date: null,
        plan_id: plan.id,
        counts: expect.objectContaining({ total: 0 }),
      });
    });

    it('rolls the plan and earlier runs back when a later run is rejected', async () => {
      const res = await createPlan('admin', {
        name: 'Atomic plan',
        runs: [
          { name: 'Good run' },
          { name: 'Backwards', start_date: '2026-11-09', due_date: '2026-11-02' },
        ],
      });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toContainEqual(
        expect.objectContaining({ field: 'runs[1].start_date' }),
      );

      // The plan was inserted before the failing run, so this proves rollback.
      const plans = await listPlans('admin', { query: 'atomic plan' });
      expect(plans.body.meta.total).toBe(0);

      const runs = await test.req
        .get(`/api/v1/projects/${projectId}/runs`)
        .set(as('admin'))
        .query({ query: 'Good run' });
      expect(runs.body.meta.total).toBe(0);
    });

    it('allows later run deletion to leave a plan with no runs', async () => {
      const plan = await createPlanOk({ name: 'Drained' });
      const runs = await test.req
        .get(`/api/v1/projects/${projectId}/runs`)
        .set(as('admin'))
        .query({ plan_id: plan.id });
      const runId = (runs.body.data as Array<{ id: string }>)[0]?.id;
      expect(runId).toBeDefined();

      expect(
        (await test.req.delete(`/api/v1/runs/${runId}`).set(as('admin'))).status,
      ).toBe(204);

      // Create-only rule: the plan survives, now with zero runs.
      const detail = await getPlan('admin', plan.id);
      expect(detail.status).toBe(200);
      expect(detail.body.data.run_count).toBe(0);
      expect(detail.body.data.counts).toMatchObject({ total: 0, percent_complete: 0 });
    });
  });

  describe('duplicate names', () => {
    it('is 409 naming the field, ignoring case and surrounding spaces', async () => {
      await createPlanOk({ name: 'Release 2.4' });
      const res = await createPlan('admin', {
        name: '  release 2.4 ',
        runs: [{ name: 'Run' }],
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(res.body.error.details).toContainEqual(
        expect.objectContaining({ field: 'name' }),
      );
    });

    it('scopes uniqueness to the project and frees the name on delete', async () => {
      const plan = await createPlanOk({ name: 'Release 2.4' });
      const sameName = await createPlan(
        'admin',
        { name: 'Release 2.4', runs: [{ name: 'Run' }] },
        otherProjectId,
      );
      expect(sameName.status).toBe(201);

      expect((await deletePlan('admin', plan.id)).status).toBe(204);
      const reused = await createPlan('admin', {
        name: 'Release 2.4',
        runs: [{ name: 'Run' }],
      });
      expect(reused.status).toBe(201);
    });
  });

  describe('list', () => {
    it('returns newest first and filters by a case-insensitive name substring', async () => {
      const first = await createPlanOk({ name: 'Alpha' });
      const second = await createPlanOk({ name: 'Bravo' });

      const all = await listPlans('viewer');
      expect(all.status).toBe(200);
      expect((all.body.data as PlanData[]).map((plan) => plan.id)).toEqual([
        second.id,
        first.id,
      ]);
      expect(all.body.meta).toEqual({ page: 1, limit: 25, total: 2, total_pages: 1 });

      const filtered = await listPlans('admin', { query: 'brav' });
      expect((filtered.body.data as PlanData[]).map((plan) => plan.name)).toEqual(['Bravo']);
      expect(filtered.body.meta.total).toBe(1);
    });

    it('honours the sort parameter and puts null due dates last', async () => {
      await createPlanOk({ name: 'Zed', due_date: null });
      await createPlanOk({ name: 'Able', due_date: '2026-11-14' });

      const byName = await listPlans('admin', { sort: 'name' });
      expect((byName.body.data as PlanData[]).map((plan) => plan.name)).toEqual([
        'Able',
        'Zed',
      ]);

      const byDue = await listPlans('admin', { sort: '-due_date' });
      expect((byDue.body.data as PlanData[]).map((plan) => plan.name)).toEqual([
        'Able',
        'Zed',
      ]);

      const badSort = await listPlans('admin', { sort: 'bogus' });
      expect(badSort.status).toBe(400);
    });

    it('paginates', async () => {
      for (let i = 0; i < 3; i += 1) await createPlanOk({ name: `Plan ${i}` });
      const res = await listPlans('admin', { page: 2, limit: 2 });
      expect(res.body.meta).toEqual({ page: 2, limit: 2, total: 3, total_pages: 2 });
      expect(res.body.data).toHaveLength(1);
    });

    it('is 404 for an unknown project and for an archived project as non-Admin', async () => {
      await archiveProject(otherProjectId);
      const unknown = await listPlans('admin', {}, '00000000-0000-4000-8000-000000000000');
      expect(unknown.status).toBe(404);
      const archivedViewer = await listPlans('viewer', {}, otherProjectId);
      expect(archivedViewer.status).toBe(404);
      const archivedAdmin = await listPlans('admin', {}, otherProjectId);
      expect(archivedAdmin.status).toBe(200);
    });
  });

  describe('detail', () => {
    it('returns the plan with its rollup, and 404 for unknown or deleted', async () => {
      const plan = await createPlanOk({ name: 'Release 2.4' });
      const res = await getPlan('tester', plan.id);
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Release 2.4');

      const unknown = await getPlan('admin', '00000000-0000-4000-8000-000000000000');
      expect(unknown.status).toBe(404);

      await deletePlan('admin', plan.id);
      expect((await getPlan('admin', plan.id)).status).toBe(404);
    });

    it('hides an archived project plan from non-Admins', async () => {
      const plan = await createPlanOk({ name: 'Old' }, 'admin');
      await archiveProject(projectId);
      expect((await getPlan('viewer', plan.id)).status).toBe(404);
      expect((await getPlan('admin', plan.id)).status).toBe(200);
    });
  });

  describe('update', () => {
    it('renames, clears description and due_date with explicit null', async () => {
      const plan = await createPlanOk({ description: 'keep?', due_date: '2026-11-14' });
      const res = await patchPlan('lead', plan.id, {
        name: 'Release 2.4 (final)',
        description: null,
        due_date: null,
      });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        name: 'Release 2.4 (final)',
        description: null,
        due_date: null,
      });
    });

    it('is 400 for an empty body and 409 for a duplicate rename', async () => {
      const plan = await createPlanOk({ name: 'Release 2.4' });
      await createPlanOk({ name: 'Other' });

      const empty = await patchPlan('admin', plan.id, {});
      expect(empty.status).toBe(400);
      expect(empty.body.error.code).toBe('VALIDATION_ERROR');

      const clash = await patchPlan('admin', plan.id, { name: 'other' });
      expect(clash.status).toBe(409);
      expect(clash.body.error.details).toContainEqual(
        expect.objectContaining({ field: 'name' }),
      );

      const self = await patchPlan('admin', plan.id, { name: 'Release 2.4' });
      expect(self.status).toBe(200);
    });

    it('is 403 for Tester/Viewer and 404 for an unknown plan', async () => {
      const plan = await createPlanOk({ name: 'Release 2.4' });
      expect((await patchPlan('tester', plan.id, { name: 'X' })).status).toBe(403);
      expect((await patchPlan('viewer', plan.id, { name: 'X' })).status).toBe(403);
      expect(
        (await patchPlan('admin', '00000000-0000-4000-8000-000000000000', { name: 'X' }))
          .status,
      ).toBe(404);
    });
  });

  describe('delete', () => {
    it('detaches its runs (plan_id = null) and keeps them openable', async () => {
      const plan = await createPlanOk({ name: 'Release 2.4' });
      const caseId = await createCase('Refund a paid order');
      const { runId } = await createRun([caseId], plan.id);

      const before = await test.req.get(`/api/v1/runs/${runId}`).set(as('admin'));
      expect(before.body.data.plan_id).toBe(plan.id);

      expect((await deletePlan('admin', plan.id)).status).toBe(204);

      const after = await test.req.get(`/api/v1/runs/${runId}`).set(as('admin'));
      expect(after.status).toBe(200);
      expect(after.body.data.plan_id).toBeNull();

      // And a run can be detached from a plan by PATCH too.
      const second = await createPlanOk({ name: 'Next' });
      const patched = await test.req
        .patch(`/api/v1/runs/${runId}`)
        .set(as('admin'))
        .send({ plan_id: second.id });
      expect(patched.body.data.plan_id).toBe(second.id);
    });

    it('forbids non-writers and 404s an unknown plan', async () => {
      const plan = await createPlanOk({ name: 'Release 2.4' });
      expect((await deletePlan('tester', plan.id)).status).toBe(403);
      expect(
        (await deletePlan('admin', '00000000-0000-4000-8000-000000000000')).status,
      ).toBe(404);
    });
  });

  describe('rollup over runs, items and the latest result', () => {
    it('counts items across a plan run, keeps completed runs, drops deleted runs', async () => {
      const plan = await createPlanOk({ name: 'Release 2.4' });
      const passCase = await createCase('Passes');
      const failCase = await createCase('Fails');
      const { runId, itemIds } = await createRun([passCase, failCase], plan.id);

      // Record: first item passed; second failed (comment required).
      expect((await record(runId, itemIds[0]!, { status: 'passed' })).status).toBe(201);
      expect(
        (await record(runId, itemIds[1]!, { status: 'failed', comment: 'boom' })).status,
      ).toBe(201);

      const detail = await getPlan('admin', plan.id);
      // Two runs: the empty one created with the plan, plus this one.
      expect(detail.body.data.run_count).toBe(2);
      expect(detail.body.data.counts).toMatchObject({
        total: 2,
        passed: 1,
        failed: 1,
        untested: 0,
        percent_complete: 100,
      });

      // A completed run still counts.
      const closed = await test.req.post(`/api/v1/runs/${runId}/close`).set(as('admin'));
      expect(closed.status).toBe(200);
      const afterClose = await getPlan('admin', plan.id);
      expect(afterClose.body.data.counts).toMatchObject({ total: 2, passed: 1, failed: 1 });

      // A second, untested run adds two more items and bumps run_count.
      const extra = await createRun([passCase], plan.id);
      const withExtra = await getPlan('admin', plan.id);
      expect(withExtra.body.data.run_count).toBe(3);
      expect(withExtra.body.data.counts).toMatchObject({ total: 3, untested: 1, passed: 1 });

      // Soft-deleting a run removes it from the rollup (its results are kept).
      const removeExtra = await test.req
        .delete(`/api/v1/runs/${extra.runId}`)
        .set(as('admin'));
      expect(removeExtra.status).toBe(204);
      const afterDelete = await getPlan('admin', plan.id);
      expect(afterDelete.body.data.run_count).toBe(2);
      expect(afterDelete.body.data.counts).toMatchObject({ total: 2, untested: 0 });
    });

    it('sums the plan list rollup per page (a zero-run plan shows zeroes)', async () => {
      const withRuns = await createPlanOk({ name: 'With runs' });
      const empty = await createPlanOk({ name: 'Empty' });
      // A plan starts with a run, so make it zero-run by deleting that run.
      const planRuns = await test.req
        .get(`/api/v1/projects/${projectId}/runs`)
        .set(as('admin'))
        .query({ plan_id: empty.id });
      const planRunId = (planRuns.body.data as Array<{ id: string }>)[0]?.id;
      expect(planRunId).toBeDefined();
      expect(
        (await test.req.delete(`/api/v1/runs/${planRunId}`).set(as('admin'))).status,
      ).toBe(204);

      const caseId = await createCase('Case');
      const { runId, itemIds } = await createRun([caseId], withRuns.id);
      expect((await record(runId, itemIds[0]!, { status: 'passed' })).status).toBe(201);

      const res = await listPlans('admin', { sort: 'name' });
      const byName = new Map(
        (res.body.data as PlanData[]).map((plan) => [plan.name, plan]),
      );
      expect(byName.get('Empty')?.run_count).toBe(0);
      expect(byName.get('Empty')?.counts).toMatchObject({ total: 0, percent_complete: 0 });
      expect(byName.get('With runs')?.counts).toMatchObject({
        total: 1,
        passed: 1,
        percent_complete: 100,
      });
      expect(byName.get('With runs')?.run_count).toBe(2);
    });
  });
});