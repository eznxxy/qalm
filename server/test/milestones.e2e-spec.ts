import { UserRole } from '../src/auth/current-user';
import {
  createTestApp,
  resetDb,
  resetRateLimit,
  seedUser,
  SHARED_FIXTURE_PASSWORD,
  TestApp,
} from './helpers';

/** Milestone as it arrives over HTTP (untyped JSON until asserted). */
interface MilestoneData {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  due_date: string | null;
  status: 'open' | 'completed';
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

const milestoneKeys = [
  'counts',
  'created_at',
  'created_by',
  'description',
  'due_date',
  'id',
  'name',
  'project_id',
  'run_count',
  'status',
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

const ZERO_COUNTS = {
  total: 0,
  passed: 0,
  failed: 0,
  blocked: 0,
  retest: 0,
  skipped: 0,
  untested: 0,
  percent_complete: 0,
};

/**
 * Integration: the milestones contract, docs/api-milestones.md, against the
 * real scratch database (migrations applied) through the production HTTP
 * wiring. Covers CRUD, validation, the duplicate-name rule,
 * ordering/filtering, the derived status and read rollup over attached runs →
 * items → latest result (a completed run still counts, a soft-deleted run does
 * not), attach/detach eligibility, detach-runs-on-delete, and the runs-side
 * milestone link (create, PATCH, filter, plan-embedded rejection). Decision
 * logic is also pinned by src/milestones/milestones.service.spec.ts.
 */
describe('Milestones API (integration)', () => {
  let test: TestApp;
  let projectId: string;
  let otherProjectId: string;
  let suiteId: string;
  const tokens: Partial<Record<UserRole, string>> = {};
  const userIds: Partial<Record<UserRole, string>> = {};
  /** Run names are unique per project, so each fixture gets its own. */
  let fixtureRunSeq = 0;

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
        .set('X-Forwarded-For', '203.0.113.54')
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

  const createMilestone = (
    role: UserRole,
    body: Record<string, unknown>,
    targetProjectId = projectId,
  ) =>
    test.req
      .post(`/api/v1/projects/${targetProjectId}/milestones`)
      .set(as(role))
      .send(body);

  const createMilestoneOk = async (
    body: Record<string, unknown> = {},
    role: UserRole = 'admin',
  ): Promise<MilestoneData> => {
    const res = await createMilestone(role, { name: 'Release 2.4', ...body });
    expect(res.status).toBe(201);
    return res.body.data as MilestoneData;
  };

  const listMilestones = (
    role: UserRole,
    query: Record<string, unknown> = {},
    targetProjectId = projectId,
  ) =>
    test.req
      .get(`/api/v1/projects/${targetProjectId}/milestones`)
      .set(as(role))
      .query(query);

  const getMilestone = (role: UserRole, id: string) =>
    test.req.get(`/api/v1/milestones/${id}`).set(as(role));

  const patchMilestone = (role: UserRole, id: string, body: Record<string, unknown>) =>
    test.req.patch(`/api/v1/milestones/${id}`).set(as(role)).send(body);

  const deleteMilestone = (role: UserRole, id: string) =>
    test.req.delete(`/api/v1/milestones/${id}`).set(as(role));

  const attach = (role: UserRole, id: string, runIds: string[]) =>
    test.req.post(`/api/v1/milestones/${id}/runs`).set(as(role)).send({ run_ids: runIds });

  const detach = (role: UserRole, id: string, runId: string) =>
    test.req.delete(`/api/v1/milestones/${id}/runs/${runId}`).set(as(role));

  const createCase = async (title: string): Promise<string> => {
    const res = await test.req
      .post(`/api/v1/projects/${projectId}/cases`)
      .set(as('admin'))
      .send({ suite_id: suiteId, title, priority: 'high', type: 'functional' });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };

  /** A bare run in the project (no items) — the attach fixtures. */
  const createBareRun = async (
    name = `Run ${++fixtureRunSeq}`,
    targetProjectId = projectId,
    extra: Record<string, unknown> = {},
  ): Promise<string> => {
    const res = await test.req
      .post(`/api/v1/projects/${targetProjectId}/runs`)
      .set(as('admin'))
      .send({ name, ...extra });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };

  /** A run over the given cases, returning its item ids in list order. */
  const createRunWithCases = async (
    caseIds: string[],
  ): Promise<{ runId: string; itemIds: string[] }> => {
    const res = await test.req
      .post(`/api/v1/projects/${projectId}/runs`)
      .set(as('admin'))
      .send({
        name: `Run ${++fixtureRunSeq}`,
        selection: { case_ids: caseIds },
      });
    expect(res.status).toBe(201);
    const runId = res.body.data.id as string;
    const items = await test.req.get(`/api/v1/runs/${runId}/items`).set(as('admin'));
    expect(items.status).toBe(200);
    return { runId, itemIds: (items.body.data as { id: string }[]).map((item) => item.id) };
  };

  const record = (runId: string, itemId: string, status: string) =>
    test.req
      .post(`/api/v1/runs/${runId}/items/${itemId}/results`)
      .set(as('admin'))
      .send({ status });

  const getRun = (id: string) => test.req.get(`/api/v1/runs/${id}`).set(as('admin'));

  const closeRun = async (runId: string): Promise<void> => {
    const res = await test.req.post(`/api/v1/runs/${runId}/close`).set(as('admin'));
    expect(res.status).toBe(200);
  };

  const archiveProject = async (targetProjectId: string): Promise<void> => {
    const res = await test.req
      .post(`/api/v1/projects/${targetProjectId}/archive`)
      .set(as('admin'));
    expect(res.status).toBe(200);
  };

  describe('roles and envelopes', () => {
    it('lets every authenticated role read the empty milestones list', async () => {
      for (const role of ['admin', 'lead', 'tester', 'viewer'] as UserRole[]) {
        const res = await listMilestones(role);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          data: [],
          meta: { page: 1, limit: 25, total: 0, total_pages: 1 },
        });
      }
    });

    it('creates as Admin and Lead, and forbids Tester and Viewer', async () => {
      const lead = await createMilestone('lead', { name: 'By lead' });
      expect(lead.status).toBe(201);
      for (const role of ['tester', 'viewer'] as UserRole[]) {
        const res = await createMilestone(role, { name: `By ${role}` });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    });

    it('returns the documented milestone shape with the exact keys', async () => {
      const milestone = await createMilestoneOk({
        description: 'Ship 2.4.',
        due_date: '2026-11-14',
      });
      expect(Object.keys(milestone).sort()).toEqual(milestoneKeys);
      expect(Object.keys(milestone.counts).sort()).toEqual(countKeys);
      expect(milestone.created_by).toBe(userIds['admin']);
      expect(milestone.updated_by).toBe(userIds['admin']);
      expect(milestone.status).toBe('open');
      expect(milestone.run_count).toBe(0);
      expect(milestone.counts).toEqual(ZERO_COUNTS);
    });

    it('reads a milestone detail as every role', async () => {
      const milestone = await createMilestoneOk();
      for (const role of ['admin', 'lead', 'tester', 'viewer'] as UserRole[]) {
        const res = await getMilestone(role, milestone.id);
        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe(milestone.id);
      }
    });

    it('forbids non-writers on every write route', async () => {
      const milestone = await createMilestoneOk();
      const runId = await createBareRun();
      const attachRes = await test.req
        .post(`/api/v1/projects/${projectId}/milestones`)
        .set(as('tester'))
        .send({ name: 'Nope' });
      expect(attachRes.status).toBe(403);

      for (const role of ['tester', 'viewer'] as UserRole[]) {
        expect((await patchMilestone(role, milestone.id, { name: 'X' })).status).toBe(403);
        expect((await deleteMilestone(role, milestone.id)).status).toBe(403);
        expect((await attach(role, milestone.id, [runId])).status).toBe(403);
        expect((await detach(role, milestone.id, runId)).status).toBe(403);
      }
    });
  });

  describe('create validation', () => {
    it('trims the name and stores blank description as null; fields only is valid', async () => {
      const milestone = await createMilestoneOk({ name: '  Release 2.4  ', description: '   ' });
      expect(milestone.name).toBe('Release 2.4');
      expect(milestone.description).toBeNull();
      expect(milestone.due_date).toBeNull();
      expect(milestone.run_count).toBe(0);
      expect(milestone.status).toBe('open');
      expect(milestone.counts).toEqual(ZERO_COUNTS);
    });

    it('rejects a missing, blank or over-long name and a bad due_date', async () => {
      for (const body of [{}, { name: '   ' }, { name: 'x'.repeat(121) }]) {
        const res = await createMilestone('admin', body);
        expect(res.status).toBe(400);
        expect(res.body.error.details).toContainEqual(
          expect.objectContaining({ field: 'name' }),
        );
      }
      const badDate = await createMilestone('admin', { name: 'Ok', due_date: '2026/11/14' });
      expect(badDate.status).toBe(400);
      expect(badDate.body.error.details).toContainEqual(
        expect.objectContaining({ field: 'due_date' }),
      );
    });

    it('rejects unknown fields, including run_ids (create is fields only)', async () => {
      for (const body of [{ name: 'Ok', nope: true }, { name: 'Ok', run_ids: [] }]) {
        const res = await createMilestone('admin', body);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('409s a duplicate name ignoring case, and frees it after delete', async () => {
      const first = await createMilestoneOk({ name: 'Release 2.4' });
      const duplicate = await createMilestone('admin', { name: 'release 2.4' });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('CONFLICT');
      expect(duplicate.body.error.details).toContainEqual(
        expect.objectContaining({ field: 'name' }),
      );

      expect((await deleteMilestone('admin', first.id)).status).toBe(204);
      await expect(
        createMilestone('admin', { name: 'Release 2.4' }),
      ).resolves.toMatchObject({ status: 201 });
    });

    it('allows the same name in another project', async () => {
      await createMilestoneOk({ name: 'Release 2.4' });
      const other = await createMilestone(
        'admin',
        { name: 'Release 2.4' },
        otherProjectId,
      );
      expect(other.status).toBe(201);
      expect(other.body.data.project_id).toBe(otherProjectId);
    });

    it('is 404 for an unknown project and 409 on an archived project', async () => {
      const unknown = await createMilestone(
        'admin',
        { name: 'X' },
        '00000000-0000-4000-8000-000000000000',
      );
      expect(unknown.status).toBe(404);
      await archiveProject(otherProjectId);
      const archived = await createMilestone('admin', { name: 'X' }, otherProjectId);
      expect(archived.status).toBe(409);
      expect(archived.body.error.code).toBe('CONFLICT');
    });
  });

  describe('list', () => {
    it('sorts by due date by default with undated last in both directions', async () => {
      const later = await createMilestoneOk({ name: 'Later', due_date: '2026-12-01' });
      const sooner = await createMilestoneOk({ name: 'Sooner', due_date: '2026-11-01' });
      const undated = await createMilestoneOk({ name: 'Undated' });

      const asc = await listMilestones('viewer');
      expect(asc.status).toBe(200);
      expect((asc.body.data as MilestoneData[]).map((row) => row.id)).toEqual([
        sooner.id,
        later.id,
        undated.id,
      ]);

      const desc = await listMilestones('viewer', { sort: '-due_date' });
      expect((desc.body.data as MilestoneData[]).map((row) => row.id)).toEqual([
        later.id,
        sooner.id,
        undated.id,
      ]);
    });

    it('sorts by name, filters by substring and by derived status', async () => {
      const alpha = await createMilestoneOk({ name: 'Alpha' });
      const bravo = await createMilestoneOk({ name: 'Bravo' });
      const undated = await createMilestoneOk({ name: 'Deleted', description: null });
      const closed = await createMilestoneOk({ name: 'Charlie completed' });
      const runId = await createBareRun();
      expect((await attach('admin', closed.id, [runId])).status).toBe(200);
      await closeRun(runId);

      const byName = await listMilestones('admin', { sort: 'name' });
      expect((byName.body.data as MilestoneData[]).map((row) => row.name)).toEqual([
        'Alpha',
        'Bravo',
        'Charlie completed',
        'Deleted',
      ]);

      const filtered = await listMilestones('admin', { query: 'brav' });
      expect((filtered.body.data as MilestoneData[]).map((row) => row.name)).toEqual(['Bravo']);
      expect(filtered.body.meta.total).toBe(1);

      const completed = await listMilestones('admin', { status: 'completed' });
      expect((completed.body.data as MilestoneData[]).map((row) => row.id)).toEqual([
        closed.id,
      ]);
      expect(completed.body.meta.total).toBe(1);

      const open = await listMilestones('admin', { status: 'open' });
      expect((open.body.data as MilestoneData[]).map((row) => row.id).sort()).toEqual(
        [alpha.id, bravo.id, undated.id].sort(),
      );
      expect(open.body.meta.total).toBe(3);
    });

    it('paginates with the shared meta shape', async () => {
      await createMilestoneOk({ name: 'Alpha', due_date: '2026-11-01' });
      await createMilestoneOk({ name: 'Bravo', due_date: '2026-11-02' });
      await createMilestoneOk({ name: 'Charlie', due_date: '2026-11-03' });

      const page2 = await listMilestones('admin', { page: 2, limit: 2 });
      expect((page2.body.data as MilestoneData[]).map((row) => row.name)).toEqual(['Charlie']);
      expect(page2.body.meta).toEqual({ page: 2, limit: 2, total: 3, total_pages: 2 });
    });

    it('is 404 for an unknown project and hides an archived one from non-Admins', async () => {
      const unknown = await listMilestones(
        'admin',
        {},
        '00000000-0000-4000-8000-000000000000',
      );
      expect(unknown.status).toBe(404);

      await createMilestone('admin', { name: 'Archived' }, otherProjectId);
      await archiveProject(otherProjectId);
      expect((await listMilestones('lead', {}, otherProjectId)).status).toBe(404);
      expect((await listMilestones('viewer', {}, otherProjectId)).status).toBe(404);
      const admin = await listMilestones('admin', {}, otherProjectId);
      expect(admin.status).toBe(200);
      expect(admin.body.meta.total).toBe(1);
    });
  });

  describe('derived status and counts', () => {
    it('rolls up items by latest result: a completed run still counts', async () => {
      const passCase = await createCase('Card payment');
      const todoCase = await createCase('Refund');
      const { runId, itemIds } = await createRunWithCases([passCase, todoCase]);
      const milestone = await createMilestoneOk();
      expect((await attach('admin', milestone.id, [runId])).status).toBe(200);

      expect((await record(runId, itemIds[0]!, 'passed')).status).toBe(201);
      await closeRun(runId);

      const detail = await getMilestone('viewer', milestone.id);
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({
        status: 'completed',
        run_count: 1,
        counts: { total: 2, passed: 1, untested: 1, percent_complete: 50 },
      });
    });

    it('completes only when every attached live run is closed, and reopens on reopen', async () => {
      const first = await createBareRun('First');
      const second = await createBareRun('Second');
      const milestone = await createMilestoneOk();
      expect((await attach('admin', milestone.id, [first, second])).status).toBe(200);

      await closeRun(first);
      expect((await getMilestone('admin', milestone.id)).body.data.status).toBe('open');

      await closeRun(second);
      expect((await getMilestone('admin', milestone.id)).body.data.status).toBe('completed');

      await test.req.post(`/api/v1/runs/${first}/reopen`).set(as('admin')).expect(200);
      expect((await getMilestone('admin', milestone.id)).body.data.status).toBe('open');
    });

    it('turns completed back to open when an open run is attached', async () => {
      const closed = await createBareRun('Closed');
      const milestone = await createMilestoneOk();
      expect((await attach('admin', milestone.id, [closed])).status).toBe(200);
      await closeRun(closed);
      expect((await getMilestone('admin', milestone.id)).body.data.status).toBe('completed');

      const open = await createBareRun('Open');
      const res = await attach('admin', milestone.id, [open]);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { attached: 1 } });
      expect((await getMilestone('admin', milestone.id)).body.data).toMatchObject({
        status: 'open',
        run_count: 2,
      });
    });

    it('drops a soft-deleted run from run_count and the rollup', async () => {
      const passCase = await createCase('Card payment');
      const { runId } = await createRunWithCases([passCase]);
      const milestone = await createMilestoneOk();
      expect((await attach('admin', milestone.id, [runId])).status).toBe(200);

      expect((await test.req.delete(`/api/v1/runs/${runId}`).set(as('admin'))).status).toBe(204);

      const detail = await getMilestone('admin', milestone.id);
      expect(detail.body.data).toMatchObject({
        status: 'open',
        run_count: 0,
        counts: ZERO_COUNTS,
      });
    });

    it('is open with zeroed counts when it has no runs', async () => {
      const milestone = await createMilestoneOk();
      const detail = await getMilestone('admin', milestone.id);
      expect(detail.body.data).toMatchObject({
        status: 'open',
        run_count: 0,
        counts: ZERO_COUNTS,
      });
    });
  });

  describe('attach runs', () => {
    it('attaches runs with no milestone and reflects them on the runs list', async () => {
      const milestone = await createMilestoneOk({ name: 'Release 2.4' });
      const first = await createBareRun('First');
      const second = await createBareRun('Second');

      const res = await attach('lead', milestone.id, [first, second]);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { attached: 2 } });

      const list = await test.req
        .get(`/api/v1/projects/${projectId}/runs`)
        .set(as('viewer'))
        .query({ milestone_id: milestone.id });
      expect(list.status).toBe(200);
      expect(
        (list.body.data as Array<{ id: string; milestone_id: string; milestone_name: string }>)
          .map((run) => `${run.id}:${run.milestone_id}:${run.milestone_name}`)
          .sort(),
      ).toEqual(
        [first, second].map((runId) => `${runId}:${milestone.id}:Release 2.4`).sort(),
      );
      expect((await getMilestone('admin', milestone.id)).body.data.run_count).toBe(2);
    });

    it('400s an unknown, soft-deleted or other-project run as run_ids[i] unknown run', async () => {
      const milestone = await createMilestoneOk();
      const good = await createBareRun('Good');
      const gone = await createBareRun('Gone');
      expect((await test.req.delete(`/api/v1/runs/${gone}`).set(as('admin'))).status).toBe(204);
      const foreign = await createBareRun('Foreign', otherProjectId);

      for (const [runIds, index] of [
        [[good, gone], 1],
        [[good, '00000000-0000-4000-8000-000000000000'], 1],
        [[foreign, good], 0],
      ] as const) {
        const res = await attach('admin', milestone.id, [...runIds]);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.details).toContainEqual(
          expect.objectContaining({ field: `run_ids[${index}]`, issue: 'unknown run' }),
        );
      }
      // The whole request is atomic: the valid first run stays unattached.
      expect((await getRun(good)).body.data.milestone_id).toBeNull();
    });

    it('400s a run that is already in a milestone rather than moving it silently', async () => {
      const milestone = await createMilestoneOk({ name: 'Target' });
      const other = await createMilestoneOk({ name: 'Other' });
      const runId = await createBareRun('Taken');
      expect((await attach('admin', other.id, [runId])).status).toBe(200);

      const res = await attach('admin', milestone.id, [runId]);
      expect(res.status).toBe(400);
      expect(res.body.error.details).toContainEqual(
        expect.objectContaining({ field: 'run_ids[0]', issue: 'already in a milestone' }),
      );
      expect((await getRun(runId)).body.data.milestone_id).toBe(other.id);
    });

    it('400s the same id twice, naming the later index', async () => {
      const milestone = await createMilestoneOk();
      const runId = await createBareRun();

      const res = await attach('admin', milestone.id, [runId, runId]);
      expect(res.status).toBe(400);
      expect(res.body.error.details).toContainEqual(
        expect.objectContaining({ field: 'run_ids[1]', issue: 'duplicate in request' }),
      );
      expect((await getRun(runId)).body.data.milestone_id).toBeNull();
    });

    it('validates the run_ids shape (missing, empty, non-UUID, over 50)', async () => {
      const milestone = await createMilestoneOk();
      const bodies = [
        {},
        { run_ids: [] },
        { run_ids: ['nope'] },
        { run_ids: Array.from({ length: 51 }, () => '00000000-0000-4000-8000-000000000000') },
      ];
      for (const body of bodies) {
        const res = await test.req
          .post(`/api/v1/milestones/${milestone.id}/runs`)
          .set(as('admin'))
          .send(body);
        expect(res.status).toBe(400);
        expect(res.body.error.details).toContainEqual(
          expect.objectContaining({ field: 'run_ids' }),
        );
      }
    });

    it('404s an unknown or deleted milestone and 409s an archived project', async () => {
      const runId = await createBareRun();
      expect(
        (await attach('admin', '00000000-0000-4000-8000-000000000000', [runId])).status,
      ).toBe(404);

      const milestone = await createMilestoneOk();
      expect((await deleteMilestone('admin', milestone.id)).status).toBe(204);
      expect((await attach('admin', milestone.id, [runId])).status).toBe(404);

      const archived = await createMilestone('admin', { name: 'Archived' }, otherProjectId);
      const archivedId = archived.body.data.id as string;
      const archivedRun = await createBareRun('Archived run', otherProjectId);
      await archiveProject(otherProjectId);
      expect((await attach('admin', archivedId, [archivedRun])).status).toBe(409);
    });
  });

  describe('detach a run', () => {
    it('detaches one run, keeping the run and its items', async () => {
      const testCase = await createCase('Card payment');
      const { runId } = await createRunWithCases([testCase]);
      const milestone = await createMilestoneOk();
      expect((await attach('admin', milestone.id, [runId])).status).toBe(200);

      const res = await detach('lead', milestone.id, runId);
      expect(res.status).toBe(204);

      const run = await getRun(runId);
      expect(run.status).toBe(200);
      expect(run.body.data.milestone_id).toBeNull();
      expect(run.body.data.milestone_name).toBeNull();

      const items = await test.req.get(`/api/v1/runs/${runId}/items`).set(as('admin'));
      expect(items.body.data).toHaveLength(1);
      expect((await getMilestone('admin', milestone.id)).body.data.run_count).toBe(0);
    });

    it('detaches a completed run (closing never locks its milestone)', async () => {
      const milestone = await createMilestoneOk();
      const runId = await createBareRun();
      expect((await attach('admin', milestone.id, [runId])).status).toBe(200);
      await closeRun(runId);

      expect((await detach('admin', milestone.id, runId)).status).toBe(204);
      expect((await getRun(runId)).body.data.milestone_id).toBeNull();
    });

    it('404s alike for an unknown milestone, unknown run and run not attached here', async () => {
      const milestone = await createMilestoneOk();
      const other = await createMilestoneOk({ name: 'Other' });
      const elsewhere = await createBareRun('Elsewhere');
      const loose = await createBareRun('Loose');
      expect((await attach('admin', other.id, [elsewhere])).status).toBe(200);

      for (const [milestoneId, runId] of [
        ['00000000-0000-4000-8000-000000000000', loose],
        [milestone.id, '00000000-0000-4000-8000-000000000000'],
        [milestone.id, elsewhere],
        [milestone.id, loose],
      ] as const) {
        const res = await detach('admin', milestoneId, runId);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
        expect(res.body.error.message).toBe('Milestone or run not found.');
      }
      expect((await getRun(elsewhere)).body.data.milestone_id).toBe(other.id);
    });

    it('404s a deleted milestone and 409s an archived project', async () => {
      const milestone = await createMilestoneOk();
      const runId = await createBareRun();
      expect((await attach('admin', milestone.id, [runId])).status).toBe(200);
      expect((await deleteMilestone('admin', milestone.id)).status).toBe(204);
      expect((await detach('admin', milestone.id, runId)).status).toBe(404);

      const archived = await createMilestone('admin', { name: 'Archived' }, otherProjectId);
      const archivedId = archived.body.data.id as string;
      const archivedRun = await createBareRun('Archived run', otherProjectId);
      expect((await attach('admin', archivedId, [archivedRun])).status).toBe(200);
      await archiveProject(otherProjectId);
      expect((await detach('admin', archivedId, archivedRun)).status).toBe(409);
    });
  });

  describe('update', () => {
    it('applies a non-empty subset and clears fields with explicit nulls', async () => {
      const milestone = await createMilestoneOk({
        description: 'Old',
        due_date: '2026-11-01',
      });

      const res = await patchMilestone('lead', milestone.id, {
        name: '  Renamed  ',
        description: null,
        due_date: null,
      });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        name: 'Renamed',
        description: null,
        due_date: null,
        updated_by: userIds['lead'],
      });
    });

    it('400s an empty body and a bad due_date', async () => {
      const milestone = await createMilestoneOk();
      const empty = await patchMilestone('admin', milestone.id, {});
      expect(empty.status).toBe(400);
      expect(empty.body.error.code).toBe('VALIDATION_ERROR');
      const badDate = await patchMilestone('admin', milestone.id, { due_date: '11/14/2026' });
      expect(badDate.status).toBe(400);
    });

    it('409s a rename onto another live name, allowing its own case change', async () => {
      const first = await createMilestoneOk({ name: 'Alpha' });
      await createMilestoneOk({ name: 'Bravo' });

      const clash = await patchMilestone('admin', first.id, { name: 'bravo' });
      expect(clash.status).toBe(409);
      expect(clash.body.error.details).toContainEqual(
        expect.objectContaining({ field: 'name' }),
      );
      expect((await patchMilestone('admin', first.id, { name: 'ALPHA' })).status).toBe(200);
    });

    it('never touches a run’s own dates when the milestone due date moves', async () => {
      const milestone = await createMilestoneOk({ due_date: '2026-11-01' });
      const runId = await createBareRun('Dated run', projectId, {
        start_date: '2026-11-02',
        due_date: '2026-11-03',
      });
      expect((await attach('admin', milestone.id, [runId])).status).toBe(200);

      expect(
        (await patchMilestone('admin', milestone.id, { due_date: '2026-12-01' })).status,
      ).toBe(200);
      const run = await getRun(runId);
      expect(run.body.data).toMatchObject({
        start_date: '2026-11-02',
        due_date: '2026-11-03',
      });
    });

    it('404s unknown and deleted milestones and 409s an archived project', async () => {
      expect(
        (await patchMilestone('admin', '00000000-0000-4000-8000-000000000000', { name: 'X' }))
          .status,
      ).toBe(404);

      const gone = await createMilestoneOk();
      expect((await deleteMilestone('admin', gone.id)).status).toBe(204);
      expect((await patchMilestone('admin', gone.id, { name: 'X' })).status).toBe(404);

      const archived = await createMilestone('admin', { name: 'Archived' }, otherProjectId);
      await archiveProject(otherProjectId);
      expect(
        (await patchMilestone('admin', archived.body.data.id as string, { name: 'X' })).status,
      ).toBe(409);
    });
  });

  describe('delete', () => {
    it('detaches its runs, keeps them live and frees the name', async () => {
      const milestone = await createMilestoneOk({ name: 'Release 2.4' });
      const first = await createBareRun('First');
      const second = await createBareRun('Second');
      expect((await attach('admin', milestone.id, [first, second])).status).toBe(200);

      expect((await deleteMilestone('lead', milestone.id)).status).toBe(204);

      for (const runId of [first, second]) {
        const run = await getRun(runId);
        expect(run.status).toBe(200);
        expect(run.body.data).toMatchObject({ milestone_id: null, milestone_name: null });
      }
      expect((await getMilestone('admin', milestone.id)).status).toBe(404);
      expect((await listMilestones('admin')).body.meta.total).toBe(0);

      expect((await createMilestone('admin', { name: 'Release 2.4' })).status).toBe(201);
    });

    it('404s an unknown or already deleted milestone and 409s an archived project', async () => {
      expect(
        (await deleteMilestone('admin', '00000000-0000-4000-8000-000000000000')).status,
      ).toBe(404);

      const gone = await createMilestoneOk();
      expect((await deleteMilestone('admin', gone.id)).status).toBe(204);
      expect((await deleteMilestone('admin', gone.id)).status).toBe(404);

      const archived = await createMilestone('admin', { name: 'Archived' }, otherProjectId);
      await archiveProject(otherProjectId);
      expect((await deleteMilestone('admin', archived.body.data.id as string)).status).toBe(409);
    });
  });

  describe('runs-side milestone link', () => {
    it('creates a run in a milestone and returns its current name', async () => {
      const milestone = await createMilestoneOk({ name: 'Release 2.4' });
      const res = await test.req
        .post(`/api/v1/projects/${projectId}/runs`)
        .set(as('lead'))
        .send({ name: 'Linked run', milestone_id: milestone.id });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        milestone_id: milestone.id,
        milestone_name: 'Release 2.4',
      });

      const renamed = await patchMilestone('admin', milestone.id, { name: 'Release 2.5' });
      expect(renamed.body.data.name).toBe('Release 2.5');
      expect((await getRun(res.body.data.id as string)).body.data.milestone_name).toBe(
        'Release 2.5',
      );
    });

    it('400s a milestone_id that is unknown, deleted or from another project', async () => {
      const gone = await createMilestoneOk();
      expect((await deleteMilestone('admin', gone.id)).status).toBe(204);
      const foreign = await createMilestone('admin', { name: 'Foreign' }, otherProjectId);

      for (const milestoneId of [
        '00000000-0000-4000-8000-000000000000',
        gone.id,
        foreign.body.data.id as string,
      ]) {
        const res = await test.req
          .post(`/api/v1/projects/${projectId}/runs`)
          .set(as('admin'))
          .send({ name: `Bad ${++fixtureRunSeq}`, milestone_id: milestoneId });
        expect(res.status).toBe(400);
        expect(res.body.error.details).toContainEqual(
          expect.objectContaining({ field: 'milestone_id' }),
        );
      }
    });

    it('moves a run between milestones and detaches with an explicit null', async () => {
      const first = await createMilestoneOk({ name: 'First' });
      const second = await createMilestoneOk({ name: 'Second' });
      const runId = await createBareRun('Movable');
      expect((await attach('admin', first.id, [runId])).status).toBe(200);

      const moved = await test.req
        .patch(`/api/v1/runs/${runId}`)
        .set(as('lead'))
        .send({ milestone_id: second.id });
      expect(moved.status).toBe(200);
      expect(moved.body.data).toMatchObject({
        milestone_id: second.id,
        milestone_name: 'Second',
      });
      expect((await getMilestone('admin', first.id)).body.data.run_count).toBe(0);
      expect((await getMilestone('admin', second.id)).body.data.run_count).toBe(1);

      const detached = await test.req
        .patch(`/api/v1/runs/${runId}`)
        .set(as('lead'))
        .send({ milestone_id: null });
      expect(detached.status).toBe(200);
      expect(detached.body.data).toMatchObject({ milestone_id: null, milestone_name: null });
    });

    it('filters the runs list by milestone_id and by the none sentinel', async () => {
      const milestone = await createMilestoneOk();
      const inMilestone = await createBareRun('In milestone', projectId, {
        milestone_id: milestone.id,
      });
      const loose = await createBareRun('Loose');

      const scoped = await test.req
        .get(`/api/v1/projects/${projectId}/runs`)
        .set(as('admin'))
        .query({ milestone_id: milestone.id });
      expect((scoped.body.data as Array<{ id: string }>).map((run) => run.id)).toEqual([
        inMilestone,
      ]);

      const none = await test.req
        .get(`/api/v1/projects/${projectId}/runs`)
        .set(as('admin'))
        .query({ milestone_id: 'none' });
      expect((none.body.data as Array<{ id: string }>).map((run) => run.id)).toEqual([loose]);

      const bad = await test.req
        .get(`/api/v1/projects/${projectId}/runs`)
        .set(as('admin'))
        .query({ milestone_id: 'nope' });
      expect(bad.status).toBe(400);
    });

    it('rejects milestone_id on a plan-embedded run (attach afterwards)', async () => {
      const milestone = await createMilestoneOk();
      const res = await test.req
        .post(`/api/v1/projects/${projectId}/plans`)
        .set(as('admin'))
        .send({
          name: 'Release 2.4',
          runs: [{ name: 'Embedded', milestone_id: milestone.id }],
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect((await listMilestones('admin')).body.meta.total).toBe(1);
    });
  });
});