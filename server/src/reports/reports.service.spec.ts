/* eslint-disable @typescript-eslint/require-await -- the in-memory fake mirrors
   the async store surface without doing I/O. */
import { Test } from '@nestjs/testing';
import { AuthUser, UserRole } from '../auth/current-user';
import { ErrorCode } from '../errors';
import type { ProjectRef } from '../runs/runs.store';
import { ReportsService } from './reports.service';
import { ReportsStore, TrendRow } from './reports.store';

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
  calls: Array<{ projectId: string; from: string; to: string }> = [];

  async findProject(): Promise<ProjectRef | null> {
    return this.project;
  }

  async trend(projectId: string, from: string, to: string): Promise<TrendRow[]> {
    this.calls.push({ projectId, from, to });
    return this.rows;
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

describe('ReportsService (unit, in-memory trend)', () => {
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
});