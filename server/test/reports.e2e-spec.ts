import { UserRole } from '../src/auth/current-user';
import {
  createTestApp,
  resetDb,
  resetRateLimit,
  seedUser,
  SHARED_FIXTURE_PASSWORD,
  TestApp,
} from './helpers';

/** Trend as it arrives over HTTP (untyped JSON until asserted). */
interface TrendBucketData {
  date: string;
  status_counts: {
    passed: number;
    failed: number;
    blocked: number;
    retest: number;
    skipped: number;
  };
  total: number;
  pass_rate: number | null;
}

interface TrendData {
  project_id: string;
  from: string;
  to: string;
  days: number;
  buckets: TrendBucketData[];
  totals: {
    status_counts: Record<string, number>;
    total: number;
    pass_rate: number | null;
  };
}

/** One progress row as it arrives over HTTP, docs/api-reports.md § Resource. */
interface ProgressRunData {
  id: string;
  name: string;
  status: 'open' | 'completed';
  plan_id: string | null;
  plan_name: string | null;
  milestone_id: string | null;
  milestone_name: string | null;
  start_date: string | null;
  due_date: string | null;
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
  pass_rate: number | null;
  results_in_window: number;
  last_result_at: string | null;
}

interface ProgressData {
  data: ProgressRunData[];
  meta: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
  items: {
    total: number;
    with_results: number;
    untested: number;
    percent_complete: number;
  };
}

interface SummaryData {
  project_id: string;
  from: string;
  to: string;
  days: number;
  filters: {
    plan_id: string | null;
    milestone_id: string | null;
    status: 'open' | 'completed' | null;
  };
  trend: {
    buckets: TrendBucketData[];
    totals: TrendData['totals'];
  };
  progress: ProgressData;
}

const MS_PER_DAY = 86_400_000;

/** The UTC calendar date `offset` days from now, `YYYY-MM-DD`. */
function utcDay(offset: number): string {
  return new Date(Date.now() + offset * MS_PER_DAY).toISOString().slice(0, 10);
}

/** The last `days` UTC dates ending today, oldest first — the expected buckets. */
function expectedDays(days: number): string[] {
  return Array.from({ length: days }, (_unused, index) => utcDay(index - (days - 1)));
}

const zeroCounts = { passed: 0, failed: 0, blocked: 0, retest: 0, skipped: 0 };

describe('GET /api/v1/projects/:projectId/reports/trend', () => {
  let test: TestApp;
  let projectId: string;
  let otherProjectId: string;
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
        .set('X-Forwarded-For', '203.0.113.77')
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
  });

  const getTrend = (role: UserRole, targetProjectId = projectId, query = '') =>
    test.req
      .get(
        `/api/v1/projects/${targetProjectId}/reports/trend${query ? `?${query}` : ''}`,
      )
      .set(as(role));

  const archiveProject = async (targetProjectId: string): Promise<void> => {
    const res = await test.req
      .post(`/api/v1/projects/${targetProjectId}/archive`)
      .set(as('admin'));
    expect(res.status).toBe(200);
  };

  /** Inserts a run directly; the reports read must not depend on the runs API. */
  const insertRun = async (
    targetProjectId: string,
    options: {
      deletedAt?: string | null;
      planId?: string | null;
      milestoneId?: string | null;
      dueDate?: string | null;
      completedAt?: string | null;
      name?: string;
    } = {},
  ): Promise<string> => {
    fixtureRunSeq += 1;
    const completedAt = options.completedAt ?? null;
    // Columns and values are appended in the same order, so the `$n` positions
    // come from the array itself and can never drift.
    const columns = [
      'project_id',
      'deleted_at',
      'plan_id',
      'milestone_id',
      'due_date',
      'completed_at',
    ];
    const values: unknown[] = [
      targetProjectId,
      options.deletedAt ?? null,
      options.planId ?? null,
      options.milestoneId ?? null,
      options.dueDate ?? null,
      completedAt,
    ];
    if (completedAt !== null) {
      // runs_completed_pair rejects a completion without its author.
      columns.push('completed_by');
      values.push(userIds['admin']);
    }
    columns.push('name', 'created_by', 'updated_by');
    values.push(
      options.name ?? `Trend fixture ${fixtureRunSeq}`,
      userIds['admin'],
      userIds['admin'],
    );
    const res = await test.db.query<{ id: string }>(
      `INSERT INTO runs (${columns.join(', ')})
       VALUES (${columns.map((_column, index) => `$${index + 1}`).join(', ')}) RETURNING id`,
      values,
    );
    return res.rows[0]!.id;
  };

  const insertItem = async (runId: string): Promise<string> => {
    const res = await test.db.query<{ id: string }>(
      `INSERT INTO run_items
         (run_id, case_display_id, case_title, case_priority, case_suite_id, position)
       VALUES ($1, $2, $3, 'high', gen_random_uuid(), $4) RETURNING id`,
      [runId, `PAY-${fixtureRunSeq}`, `Case ${fixtureRunSeq}`, 1],
    );
    return res.rows[0]!.id;
  };

  /**
   * Records a result with an explicit `created_at`, which is what the trend
   * buckets by. `failed` needs a comment (DB check).
   */
  const record = async (
    itemId: string,
    status: 'passed' | 'failed' | 'blocked' | 'retest' | 'skipped',
    createdAt: string,
  ): Promise<void> => {
    await test.db.query(
      `INSERT INTO results (run_item_id, status, comment, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        itemId,
        status,
        status === 'failed' ? 'Failed in the fixture' : null,
        userIds['admin'],
        createdAt,
      ],
    );
  };

  /** One live run with one item per result, all created at the given instants. */
  const recordMany = async (
    entries: Array<{
      status: 'passed' | 'failed' | 'blocked' | 'retest' | 'skipped';
      at: string;
    }>,
    targetProjectId = projectId,
  ): Promise<void> => {
    if (entries.length === 0) return;
    const runId = await insertRun(targetProjectId);
    for (const entry of entries) {
      const itemId = await insertItem(runId);
      await record(itemId, entry.status, entry.at);
    }
  };

  const insertPlan = async (targetProjectId: string, name: string): Promise<string> => {
    const res = await test.db.query<{ id: string }>(
      `INSERT INTO plans (project_id, name, created_by, updated_by)
       VALUES ($1, $2, $3, $3) RETURNING id`,
      [targetProjectId, name, userIds['admin']],
    );
    return res.rows[0]!.id;
  };

  const insertMilestone = async (
    targetProjectId: string,
    name: string,
    dueDate?: string,
  ): Promise<string> => {
    const res = await test.db.query<{ id: string }>(
      `INSERT INTO milestones (project_id, name, created_by, updated_by, due_date)
       VALUES ($1, $2, $3, $3, $4) RETURNING id`,
      [targetProjectId, name, userIds['admin'], dueDate ?? null],
    );
    return res.rows[0]!.id;
  };

  const getSummary = (role: UserRole, targetProjectId = projectId, query = '') =>
    test.req
      .get(`/api/v1/projects/${targetProjectId}/reports/summary${query ? `?${query}` : ''}`)
      .set(as(role));

  describe('window', () => {
    it('defaults to 14 zero-filled UTC days ending today', async () => {
      const res = await getTrend('admin');

      expect(res.status).toBe(200);
      const data = res.body.data as TrendData;
      expect(data).toMatchObject({
        project_id: projectId,
        from: utcDay(-13),
        to: utcDay(0),
        days: 14,
      });
      expect(data.buckets.map((bucket) => bucket.date)).toEqual(expectedDays(14));
      for (const bucket of data.buckets) {
        expect(bucket).toEqual({
          date: bucket.date,
          status_counts: zeroCounts,
          total: 0,
          pass_rate: null,
        });
      }
      expect(data.totals).toEqual({
        status_counts: zeroCounts,
        total: 0,
        pass_rate: null,
      });
    });

    it.each([1, 7, 14, 30, 90])('echoes and fills exactly %i days', async (days) => {
      const res = await getTrend('admin', projectId, `days=${days}`);

      expect(res.status).toBe(200);
      const data = res.body.data as TrendData;
      expect(data.from).toBe(utcDay(-(days - 1)));
      expect(data.to).toBe(utcDay(0));
      expect(data.days).toBe(days);
      expect(data.buckets.map((bucket) => bucket.date)).toEqual(expectedDays(days));
    });

    it('400s a window outside 1–90 or not an integer', async () => {
      for (const query of ['days=0', 'days=91', 'days=abc', 'days=1.5', 'days=7&days=14']) {
        const res = await getTrend('admin', projectId, query);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.details).toContainEqual(
          expect.objectContaining({ field: 'days' }),
        );
      }
    });

    it('400s an unknown project id shape before any query', async () => {
      const res = await getTrend('admin', 'not-a-uuid');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('what is counted', () => {
    it('includes the first instant of the window and the last millisecond of today', async () => {
      await recordMany([
        { status: 'passed', at: `${utcDay(-6)}T00:00:00.000Z` },
        { status: 'failed', at: `${utcDay(0)}T23:59:59.999Z` },
      ]);

      const data = (await getTrend('admin', projectId, 'days=7')).body.data as TrendData;

      expect(data.buckets[0]).toMatchObject({
        date: utcDay(-6),
        total: 1,
        status_counts: { ...zeroCounts, passed: 1 },
        pass_rate: 100,
      });
      expect(data.buckets[6]).toMatchObject({
        date: utcDay(0),
        total: 1,
        status_counts: { ...zeroCounts, failed: 1 },
        pass_rate: 0,
      });
      expect(data.totals).toMatchObject({ total: 2, pass_rate: 50 });
    });

    it('excludes the millisecond before the window and anything after today', async () => {
      await recordMany([
        { status: 'passed', at: `${utcDay(-7)}T23:59:59.999Z` },
        { status: 'passed', at: `${utcDay(1)}T00:00:00.000Z` },
      ]);

      const data = (await getTrend('admin', projectId, 'days=7')).body.data as TrendData;

      expect(data.totals.total).toBe(0);
      expect(data.buckets.every((bucket) => bucket.total === 0)).toBe(true);
    });

    it('leaves another project out of this project’s trend', async () => {
      const otherRun = await insertRun(otherProjectId);
      await record(await insertItem(otherRun), 'passed', `${utcDay(0)}T10:00:00.000Z`);

      const data = (await getTrend('admin', projectId, 'days=7')).body.data as TrendData;

      expect(data.totals.total).toBe(0);
    });

    it('drops a soft-deleted run’s results from the window', async () => {
      const live = await insertRun(projectId);
      await record(await insertItem(live), 'passed', `${utcDay(0)}T10:00:00.000Z`);
      const deleted = await insertRun(projectId, {
        deletedAt: `${utcDay(0)}T12:00:00.000Z`,
      });
      await record(await insertItem(deleted), 'failed', `${utcDay(0)}T11:00:00.000Z`);

      const data = (await getTrend('admin', projectId, 'days=7')).body.data as TrendData;

      expect(data.buckets[6]).toMatchObject({
        total: 1,
        status_counts: { ...zeroCounts, passed: 1 },
        pass_rate: 100,
      });
    });

    it('counts every result row, so a retest is a second event on its day', async () => {
      const runId = await insertRun(projectId);
      const itemId = await insertItem(runId);
      await record(itemId, 'failed', `${utcDay(0)}T09:00:00.000Z`);
      await record(itemId, 'passed', `${utcDay(0)}T10:00:00.000Z`);

      const data = (await getTrend('admin', projectId, 'days=1')).body.data as TrendData;

      expect(data.buckets).toHaveLength(1);
      expect(data.buckets[0]).toMatchObject({
        total: 2,
        status_counts: { ...zeroCounts, passed: 1, failed: 1 },
        pass_rate: 50,
      });
    });
  });

  describe('rates and totals', () => {
    it('leaves skipped out of the denominator and a verdict-less day null', async () => {
      await recordMany([
        { status: 'passed', at: `${utcDay(-2)}T09:00:00.000Z` },
        { status: 'skipped', at: `${utcDay(-2)}T10:00:00.000Z` },
        { status: 'skipped', at: `${utcDay(-1)}T10:00:00.000Z` },
      ]);

      const data = (await getTrend('admin', projectId, 'days=7')).body.data as TrendData;

      expect(data.buckets[4]).toMatchObject({
        date: utcDay(-2),
        total: 2,
        status_counts: { ...zeroCounts, passed: 1, skipped: 1 },
        pass_rate: 100,
      });
      expect(data.buckets[5]).toMatchObject({
        date: utcDay(-1),
        total: 1,
        status_counts: { ...zeroCounts, skipped: 1 },
        pass_rate: null,
      });
      expect(data.buckets[6]).toMatchObject({ total: 0, pass_rate: null });
      expect(data.totals).toMatchObject({
        status_counts: { ...zeroCounts, passed: 1, skipped: 2 },
        total: 3,
        pass_rate: 100,
      });
    });

    it('counts blocked against the rate and recomputes the window rate from the sums', async () => {
      await recordMany([
        { status: 'passed', at: `${utcDay(-2)}T09:00:00.000Z` },
        { status: 'passed', at: `${utcDay(-2)}T09:01:00.000Z` },
        { status: 'passed', at: `${utcDay(-2)}T09:02:00.000Z` },
        { status: 'failed', at: `${utcDay(-2)}T09:03:00.000Z` },
        { status: 'passed', at: `${utcDay(-1)}T09:00:00.000Z` },
        { status: 'blocked', at: `${utcDay(-1)}T09:01:00.000Z` },
      ]);

      const data = (await getTrend('admin', projectId, 'days=7')).body.data as TrendData;

      expect(data.buckets[4]!.pass_rate).toBe(75);
      expect(data.buckets[5]!.pass_rate).toBe(50);
      // 4 passed / (4 + 1 failed + 1 blocked) = 66.7 — not the mean of 75 and 50.
      expect(data.totals).toMatchObject({
        status_counts: { ...zeroCounts, passed: 4, failed: 1, blocked: 1 },
        total: 6,
        pass_rate: 66.7,
      });
    });
  });

  describe('roles and visibility', () => {
    it('lets every authenticated role read the same trend', async () => {
      await recordMany([{ status: 'passed', at: `${utcDay(0)}T08:00:00.000Z` }]);

      const bodies: string[] = [];
      for (const role of ['admin', 'lead', 'tester', 'viewer'] as UserRole[]) {
        const res = await getTrend(role, projectId, 'days=7');
        expect(res.status).toBe(200);
        expect(res.body.error).toBeUndefined();
        bodies.push(JSON.stringify(res.body.data));
      }
      expect(new Set(bodies).size).toBe(1);
    });

    it('404s an unknown project', async () => {
      const res = await getTrend('admin', '00000000-0000-4000-8000-000000000000');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('shows an archived project to an Admin but hides it from everyone else', async () => {
      await recordMany([{ status: 'passed', at: `${utcDay(0)}T08:00:00.000Z` }]);
      await archiveProject(projectId);

      const admin = await getTrend('admin', projectId, 'days=7');
      expect(admin.status).toBe(200);
      expect((admin.body.data as TrendData).totals.total).toBe(1);

      for (const role of ['lead', 'tester', 'viewer'] as UserRole[]) {
        const res = await getTrend(role, projectId, 'days=7');
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('GET /projects/:projectId/reports/summary', () => {
    it('defaults to 30 buckets and echoes the resolved window and filters', async () => {
      const res = await getSummary('viewer');

      expect(res.status).toBe(200);
      const data = res.body.data as SummaryData;
      expect(data).toMatchObject({
        project_id: projectId,
        from: utcDay(-29),
        to: utcDay(0),
        days: 30,
        filters: { plan_id: null, milestone_id: null, status: null },
      });
      expect(data.trend.buckets.map((bucket) => bucket.date)).toEqual(expectedDays(30));
      expect(data.trend.buckets[29]).toEqual({
        date: utcDay(0),
        status_counts: zeroCounts,
        total: 0,
        pass_rate: null,
      });
      expect(data.progress).toEqual({
        data: [],
        meta: { page: 1, limit: 25, total: 0, total_pages: 1 },
        items: { total: 0, with_results: 0, untested: 0, percent_complete: 0 },
      });
    });

    it('days=1 is a single bucket ending today', async () => {
      const data = (await getSummary('viewer', projectId, 'days=1')).body.data as SummaryData;

      expect(data.days).toBe(1);
      expect(data.from).toBe(utcDay(0));
      expect(data.from).toBe(data.to);
      expect(data.trend.buckets).toHaveLength(1);
      expect(data.trend.buckets[0]).toEqual({
        date: utcDay(0),
        status_counts: zeroCounts,
        total: 0,
        pass_rate: null,
      });
    });

    it('rejects days=0, days=91 and days=1.5 with a 400 on days', async () => {
      for (const days of ['0', '91', '1.5']) {
        const res = await getSummary('admin', projectId, `days=${days}`);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.details[0].field).toBe('days');
      }
    });

    it('uses UTC day boundaries: 00:00Z on from counts, 23:59:59.999Z on from - 1 does not', async () => {
      await recordMany([
        { status: 'passed', at: `${utcDay(-1)}T00:00:00.000Z` },
        { status: 'failed', at: `${utcDay(-2)}T23:59:59.999Z` },
      ]);

      const data = (await getSummary('admin', projectId, 'days=2')).body.data as SummaryData;

      expect(data.from).toBe(utcDay(-1));
      expect(data.trend.buckets[0]).toMatchObject({
        date: utcDay(-1),
        total: 1,
        status_counts: { ...zeroCounts, passed: 1 },
        pass_rate: 100,
      });
      expect(data.trend.buckets[0]!.status_counts.failed).toBe(0);
      expect(data.trend.totals.total).toBe(1);
      expect(data.progress.data[0]!.results_in_window).toBe(1);
    });

    it('keeps a stale run in progress while its results_in_window is zero', async () => {
      const runId = await insertRun(projectId);
      await record(await insertItem(runId), 'passed', `${utcDay(-40)}T09:00:00.000Z`);

      const data = (await getSummary('admin', projectId, 'days=7')).body.data as SummaryData;

      expect(data.trend.totals.total).toBe(0);
      const run = data.progress.data[0]!;
      expect(run.counts.passed).toBe(1);
      expect(run.counts.percent_complete).toBe(100);
      expect(run.results_in_window).toBe(0);
      // Activity is not window-limited: the last touch is still visible.
      expect(run.last_result_at).toBe(`${utcDay(-40)}T09:00:00.000Z`);
    });

    it('counts a retest in trend without changing the run’s counts', async () => {
      const runId = await insertRun(projectId);
      const itemId = await insertItem(runId);
      await record(itemId, 'passed', `${utcDay(0)}T08:00:00.000Z`);
      await record(itemId, 'retest', `${utcDay(0)}T09:00:00.000Z`);

      const data = (await getSummary('admin', projectId, 'days=7')).body.data as SummaryData;

      expect(data.trend.totals.status_counts).toMatchObject({ passed: 1, retest: 1 });
      expect(data.trend.totals.total).toBe(2);
      const run = data.progress.data[0]!;
      expect(run.counts.retest).toBe(1);
      expect(run.counts.passed).toBe(0);
      expect(run.counts.total).toBe(1);
      expect(run.pass_rate).toBe(0);
      expect(run.results_in_window).toBe(2);
    });

    it('plan_id=none and milestone_id=none select the null groups', async () => {
      const planId = await insertPlan(projectId, 'Release 1');
      const milestoneId = await insertMilestone(projectId, 'Release 1', utcDay(14));
      const linked = await insertRun(projectId, { planId, milestoneId });
      await record(await insertItem(linked), 'passed', `${utcDay(0)}T08:00:00.000Z`);
      const bare = await insertRun(projectId);
      await record(await insertItem(bare), 'passed', `${utcDay(0)}T09:00:00.000Z`);

      const byPlan = (await getSummary('admin', projectId, 'plan_id=none'))
        .body.data as SummaryData;
      expect(byPlan.filters.plan_id).toBe('none');
      expect(byPlan.progress.data.map((run) => run.id)).toEqual([bare]);
      expect(byPlan.progress.meta.total).toBe(1);
      expect(byPlan.progress.items.total).toBe(1);
      expect(byPlan.trend.totals.total).toBe(1);

      const byMilestone = (await getSummary('admin', projectId, 'milestone_id=none'))
        .body.data as SummaryData;
      expect(byMilestone.filters.milestone_id).toBe('none');
      expect(byMilestone.progress.data.map((run) => run.id)).toEqual([bare]);
      expect(byMilestone.trend.totals.total).toBe(1);

      const byPlanId = (await getSummary('admin', projectId, `plan_id=${planId}`))
        .body.data as SummaryData;
      expect(byPlanId.filters.plan_id).toBe(planId);
      expect(byPlanId.progress.data.map((run) => run.id)).toEqual([linked]);
    });

    it('drops a soft-deleted milestone name while keeping its id, like the runs list', async () => {
      const milestoneId = await insertMilestone(projectId, 'Retired milestone');
      const runId = await insertRun(projectId, { milestoneId });
      // The service detaches runs before it soft-deletes, so this state is only
      // reachable if that transaction is bypassed. The two read paths must still
      // agree: the runs list joins milestones with `deleted_at IS NULL`, so the
      // id survives and the name does not.
      await test.db.query(
        'UPDATE milestones SET deleted_at = now() WHERE id = $1',
        [milestoneId],
      );

      const data = (await getSummary('admin')).body.data as SummaryData;
      const row = data.progress.data.find((run) => run.id === runId);

      expect(row).toBeDefined();
      expect(row!.milestone_id).toBe(milestoneId);
      expect(row!.milestone_name).toBeNull();
    });

    it('an unknown plan uuid returns an empty 200, not 404', async () => {
      const runId = await insertRun(projectId);
      await record(await insertItem(runId), 'passed', `${utcDay(0)}T08:00:00.000Z`);
      const unknown = '00000000-0000-4000-8000-000000000000';

      const res = await getSummary('admin', projectId, `plan_id=${unknown}`);

      expect(res.status).toBe(200);
      const data = res.body.data as SummaryData;
      expect(data.filters.plan_id).toBe(unknown);
      expect(data.trend.buckets.every((bucket) => bucket.total === 0)).toBe(true);
      expect(data.trend.totals.total).toBe(0);
      expect(data.progress.data).toEqual([]);
      expect(data.progress.meta).toMatchObject({ total: 0, total_pages: 1 });
      expect(data.progress.items.total).toBe(0);
    });

    it('status filters both sections and closing a run moves its earlier results', async () => {
      const runId = await insertRun(projectId);
      await record(await insertItem(runId), 'passed', `${utcDay(-1)}T09:00:00.000Z`);

      const open = (await getSummary('admin', projectId, 'status=open&days=7'))
        .body.data as SummaryData;
      expect(open.trend.totals.status_counts['passed']).toBe(1);
      expect(open.progress.data.map((run) => run.id)).toEqual([runId]);
      expect(open.progress.items.total).toBe(1);

      // The API, not raw SQL, so the derived completed_at/completed_by is what
      // the report reads. Closing is admin/lead only.
      const closed = await test.req.post(`/api/v1/runs/${runId}/close`).set(as('admin'));
      expect(closed.status).toBe(200);

      const completed = (await getSummary('admin', projectId, 'status=completed&days=7'))
        .body.data as SummaryData;
      expect(completed.trend.totals.status_counts['passed']).toBe(1);
      expect(completed.progress.data.map((run) => run.id)).toEqual([runId]);
      expect(completed.progress.data[0]!.status).toBe('completed');
      expect(completed.progress.items.total).toBe(1);

      const stillOpen = (await getSummary('admin', projectId, 'status=open&days=7'))
        .body.data as SummaryData;
      expect(stillOpen.trend.totals.total).toBe(0);
      expect(stillOpen.progress.data).toEqual([]);
      expect(stillOpen.progress.items.total).toBe(0);
    });

    it('progress.items covers every matching run, not just the page', async () => {
      const first = await insertRun(projectId);
      await record(await insertItem(first), 'passed', `${utcDay(0)}T08:00:00.000Z`);
      await record(await insertItem(first), 'failed', `${utcDay(0)}T08:01:00.000Z`);
      const second = await insertRun(projectId);
      await record(await insertItem(second), 'passed', `${utcDay(0)}T09:00:00.000Z`);

      const data = (await getSummary('admin', projectId, 'limit=1')).body.data as SummaryData;

      expect(data.progress.data).toHaveLength(1);
      expect(data.progress.meta).toEqual({ page: 1, limit: 1, total: 2, total_pages: 2 });
      expect(data.progress.items).toEqual({
        total: 3,
        with_results: 3,
        untested: 0,
        percent_complete: 100,
      });
    });

    it('orders open runs first, then due_date ascending with undated last, then name', async () => {
      // Created out of order on purpose: the sequence must come from the
      // contract, never from insertion order.
      const completed = await insertRun(projectId, {
        dueDate: utcDay(1),
        completedAt: `${utcDay(0)}T08:00:00.000Z`,
      });
      const openUndated = await insertRun(projectId);
      const openLater = await insertRun(projectId, { dueDate: utcDay(10) });
      const openSooner = await insertRun(projectId, { dueDate: utcDay(2) });
      // Same due date, and `Zulu` is inserted before `alpha`, so only a
      // case-insensitive (lower(name)) ascending sort can put alpha first.
      // Runs cannot tie on name — `(project_id, lower(name))` is unique among
      // live runs — so the contract's `id` tiebreak (step 4) is unreachable
      // from legal data and is not asserted here.
      const zulu = await insertRun(projectId, { dueDate: utcDay(3), name: 'Zulu' });
      const alpha = await insertRun(projectId, { dueDate: utcDay(3), name: 'alpha' });

      const data = (await getSummary('admin', projectId)).body.data as SummaryData;

      expect(data.progress.data.map((run) => run.id)).toEqual([
        openSooner,
        alpha,
        zulu,
        openLater,
        openUndated,
        completed,
      ]);
      expect(data.progress.data.map((run) => run.status)).toEqual([
        'open',
        'open',
        'open',
        'open',
        'open',
        'completed',
      ]);
    });

    it('a run with zero items reports zero counts and a null pass rate', async () => {
      await insertRun(projectId);

      const data = (await getSummary('admin', projectId)).body.data as SummaryData;

      const run = data.progress.data[0]!;
      expect(run.counts).toEqual({
        total: 0,
        passed: 0,
        failed: 0,
        blocked: 0,
        retest: 0,
        skipped: 0,
        untested: 0,
        percent_complete: 0,
      });
      expect(run.pass_rate).toBeNull();
      expect(run.results_in_window).toBe(0);
      expect(run.last_result_at).toBeNull();
      expect(data.progress.items).toEqual({
        total: 0,
        with_results: 0,
        untested: 0,
        percent_complete: 0,
      });
    });

    it('a page past the last page is an empty 200 with the real meta', async () => {
      await insertRun(projectId);

      const data = (await getSummary('admin', projectId, 'page=99')).body.data as SummaryData;

      expect(data.progress.data).toEqual([]);
      expect(data.progress.meta).toEqual({ page: 99, limit: 25, total: 1, total_pages: 1 });
    });

    it('archived project: 200 for Admin, 404 for the other roles', async () => {
      await insertRun(projectId);
      await archiveProject(projectId);

      const admin = await getSummary('admin');
      expect(admin.status).toBe(200);
      expect(admin.body.error).toBeUndefined();

      for (const role of ['lead', 'tester', 'viewer'] as UserRole[]) {
        const res = await getSummary(role);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
    });

    it('a Viewer gets the same body as an Admin', async () => {
      const planId = await insertPlan(projectId, 'Release 1');
      const milestoneId = await insertMilestone(projectId, 'Release 1', utcDay(7));
      const runId = await insertRun(projectId, {
        planId,
        milestoneId,
        dueDate: utcDay(7),
      });
      await record(await insertItem(runId), 'passed', `${utcDay(0)}T08:00:00.000Z`);

      const admin = await getSummary('admin');
      const viewer = await getSummary('viewer');

      expect(admin.status).toBe(200);
      expect(viewer.status).toBe(200);
      expect(viewer.body.data).toEqual(admin.body.data);
    });
  });
});