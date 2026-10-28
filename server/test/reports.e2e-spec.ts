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
    options: { deletedAt?: string | null } = {},
  ): Promise<string> => {
    fixtureRunSeq += 1;
    const res = await test.db.query<{ id: string }>(
      `INSERT INTO runs (project_id, name, created_by, updated_by, deleted_at)
       VALUES ($1, $2, $3, $3, $4) RETURNING id`,
      [
        targetProjectId,
        `Trend fixture ${fixtureRunSeq}`,
        userIds['admin'],
        options.deletedAt ?? null,
      ],
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
});