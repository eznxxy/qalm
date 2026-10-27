import { ITEM_STATUSES, ITEM_STATUS_RANK } from './runs.constants';
import {
  FILTERABLE_ITEM_STATUSES,
  StatusCounts,
  countsForStatuses,
  emptyCounts,
  percentComplete,
  statusRankSql,
  sumCounts,
  toItemStatus,
} from './run-counts';

/**
 * Pure rollup maths for docs/api-runs.md § Resource (Run): each item counts
 * once by its latest result (or `untested`) and `percent_complete` is rounded
 * from the totals. No database here — the SQL path is covered by the e2e spec.
 */
describe('run-counts', () => {
  describe('percentComplete', () => {
    it('rounds to the nearest whole percent', () => {
      expect(percentComplete(50, 13)).toBe(74);
      expect(percentComplete(3, 1)).toBe(67);
      expect(percentComplete(3, 2)).toBe(33);
    });

    it('is 0 when there is nothing to count', () => {
      expect(percentComplete(0, 0)).toBe(0);
      expect(percentComplete(-1, 0)).toBe(0);
    });

    it('is 100 when every item has a result', () => {
      expect(percentComplete(4, 0)).toBe(100);
    });
  });

  describe('emptyCounts', () => {
    it('is the all-zero rollup', () => {
      expect(emptyCounts()).toEqual({
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
  });

  describe('countsForStatuses', () => {
    it('counts each status bucket and derives the percentage', () => {
      const counts = countsForStatuses([
        'passed',
        'passed',
        'failed',
        'blocked',
        'retest',
        'skipped',
        'untested',
        'untested',
      ]);
      expect(counts).toEqual({
        total: 8,
        passed: 2,
        failed: 1,
        blocked: 1,
        retest: 1,
        skipped: 1,
        untested: 2,
        percent_complete: 75,
      });
    });

    it('treats an untested-only run as 0% complete', () => {
      expect(countsForStatuses(['untested', 'untested']).percent_complete).toBe(0);
    });

    it('returns the empty rollup for no items', () => {
      expect(countsForStatuses([])).toEqual(emptyCounts());
    });
  });

  describe('sumCounts', () => {
    it('adds every bucket and re-derives the percentage from the totals', () => {
      const a: StatusCounts = countsForStatuses(['passed', 'untested']);
      const b: StatusCounts = countsForStatuses(['failed', 'skipped']);
      const sum = sumCounts([a, b]);
      expect(sum).toEqual({
        total: 4,
        passed: 1,
        failed: 1,
        blocked: 0,
        retest: 0,
        skipped: 1,
        untested: 1,
        percent_complete: 75,
      });
    });

    it('never averages percentages (sums then divides)', () => {
      // Two runs where averaging would give 50, but the true pooled rate is 75.
      const runA: StatusCounts = { ...emptyCounts(), total: 4, passed: 4, percent_complete: 100 };
      const runB: StatusCounts = {
        ...emptyCounts(),
        total: 4,
        passed: 2,
        untested: 2,
        percent_complete: 50,
      };
      expect(sumCounts([runA, runB]).percent_complete).toBe(75);
    });

    it('is the empty rollup for an empty list', () => {
      expect(sumCounts([])).toEqual(emptyCounts());
    });
  });

  describe('toItemStatus', () => {
    it('maps a missing latest result to untested', () => {
      expect(toItemStatus(null)).toBe('untested');
      expect(toItemStatus(undefined)).toBe('untested');
    });

    it('passes through every known status', () => {
      for (const status of ITEM_STATUSES) {
        expect(toItemStatus(status)).toBe(status);
      }
    });

    it('fails loudly on an unexpected value rather than counting it', () => {
      expect(() => toItemStatus('exploded')).toThrow(/Unknown result status/);
    });
  });

  describe('statusRankSql', () => {
    it('builds a CASE ordered worst-first from the shared rank table', () => {
      const sql = statusRankSql("COALESCE(lr.status, 'untested')");
      for (const status of ITEM_STATUSES) {
        expect(sql).toContain(`WHEN '${status}' THEN ${ITEM_STATUS_RANK[status]}`);
      }
      expect(sql).toContain('ELSE 7 END');
      // Worst first: failed ranks before untested in the numeric ordering.
      expect(ITEM_STATUS_RANK.failed).toBeLessThan(ITEM_STATUS_RANK.untested);
    });
  });

  describe('FILTERABLE_ITEM_STATUSES', () => {
    it('is exactly the item statuses, untested included', () => {
      expect(FILTERABLE_ITEM_STATUSES).toEqual(ITEM_STATUSES);
    });
  });
});