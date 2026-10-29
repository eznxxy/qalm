/* eslint-disable @typescript-eslint/require-await -- the in-memory fake mirrors
   the async store surface without doing I/O. */
import { Test } from '@nestjs/testing';
import { AuthUser, UserRole } from '../auth/current-user';
import { ErrorCode } from '../errors';
import type { ProjectRef } from '../runs/runs.store';
import type { ReportFilter } from './reports.filters';
import { ReportsService } from './reports.service';
import {
  ProgressItemsRow,
  ProgressRunRow,
  ReportsStore,
  TrendRow,
} from './reports.store';

/**
 * Decision-logic tests for ReportsService over an in-memory fake of the reports
 * store. The window arithmetic is unit-tested separately (reports.dates.spec);
 * here we check which window the service asks for, what it does with the rows,
 * and the project-visibility rules. The real SQL path is covered by
 * test/reports.e2e-spec.ts.
 */
class FakeStore {
  project: ProjectRef | null = { id: 'p-1', status: 'active' };
  rows: TrendRow[] = [];
  runs: ProgressRunRow[] = [];
  runCount = 0;
  items: ProgressItemsRow = { total: 0, with_results: 0 };
  calls: Array<{ projectId: string; from: string; to: string }> = [];
  /** The filter each read saw, in call order; `null` is the overview trend. */
  filters: Array<ReportFilter | null> = [];
  countCalls: Array<{ projectId: string; filter: ReportFilter }> = [];
  progressCalls: Array<{
    projectId: string;
    filter: ReportFilter;
    from: string;
    to: string;
    limit: number;
    offset: number;
  }> = [];
  itemCalls: Array<{ projectId: string; filter: ReportFilter }> = [];

  async findProject(): Promise<ProjectRef | null> {
    return this.project;
  }

  async trend(
    projectId: string,
    from: string,
    to: string,
    filter: ReportFilter | null = null,
  ): Promise<TrendRow[]> {
    this.calls.push({ projectId, from, to });
    this.filters.push(filter);
    return this.rows;
  }

  async countRuns(projectId: string, filter: ReportFilter): Promise<number> {
    this.countCalls.push({ projectId, filter });
    return this.runCount;
  }

  async progress(
    projectId: string,
    filter: ReportFilter,
    from: string,
    to: string,
    limit: number,
    offset: number,
  ): Promise<ProgressRunRow[]> {
    this.progressCalls.push({ projectId, filter, from, to, limit, offset });
    return this.runs;
  }

  async progressItems(
    projectId: string,
    filter: ReportFilter,
  ): Promise<ProgressItemsRow> {
    this.itemCalls.push({ projectId, filter });
    return this.items;
  }

  /** Every argument any read recorded, so "nothing was read" is one assertion. */
  get allReads(): number {
    return (
      this.calls.length +
      this.countCalls.length +
      this.progressCalls.length +
      this.itemCalls.length
    );
  }
}

const USER: AuthUser = {
  id: 'u-admin',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'admin',
  isActive: true,
  mustChangePassword: false,
};

const AS = (role: UserRole): AuthUser => ({ ...USER, id: `u-${role}`, role });

async function expectCode(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

/**
 * One zero-filled row per day, exactly as the SQL `generate_series` returns
 * them — the service must not re-bucket or sort.
 */
function zeroRows(from: string, to: string): TrendRow[] {
  const rows: TrendRow[] = [];
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  for (let at = start; at <= end; at += 86_400_000) {
    rows.push({
      day: new Date(at).toISOString().slice(0, 10),
      passed: 0,
      failed: 0,
      blocked: 0,
      retest: 0,
      skipped: 0,
    });
  }
  return rows;
}

/**
 * One run row exactly as the SQL returns it: `::text` dates, a real `Date` for
 * `last_result_at` (the mapper calls `.toISOString()`), and the counts already
 * reduced to the latest result per item.
 */
function progressRow(overrides: Partial<ProgressRunRow> = {}): ProgressRunRow {
  return {
    id: 'r-1',
    name: 'Release smoke',
    plan_id: null,
    plan_name: null,
    milestone_id: null,
    milestone_name: null,
    start_date: '2026-10-20',
    due_date: '2026-10-30',
    completed: false,
    total: 10,
    passed: 4,
    failed: 2,
    blocked: 1,
    retest: 1,
    skipped: 1,
    untested: 1,
    results_in_window: 3,
    last_result_at: new Date('2026-10-28T08:00:00Z'),
    ...overrides,
  };
}

describe('ReportsService (unit, in-memory store)', () => {
  let service: ReportsService;
  let store: FakeStore;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-28T10:00:00Z'));
    store = new FakeStore();
    const moduleRef = await Test.createTestingModule({
      providers: [{ provide: ReportsStore, useValue: store }, ReportsService],
    }).compile();
    service = moduleRef.get(ReportsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('window', () => {
    it('defaults to 14 UTC days ending today', async () => {
      store.rows = zeroRows('2026-10-15', '2026-10-28');

      const trend = await service.trend(AS('viewer'), 'p-1', {});

      expect(store.calls).toEqual([
        { projectId: 'p-1', from: '2026-10-15', to: '2026-10-28' },
      ]);
      expect(trend.from).toBe('2026-10-15');
      expect(trend.to).toBe('2026-10-28');
      expect(trend.days).toBe(14);
      expect(trend.buckets).toHaveLength(14);
    });

    it.each([1, 7, 30, 90])('passes a %i-day window straight through', async (days) => {
      const trend = await service.trend(AS('lead'), 'p-1', { days });

      expect(store.calls[0]!.to).toBe('2026-10-28');
      expect(trend.days).toBe(days);
      expect(trend.buckets).toHaveLength(0);
    });

    it('resolves the window once per request, not once per row', async () => {
      store.rows = zeroRows('2026-10-28', '2026-10-28');

      const trend = await service.trend(AS('tester'), 'p-1', { days: 1 });

      expect(store.calls).toHaveLength(1);
      expect(trend.buckets).toHaveLength(1);
      expect(trend.buckets[0]!.date).toBe('2026-10-28');
    });
  });

  describe('project visibility', () => {
    it('answers 404 for an unknown project before touching the trend', async () => {
      store.project = null;

      await expectCode(service.trend(AS('admin'), 'p-404', {}), 'NOT_FOUND');
      expect(store.calls).toHaveLength(0);
    });

    it('hides an archived project from every non-Admin role', async () => {
      store.project = { id: 'p-1', status: 'archived' };

      for (const role of ['lead', 'tester', 'viewer'] as UserRole[]) {
        await expectCode(service.trend(AS(role), 'p-1', {}), 'NOT_FOUND');
      }
      expect(store.calls).toHaveLength(0);
    });

    it('lets an Admin read an archived project', async () => {
      store.project = { id: 'p-1', status: 'archived' };

      const trend = await service.trend(AS('admin'), 'p-1', {});

      expect(trend.project_id).toBe('p-1');
      expect(store.calls).toHaveLength(1);
    });
  });

  describe('response', () => {
    it('maps rows to buckets, recomputes totals from the sums, and excludes skipped from the rate', async () => {
      store.rows = [
        { day: '2026-10-15', passed: 3, failed: 1, blocked: 0, retest: 0, skipped: 4 },
        ...zeroRows('2026-10-16', '2026-10-27'),
        { day: '2026-10-28', passed: 1, failed: 0, blocked: 1, retest: 0, skipped: 0 },
      ];

      const trend = await service.trend(AS('admin'), 'p-1', {});

      expect(trend.buckets[0]).toEqual({
        date: '2026-10-15',
        status_counts: { passed: 3, failed: 1, blocked: 0, retest: 0, skipped: 4 },
        total: 8,
        pass_rate: 75,
      });
      expect(trend.buckets[13]).toEqual({
        date: '2026-10-28',
        status_counts: { passed: 1, failed: 0, blocked: 1, retest: 0, skipped: 0 },
        total: 2,
        pass_rate: 50,
      });
      expect(trend.totals).toEqual({
        status_counts: { passed: 4, failed: 1, blocked: 1, retest: 0, skipped: 4 },
        total: 10,
        pass_rate: 66.7,
      });
    });

    it('gives every empty day a zero count, a null rate and no untested key', async () => {
      store.rows = zeroRows('2026-10-15', '2026-10-28');

      const trend = await service.trend(AS('viewer'), 'p-1', {});

      for (const bucket of trend.buckets) {
        expect(bucket.total).toBe(0);
        expect(bucket.pass_rate).toBeNull();
        expect(Object.keys(bucket.status_counts).sort()).toEqual([
          'blocked',
          'failed',
          'passed',
          'retest',
          'skipped',
        ]);
      }
      expect(trend.totals).toEqual({
        status_counts: { passed: 0, failed: 0, blocked: 0, retest: 0, skipped: 0 },
        total: 0,
        pass_rate: null,
      });
    });

    it('returns the echoed window even when the store found nothing', async () => {
      const trend = await service.trend(AS('viewer'), 'p-1', { days: 7 });

      expect(trend).toEqual({
        project_id: 'p-1',
        from: '2026-10-22',
        to: '2026-10-28',
        days: 7,
        buckets: [],
        totals: {
          status_counts: { passed: 0, failed: 0, blocked: 0, retest: 0, skipped: 0 },
          total: 0,
          pass_rate: null,
        },
      });
    });
  });

  describe('summary', () => {
    const NO_FILTER: ReportFilter = {
      planId: null,
      planNone: false,
      milestoneId: null,
      milestoneNone: false,
      status: null,
    };

    it('defaults to 30 days, page 1, limit 25 and null filters', async () => {
      const summary = await service.summary(AS('viewer'), 'p-1', {});

      expect(store.calls).toEqual([
        { projectId: 'p-1', from: '2026-09-29', to: '2026-10-28' },
      ]);
      expect(store.countCalls).toEqual([{ projectId: 'p-1', filter: NO_FILTER }]);
      expect(store.progressCalls).toEqual([
        {
          projectId: 'p-1',
          filter: NO_FILTER,
          from: '2026-09-29',
          to: '2026-10-28',
          limit: 25,
          offset: 0,
        },
      ]);
      expect(store.itemCalls).toEqual([{ projectId: 'p-1', filter: NO_FILTER }]);
      expect(summary).toMatchObject({
        project_id: 'p-1',
        from: '2026-09-29',
        to: '2026-10-28',
        days: 30,
        filters: { plan_id: null, milestone_id: null, status: null },
      });
      expect(summary.progress.meta).toEqual({
        page: 1,
        limit: 25,
        total: 0,
        total_pages: 1,
      });
    });

    it('resolves none for the store while echoing the raw sentinel', async () => {
      const summary = await service.summary(AS('admin'), 'p-1', {
        plan_id: 'none',
        milestone_id: 'none',
        status: 'open',
      });

      const resolved: ReportFilter = {
        planId: null,
        planNone: true,
        milestoneId: null,
        milestoneNone: true,
        status: 'open',
      };
      // All four reads share one filter, so the tiles and the table agree.
      expect(store.filters).toEqual([resolved]);
      expect(store.countCalls[0]!.filter).toEqual(resolved);
      expect(store.progressCalls[0]!.filter).toEqual(resolved);
      expect(store.itemCalls[0]!.filter).toEqual(resolved);
      expect(summary.filters).toEqual({
        plan_id: 'none',
        milestone_id: 'none',
        status: 'open',
      });
    });

    it('maps one page and the all-runs items rollup', async () => {
      store.runs = [progressRow()];
      store.runCount = 1;
      store.items = { total: 120, with_results: 85 };

      const summary = await service.summary(AS('admin'), 'p-1', {
        limit: 10,
        page: 2,
      });

      expect(store.progressCalls[0]).toMatchObject({ limit: 10, offset: 10 });
      const run = summary.progress.data[0]!;
      expect(run.counts.percent_complete).toBe(90);
      expect(run.pass_rate).toBe(50);
      expect(run.last_result_at).toBe('2026-10-28T08:00:00.000Z');
      expect(run.status).toBe('open');
      expect(summary.progress.items).toEqual({
        total: 120,
        with_results: 85,
        untested: 35,
        percent_complete: 71,
      });
      expect(summary.progress.meta).toEqual({
        page: 2,
        limit: 10,
        total: 1,
        total_pages: 1,
      });
    });

    it('applies the archived-project rule before reading anything', async () => {
      store.project = { id: 'p-1', status: 'archived' };

      await expectCode(service.summary(AS('viewer'), 'p-1', {}), 'NOT_FOUND');
      expect(store.allReads).toBe(0);

      const summary = await service.summary(AS('admin'), 'p-1', {});

      expect(summary.project_id).toBe('p-1');
      expect(store.allReads).toBe(4);
    });
  });
});