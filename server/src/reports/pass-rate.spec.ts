import { RecordedCounts, emptyRecordedCounts, passRate, sumRecordedCounts, totalRecorded } from './pass-rate';

/**
 * The pass-rate rule, docs/api-project-overview.md § Fields. A day with no
 * verdict is `null`, never `0`; `skipped` is counted but never divides; totals
 * are recomputed from summed counts, not averaged.
 */
const counts = (overrides: Partial<RecordedCounts> = {}): RecordedCounts => ({
  ...emptyRecordedCounts(),
  ...overrides,
});

describe('passRate', () => {
  it('returns null when nothing was given a verdict', () => {
    expect(passRate(counts())).toBeNull();
    expect(passRate(counts({ skipped: 5 }))).toBeNull();
  });

  it('computes passed over passed+failed+blocked+retest', () => {
    expect(passRate(counts({ passed: 3, failed: 1 }))).toBe(75);
    expect(passRate(counts({ passed: 31, failed: 4, blocked: 1, retest: 2 }))).toBe(81.6);
    expect(passRate(counts({ passed: 412, failed: 28, blocked: 9, retest: 6 }))).toBe(90.5);
    expect(passRate(counts({ passed: 1, failed: 2 }))).toBe(33.3);
    expect(passRate(counts({ passed: 2, failed: 1 }))).toBe(66.7);
  });

  it('never lets skipped or an attempted-but-unverified result count as a pass', () => {
    // 3 passed, 1 blocked, 1 skipped: skipped is outside the denominator.
    expect(passRate(counts({ passed: 3, blocked: 1, skipped: 1 }))).toBe(75);
    expect(passRate(counts({ failed: 4 }))).toBe(0);
    expect(passRate(counts({ passed: 4 }))).toBe(100);
  });
});

describe('recorded totals', () => {
  it('counts every recorded status, including skipped', () => {
    expect(totalRecorded(counts({ passed: 1, failed: 2, blocked: 3, retest: 4, skipped: 5 }))).toBe(15);
    expect(totalRecorded(counts())).toBe(0);
  });

  it('sums day counts and leaves the rate to be recomputed', () => {
    const totals = sumRecordedCounts([
      counts({ passed: 1 }),
      counts({ passed: 3, failed: 1, skipped: 9 }),
    ]);
    expect(totals).toEqual({ passed: 4, failed: 1, blocked: 0, retest: 0, skipped: 9 });
    expect(passRate(totals)).toBe(80);
  });
});