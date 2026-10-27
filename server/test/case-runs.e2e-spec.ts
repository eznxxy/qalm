import { UserRole } from '../src/auth/current-user';
import {
  createTestApp,
  resetDb,
  resetRateLimit,
  seedUser,
  SHARED_FIXTURE_PASSWORD,
  TestApp,
} from './helpers';

/** One entry of the Linked runs feed (untyped JSON until asserted). */
interface CaseRunData {
  run_id: string;
  run_name: string;
  run_status: 'open' | 'completed';
  plan_id: string | null;
  item_id: string;
  status: string;
  updated_at: string;
}

const entryKeys = [
  'item_id',
  'plan_id',
  'run_id',
  'run_name',
  'run_status',
  'status',
  'updated_at',
].sort();

/**
 * Integration: `GET /cases/:id/runs`, docs/api-runs.md § Linked runs, against the
 * real scratch database through the production HTTP wiring. Covers the case
 * lookup + archived-project rules, newest-run-first ordering, per-run item
 * status, exclusion of soft-deleted runs and pagination.
 */
describe('Case → Linked runs API (integration)', () => {
  let test: TestApp;
  let projectId: string;
  let suiteId: string;
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
    for (const role of ['admin', 'lead', 'tester', 'viewer'] as UserRole[]) {
      const email = `${role}@example.com`;
      await seedUser(test.db, { email, role, name: `${role} User` });
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

    const suite = await test.req
      .post(`/api/v1/projects/${projectId}/suites`)
      .set(as('admin'))
      .send({ name: 'Checkout' });
    expect(suite.status).toBe(201);
    suiteId = suite.body.data.id as string;
  });

  const createCase = async (title: string): Promise<string> => {
    const res = await test.req
      .post(`/api/v1/projects/${projectId}/cases`)
      .set(as('admin'))
      .send({ suite_id: suiteId, title, priority: 'high', type: 'functional' });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };

  const createRun = async (
    name: string,
    caseIds: string[],
    planId?: string,
  ): Promise<{ runId: string; itemIds: string[] }> => {
    const res = await test.req
      .post(`/api/v1/projects/${projectId}/runs`)
      .set(as('admin'))
      .send({
        name,
        ...(planId === undefined ? {} : { plan_id: planId }),
        selection: { case_ids: caseIds },
      });
    expect(res.status).toBe(201);
    const runId = res.body.data.id as string;
    const items = await test.req.get(`/api/v1/runs/${runId}/items`).set(as('admin'));
    return { runId, itemIds: (items.body.data as { id: string }[]).map((item) => item.id) };
  };

  const linkedRuns = (role: UserRole, caseId: string, query: Record<string, unknown> = {}) =>
    test.req.get(`/api/v1/cases/${caseId}/runs`).set(as(role)).query(query);

  const feed = (res: { body: unknown }): CaseRunData[] =>
    (res.body as { data: CaseRunData[] }).data;

  it('lets every authenticated role read the feed', async () => {
    const caseId = await createCase('Refund a paid order');
    await createRun('Release smoke', [caseId]);
    for (const role of ['admin', 'lead', 'tester', 'viewer'] as UserRole[]) {
      const res = await linkedRuns(role, caseId);
      expect(res.status).toBe(200);
      expect(feed(res)).toHaveLength(1);
    }
  });

  it('returns an empty feed for a case in no run, with exact keys', async () => {
    const lonely = await createCase('Never run');
    const res = await linkedRuns('admin', lonely);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [],
      meta: { page: 1, limit: 25, total: 0, total_pages: 1 },
    });

    const caseId = await createCase('Refund a paid order');
    const plan = await test.req
      .post(`/api/v1/projects/${projectId}/plans`)
      .set(as('admin'))
      .send({ name: 'Release 2.4', runs: [{ name: 'Release 2.4 smoke' }] });
    expect(plan.status).toBe(201);
    const { runId, itemIds } = await createRun(
      'Release smoke',
      [caseId],
      plan.body.data.id as string,
    );
    // Record a result so the item has a concrete status.
    const recorded = await test.req
      .post(`/api/v1/runs/${runId}/items/${itemIds[0]}/results`)
      .set(as('admin'))
      .send({ status: 'passed' });
    expect(recorded.status).toBe(201);

    const filled = await linkedRuns('admin', caseId);
    expect(Object.keys(feed(filled)[0]!).sort()).toEqual(entryKeys);
    expect(feed(filled)[0]).toMatchObject({
      run_id: runId,
      run_name: 'Release smoke',
      run_status: 'open',
      plan_id: plan.body.data.id,
      item_id: itemIds[0],
      status: 'passed',
    });
  });

  it('lists every containing run newest-first with the case status in each', async () => {
    const caseId = await createCase('Refund a paid order');
    const older = await createRun('Older run', [caseId]);
    const newer = await createRun('Newer run', [caseId]);

    // Only the newer run gets a result; the older stays `untested`.
    const recorded = await test.req
      .post(`/api/v1/runs/${newer.runId}/items/${newer.itemIds[0]}/results`)
      .set(as('admin'))
      .send({ status: 'failed', comment: 'boom' });
    expect(recorded.status).toBe(201);

    // Completing a run is reflected in `run_status`.
    const close = await test.req
      .post(`/api/v1/runs/${newer.runId}/close`)
      .set(as('admin'));
    expect(close.status).toBe(200);

    const res = await linkedRuns('admin', caseId);
    expect(res.status).toBe(200);
    const rows = feed(res);
    expect(rows.map((row) => row.run_id)).toEqual([newer.runId, older.runId]);
    expect(rows[0]).toMatchObject({ run_status: 'completed', status: 'failed' });
    expect(rows[1]).toMatchObject({ run_status: 'open', status: 'untested' });
  });

  it('excludes a soft-deleted run', async () => {
    const caseId = await createCase('Refund a paid order');
    const kept = await createRun('Kept run', [caseId]);
    const removed = await createRun('Removed run', [caseId]);

    const del = await test.req
      .delete(`/api/v1/runs/${removed.runId}`)
      .set(as('admin'));
    expect(del.status).toBe(204);

    const res = await linkedRuns('admin', caseId);
    expect(feed(res).map((row) => row.run_id)).toEqual([kept.runId]);
  });

  it('paginates', async () => {
    const caseId = await createCase('Refund a paid order');
    for (let i = 0; i < 3; i += 1) await createRun(`Run ${i}`, [caseId]);

    const res = await linkedRuns('admin', caseId, { page: 1, limit: 2 });
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 2, total: 3, total_pages: 2 });
    expect(feed(res)).toHaveLength(2);

    const bad = await linkedRuns('admin', caseId, { limit: 101 });
    expect(bad.status).toBe(400);
  });

  it('is 404 for an unknown or deleted case', async () => {
    const unknown = await linkedRuns('admin', '00000000-0000-4000-8000-000000000000');
    expect(unknown.status).toBe(404);

    const caseId = await createCase('Refund a paid order');
    const del = await test.req.delete(`/api/v1/cases/${caseId}`).set(as('admin'));
    expect(del.status).toBe(204);
    expect((await linkedRuns('admin', caseId)).status).toBe(404);
  });

  it('hides an archived project feed from non-Admins', async () => {
    const caseId = await createCase('Refund a paid order');
    await createRun('Release smoke', [caseId]);
    const archive = await test.req
      .post(`/api/v1/projects/${projectId}/archive`)
      .set(as('admin'));
    expect(archive.status).toBe(200);

    expect((await linkedRuns('viewer', caseId)).status).toBe(404);
    expect((await linkedRuns('admin', caseId)).status).toBe(200);
  });
});