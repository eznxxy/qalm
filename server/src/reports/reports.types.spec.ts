import { toProgressItemsDto, toProgressRunDto, toReportSummaryDto, toTrendBody } from './reports.types';
import type { ProgressRunRow, TrendRow } from './reports.store';

const run = (overrides: Partial<ProgressRunRow> = {}): ProgressRunRow => ({
  id: 'r-1', name: 'Release 2.4 smoke', plan_id: null, plan_name: null,
  milestone_id: null, milestone_name: null, start_date: null, due_date: null,
  completed: false, total: 0, passed: 0, failed: 0, blocked: 0, retest: 0,
  skipped: 0, untested: 0, results_in_window: 0, last_result_at: null, ...overrides,
});

const day = (date: string, overrides: Partial<TrendRow> = {}): TrendRow => ({
  day: date, passed: 0, failed: 0, blocked: 0, retest: 0, skipped: 0, ...overrides,
});

describe('toProgressRunDto', () => {
  it('derives status from completed, percent from the latest-result counts, and a null rate with no verdict', () => {
    expect(toProgressRunDto(run({ completed: true }))).toMatchObject({
      status: 'completed',
      counts: { percent_complete: 0 },
      pass_rate: null,
    });
  });

  it('excludes skipped from the pass rate and rounds percent complete', () => {
    const dto = toProgressRunDto(run({ total: 50, passed: 31, failed: 4, blocked: 2, retest: 0, skipped: 5, untested: 8 }));
    expect(dto.counts.percent_complete).toBe(84);
    expect(dto.pass_rate).toBe(83.8);
  });

  it('serialises last_result_at as an ISO string, or null when the run has no result', () => {
    expect(toProgressRunDto(run({ last_result_at: new Date('2026-10-28T09:12:00Z') })).last_result_at)
      .toBe('2026-10-28T09:12:00.000Z');
    expect(toProgressRunDto(run()).last_result_at).toBeNull();
  });
});

describe('toProgressItemsDto', () => {
  it('derives untested and percent complete from total and with_results', () => {
    expect(toProgressItemsDto({ total: 120, with_results: 85 }))
      .toEqual({ total: 120, with_results: 85, untested: 35, percent_complete: 71 });
  });

  it('reports zero rather than NaN for an empty project', () => {
    expect(toProgressItemsDto({ total: 0, with_results: 0 }))
      .toEqual({ total: 0, with_results: 0, untested: 0, percent_complete: 0 });
  });
});

describe('toTrendBody', () => {
  it('keeps one bucket per row and recomputes the window rate from the summed counts', () => {
    const body = toTrendBody([day('2026-10-27', { passed: 3, failed: 1, skipped: 4 }), day('2026-10-28', { passed: 1, blocked: 1 })]);
    expect(body.buckets).toHaveLength(2);
    expect(body.totals).toEqual({
      status_counts: { passed: 4, failed: 1, blocked: 1, retest: 0, skipped: 4 },
      total: 10,
      pass_rate: 66.7,
    });
  });
});

describe('toReportSummaryDto', () => {
  it('nests the shared trend body, the progress page and the all-runs items rollup under one window', () => {
    const summary = toReportSummaryDto(
      'p-1', { from: '2026-10-27', to: '2026-10-28', days: 2 },
      { plan_id: 'none', milestone_id: null, status: 'open' },
      [day('2026-10-27'), day('2026-10-28')],
      [run()],
      { page: 1, limit: 25, total: 1, total_pages: 1 },
      { total: 50, with_results: 37 },
    );
    expect(summary).toMatchObject({
      project_id: 'p-1', from: '2026-10-27', to: '2026-10-28', days: 2,
      filters: { plan_id: 'none', milestone_id: null, status: 'open' },
      trend: { buckets: [{ date: '2026-10-27' }, { date: '2026-10-28' }] },
      progress: { data: [{ id: 'r-1' }], meta: { total: 1 }, items: { percent_complete: 74 } },
    });
  });
});